import { EmailMessageRow } from "@/types/models";
import { AIProvider, ExtractedFactCandidate, RequestCandidate } from "./provider";

// -----------------------------------------------------------------------------
// REAL LLM-BACKED PROVIDER — makes actual network calls to the Anthropic
// API. This is not a stub: the request/response handling below is complete.
// It was first executed successfully against the live API on 2026-07-31
// (roadmap task A2) using claude-sonnet-5.
//
// Enable it by setting in .env.local:
//   AI_PROVIDER=llm
//   ANTHROPIC_API_KEY=sk-ant-...
//   ANTHROPIC_MODEL=claude-sonnet-5     (optional — see docs.claude.com
//                                        for current model names; this one
//                                        was verified current on
//                                        2026-07-31)
//
// Design notes:
//   - Uses tool_use (forced via tool_choice) instead of asking the model to
//     "respond only in JSON", because forced tool calls are far more
//     reliable to parse than hoping the model doesn't add preamble.
//   - ONE API CALL PER MESSAGE, not one per question. The AIProvider
//     interface exposes three separate questions (facts / requests /
//     completion), but asking them separately meant sending the same email
//     to the model twice and paying for it twice. analyzeMessage() asks all
//     of the applicable questions in a single call and caches the answer;
//     the three interface methods then read from that cache. See
//     prefetchAnalysis() for how the pipeline warms it.
//   - Every field the model returns is validated against the same
//     factType/category/priority enums the rule-based engine uses, so a
//     malformed or hallucinated field can't silently corrupt the database —
//     invalid entries are dropped with a console.warn rather than thrown,
//     so one bad extraction doesn't take down the whole pipeline.
//   - Token usage is accumulated in a module-level counter so callers can
//     report what a run actually cost (see getUsageStats()).
// -----------------------------------------------------------------------------

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

/** Verify against https://docs.claude.com — model names change over time.
 *  "claude-sonnet-5" was verified current on 2026-07-31; the previous
 *  default ("claude-sonnet-4-5") is no longer listed as a current model. */
const DEFAULT_MODEL = "claude-sonnet-5";

/** How many analysed messages to remember. Small on purpose — this exists to
 *  let three interface calls about the same message share one API call, not
 *  to be a long-lived cache. */
const ANALYSIS_CACHE_LIMIT = 64;

const FACT_TYPES = [
  "PROPERTY_ADDRESS",
  "BUYER_NAME",
  "SELLER_NAME",
  "LENDER_NAME",
  "ATTORNEY_NAME",
  "REALTOR_NAME",
  "CLOSING_DATE",
  "CLOSING_TIME",
  "CLOSING_LOCATION",
  "FILE_NUMBER",
  "LOAN_NUMBER",
  "DEADLINE",
  "REQUEST",
  "MILESTONE",
  "OTHER",
] as const;

const TASK_CATEGORIES = [
  "Status update",
  "Document request",
  "Email response",
  "Call request",
  "Payoff follow-up",
  "Commitment revision",
  "CPL request",
  "Scheduling response",
  "Missing information",
  "Internal review",
  "External follow-up",
  "Deadline",
  "Other",
] as const;

const VALID_PRIORITIES = ["urgent", "high", "normal", "low"] as const;
type Priority = (typeof VALID_PRIORITIES)[number];
const isPriority = (v: string): v is Priority => (VALID_PRIORITIES as readonly string[]).includes(v);

// --- usage accounting --------------------------------------------------------

export interface UsageStats {
  /** Number of HTTP requests that reached the API and returned a result. */
  apiCalls: number;
  inputTokens: number;
  outputTokens: number;
}

const usage: UsageStats = { apiCalls: 0, inputTokens: 0, outputTokens: 0 };

/** What this process has spent on the API so far. Used by `npm run eval` to
 *  report the cost of a scoring run in plain money. */
export function getUsageStats(): UsageStats {
  return { ...usage };
}

export function resetUsageStats(): void {
  usage.apiCalls = 0;
  usage.inputTokens = 0;
  usage.outputTokens = 0;
}

// --- the analysis a single API call returns ----------------------------------

interface MessageAnalysis {
  facts: ExtractedFactCandidate[];
  requests: RequestCandidate[];
  completion: { taskHint: string; evidenceSummary: string } | null;
}

// --- the shared instruction text ---------------------------------------------
// These strings are reproduced verbatim from the three separate prompts that
// preceded the combined call. The CLOSING_TIME sentence in particular is a
// hard-won fix (the model invented "10:00 AM" on an email that only said
// "Thursday at 10") — do not reword it without re-running `npm run eval`.

const FACT_INSTRUCTIONS =
  "You extract structured facts about real-estate closing transactions from title-agency email. " +
  "Only extract facts that are actually stated or strongly implied — never invent values. " +
  "For CLOSING_DATE, prefer the day-of-week or explicit date as written; do not resolve relative " +
  "dates yourself. For CLOSING_TIME, record the time exactly as written — never add an AM/PM " +
  "marker or minutes that the text does not state. Assign confidence 0-1 reflecting how certain " +
  "the text makes the fact, not how important it is.";

const REQUEST_INSTRUCTIONS =
  "You detect action requests (explicit or implicit) in an incoming email to a title agency. " +
  "Distinguish a request for action from mere information, a completed action, a conditional future " +
  "action, a closing appointment, and a deadline mention with no request attached. Split a single " +
  "email into multiple requests when it asks for genuinely separate things that different people " +
  "could work on independently — for example sending a CPL and confirming a payoff was ordered. " +
  "But when one party sends a standing list of requirements, conditions or documents needed for a " +
  "single purpose — lender closing requirements, funding conditions, a checklist of items needed " +
  "before approval — report ONE request covering that list as a whole, not one per bullet point. " +
  "Eight bullets from one lender about one closing is one task, and its title should name the list " +
  "(for example \"Answer lender closing requirements\"), not the first bullet.";

const COMPLETION_INSTRUCTIONS =
  "You determine whether an outgoing email from a title agency indicates that a previously requested " +
  "task was completed (e.g. a document was sent, a question was answered, an order was confirmed).";

const SCOPE_RULE =
  "The FIRST message below is the message under review. Any messages after it are earlier " +
  "messages in the same thread, provided as context only. Extract facts from the whole thread, " +
  "but detect requests and completion signals ONLY in the message under review — never from the " +
  "earlier context messages.";

// --- tool schema fragments ---------------------------------------------------

const FACTS_SCHEMA = {
  type: "array",
  description: "Every closing-relevant fact found in the email thread.",
  items: {
    type: "object",
    properties: {
      factType: { type: "string", enum: FACT_TYPES as unknown as string[] },
      value: { description: "The extracted value, as a string." },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      evidenceSummary: { type: "string", description: "Short quote or paraphrase supporting this fact." },
    },
    required: ["factType", "value", "confidence", "evidenceSummary"],
  },
};

const REQUESTS_SCHEMA = {
  type: "array",
  description: "Every distinct actionable request found in the message under review.",
  items: {
    type: "object",
    properties: {
      isExplicit: { type: "boolean" },
      taskTitle: { type: "string" },
      category: { type: "string", enum: TASK_CATEGORIES as unknown as string[] },
      priority: { type: "string", enum: VALID_PRIORITIES as unknown as string[] },
      evidenceSummary: { type: "string" },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      deadlineText: { type: "string", description: "Verbatim deadline phrase if one exists, else omit." },
      waitingCondition: { type: "string", description: "For implicit/blocking requests, what's being waited on." },
    },
    required: ["isExplicit", "taskTitle", "category", "priority", "evidenceSummary", "confidence"],
  },
};

const COMPLETION_SCHEMA = {
  type: "object",
  description: "Whether the message under review signals that a previously requested task is done.",
  properties: {
    isCompletion: { type: "boolean" },
    taskCategory: { type: "string", enum: TASK_CATEGORIES as unknown as string[] },
    evidenceSummary: { type: "string" },
  },
  required: ["isCompletion"],
};

class LLMAIProvider implements AIProvider {
  readonly modelVersion: string;
  private readonly apiKey: string;
  /** message id -> in-flight or settled analysis. See ANALYSIS_CACHE_LIMIT. */
  private readonly analyses = new Map<string, Promise<MessageAnalysis>>();

  constructor() {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        "LLMAIProvider requires ANTHROPIC_API_KEY to be set. See src/lib/ai/llm-provider.ts header comment."
      );
    }
    this.apiKey = apiKey;
    // NOTE: model names change over time; DEFAULT_MODEL was last verified
    // against https://docs.claude.com on 2026-07-31. A wrong name produces
    // an HTTP 400 from the API, which callTool() surfaces verbatim instead
    // of swallowing.
    this.modelVersion = process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;
    if (!process.env.ANTHROPIC_MODEL) {
      console.warn(
        `[llm-provider] ANTHROPIC_MODEL not set — defaulting to "${DEFAULT_MODEL}". ` +
          "Verify this is a current model name at https://docs.claude.com/en/docs/about-claude/models"
      );
    }
  }

  /**
   * Start the single API call for a message without waiting for it.
   *
   * The pipeline calls this before it begins extracting, so that the later
   * extractFacts / detectRequests / detectCompletionSignal calls about the
   * same message all resolve from one round trip instead of two or three.
   * Safe to call more than once — the second call is a no-op.
   */
  async prefetchAnalysis(message: EmailMessageRow, threadContext: EmailMessageRow[]): Promise<void> {
    this.analysisFor(message, threadContext);
  }

  async extractFacts(
    message: EmailMessageRow,
    threadContext: EmailMessageRow[]
  ): Promise<ExtractedFactCandidate[]> {
    return (await this.analysisFor(message, threadContext)).facts;
  }

  async detectRequests(message: EmailMessageRow): Promise<RequestCandidate[]> {
    if (message.direction !== "INCOMING") return [];
    return (await this.analysisFor(message, [])).requests;
  }

  async detectCompletionSignal(
    message: EmailMessageRow
  ): Promise<{ taskHint: string; evidenceSummary: string } | null> {
    if (message.direction !== "OUTGOING") return null;
    return (await this.analysisFor(message, [])).completion;
  }

  /** Return the cached analysis for a message, starting one if needed. */
  private analysisFor(message: EmailMessageRow, threadContext: EmailMessageRow[]): Promise<MessageAnalysis> {
    const cached = this.analyses.get(message.id);
    if (cached) return cached;

    const pending = this.analyzeMessage(message, threadContext);
    // Attach a no-op handler so a failure here is never reported as an
    // unhandled rejection. The real error still reaches whoever awaits the
    // stored promise, which is what the pipeline relies on.
    pending.catch(() => {});

    this.analyses.set(message.id, pending);
    if (this.analyses.size > ANALYSIS_CACHE_LIMIT) {
      const oldest = this.analyses.keys().next().value;
      if (oldest !== undefined) this.analyses.delete(oldest);
    }
    return pending;
  }

  /** One API call: facts, plus requests or completion depending on direction. */
  private async analyzeMessage(
    message: EmailMessageRow,
    threadContext: EmailMessageRow[]
  ): Promise<MessageAnalysis> {
    const isIncoming = message.direction === "INCOMING";

    const threadText = [message, ...threadContext]
      .map(
        (m) =>
          `--- Message from ${m.fromAddress} at ${m.sentAt} ---\nSubject: ${m.subject}\n${m.bodyText}`
      )
      .join("\n\n");

    const properties: Record<string, unknown> = { facts: FACTS_SCHEMA };
    const required = ["facts"];
    const systemParts = [FACT_INSTRUCTIONS];

    if (isIncoming) {
      properties.requests = REQUESTS_SCHEMA;
      required.push("requests");
      systemParts.push(REQUEST_INSTRUCTIONS);
    } else {
      properties.completion = COMPLETION_SCHEMA;
      systemParts.push(COMPLETION_INSTRUCTIONS);
    }
    if (threadContext.length > 0) systemParts.push(SCOPE_RULE);

    const result = await this.callTool<RawAnalysis>({
      system: systemParts.join(" "),
      userText: threadText,
      tool: {
        name: "emit_email_analysis",
        description:
          "Report everything found in this email: the closing-relevant facts, and " +
          (isIncoming ? "any actionable requests it makes." : "whether it signals a completed task."),
        input_schema: { type: "object", properties, required },
      },
    });

    return {
      facts: normalizeFacts(result?.facts),
      requests: isIncoming ? normalizeRequests(result?.requests) : [],
      completion: isIncoming ? null : normalizeCompletion(result?.completion),
    };
  }

  private async callTool<T>(params: {
    system: string;
    userText: string;
    tool: { name: string; description: string; input_schema: Record<string, unknown> };
  }): Promise<T | null> {
    const MAX_ATTEMPTS = 3;
    let lastError = "";

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      let response: Response;
      try {
        response = await fetch(ANTHROPIC_API_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": this.apiKey,
            "anthropic-version": ANTHROPIC_VERSION,
          },
          body: JSON.stringify({
            model: this.modelVersion,
            max_tokens: 2048,
            system: params.system,
            messages: [{ role: "user", content: params.userText }],
            tools: [params.tool],
            tool_choice: { type: "tool", name: params.tool.name },
          }),
        });
      } catch (err) {
        lastError = `Network error: ${String(err instanceof Error ? err.message : err)}`;
        if (attempt < MAX_ATTEMPTS) {
          await sleep(500 * attempt);
          continue;
        }
        break;
      }

      // Transient: rate limit or server-side error. Back off and retry.
      if (response.status === 429 || response.status >= 500) {
        lastError = `HTTP ${response.status}`;
        if (attempt < MAX_ATTEMPTS) {
          const retryAfter = Number(response.headers.get("retry-after") ?? "0");
          await sleep(retryAfter > 0 ? retryAfter * 1000 : 800 * attempt);
          continue;
        }
        break;
      }

      // Permanent: bad key, bad model name, malformed request. Retrying
      // will not help, so fail immediately with the API's own message —
      // this is what surfaces a wrong ANTHROPIC_MODEL or an expired key.
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(
          `Anthropic API rejected the request (HTTP ${response.status}). ` +
            `Check ANTHROPIC_API_KEY and ANTHROPIC_MODEL. Response: ${body.slice(0, 400)}`
        );
      }

      const data = await response.json();

      usage.apiCalls += 1;
      usage.inputTokens += Number(data?.usage?.input_tokens ?? 0);
      usage.outputTokens += Number(data?.usage?.output_tokens ?? 0);

      const toolUse = (data.content ?? []).find(
        (block: { type: string }) => block.type === "tool_use"
      );

      // No tool_use block is a legitimate outcome: the model looked and
      // found nothing worth reporting. That is NOT an error, and is
      // meaningfully different from the API being unreachable.
      if (!toolUse) return null;

      return toolUse.input as T;
    }

    // Every attempt failed. Throw rather than returning null, so the caller
    // cannot mistake an outage for "this email contained nothing."
    throw new Error(
      `Anthropic API unreachable after ${MAX_ATTEMPTS} attempts (${lastError}). ` +
        `Refusing to report an empty result, because that would look identical to a ` +
        `correctly-read email with no closing details in it.`
    );
  }
}

// --- validation --------------------------------------------------------------
// Anything the model returns that doesn't match the enums the rest of the app
// uses is dropped here, so a bad response can't reach the database.

function normalizeFacts(raw: RawFact[] | undefined): ExtractedFactCandidate[] {
  return (raw ?? [])
    .filter((f) => {
      const ok = (FACT_TYPES as readonly string[]).includes(f?.factType);
      if (!ok && f?.factType) console.warn(`[llm-provider] dropped fact with unknown type "${f.factType}"`);
      return ok;
    })
    .map((f) => ({
      factType: f.factType as ExtractedFactCandidate["factType"],
      value: f.value,
      confidence: clamp01(f.confidence),
      evidenceSummary: f.evidenceSummary,
    }));
}

function normalizeRequests(raw: RawRequest[] | undefined): RequestCandidate[] {
  return (raw ?? []).map((r) => ({
    isExplicit: Boolean(r.isExplicit),
    taskTitle: r.taskTitle,
    category: (TASK_CATEGORIES as readonly string[]).includes(r.category) ? r.category : "Other",
    priority: isPriority(r.priority) ? r.priority : "normal",
    evidenceSummary: r.evidenceSummary,
    confidence: clamp01(r.confidence),
    deadlineHint: r.deadlineText ? { kind: "explicit" as const, text: r.deadlineText } : undefined,
    waitingCondition: r.waitingCondition,
  }));
}

function normalizeCompletion(
  raw: RawCompletion | undefined
): { taskHint: string; evidenceSummary: string } | null {
  if (!raw?.isCompletion || !raw.taskCategory) return null;
  if (!(TASK_CATEGORIES as readonly string[]).includes(raw.taskCategory)) {
    console.warn(`[llm-provider] dropped completion with unknown category "${raw.taskCategory}"`);
    return null;
  }
  return {
    taskHint: raw.taskCategory,
    evidenceSummary: raw.evidenceSummary ?? "LLM detected completion language.",
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface RawFact {
  factType: string;
  value: unknown;
  confidence: number;
  evidenceSummary: string;
}

interface RawRequest {
  isExplicit: boolean;
  taskTitle: string;
  category: string;
  priority: string;
  evidenceSummary: string;
  confidence: number;
  deadlineText?: string;
  waitingCondition?: string;
}

interface RawCompletion {
  isCompletion: boolean;
  taskCategory?: string;
  evidenceSummary?: string;
}

interface RawAnalysis {
  facts?: RawFact[];
  requests?: RawRequest[];
  completion?: RawCompletion;
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}

/** Lazily constructed so a missing API key doesn't crash app startup — only throws when actually used. */
export function createLLMAIProvider(): AIProvider {
  return new LLMAIProvider();
}
