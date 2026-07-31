import { EmailMessageRow } from "@/types/models";
import { AIProvider, ExtractedFactCandidate, RequestCandidate } from "./provider";

// -----------------------------------------------------------------------------
// SIMULATED / RULE-BASED AI ENGINE — clearly labeled mock.
// Stands in for a real LLM extraction provider. Deterministic regex/keyword
// logic, on purpose, so the demo is reproducible. Implements the AIProvider
// interface so a real model provider can be dropped in without touching the
// matching, proposal, or review-routing code that consumes this output.
// -----------------------------------------------------------------------------

const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

const STREET_SUFFIXES =
  "Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Court|Ct|Boulevard|Blvd|Way|Place|Pl|Circle|Cir";

const ADDRESS_RE = new RegExp(
  `\\b\\d{1,6}\\s+[A-Z][A-Za-z0-9.\\s]{1,30}\\b(?:${STREET_SUFFIXES})\\b`,
  "g"
);

const TIME_RE = /\b(1[0-2]|0?[1-9])(:[0-5][0-9])?\s?(AM|PM|am|pm)\b/g;

const OFFICE_RE = /\b([A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+)?)\s+office\b/g;

const FILE_NUM_RE = /\b(?:file|order)\s*#?\s*([A-Z0-9-]{4,})/gi;
const LOAN_NUM_RE = /\bloan\s*#?\s*([A-Z0-9-]{4,})/gi;

const NAME_NEAR_ROLE_RE =
  /\b([A-Z][a-z]+\s[A-Z][a-z]+)\s+(?:is the\s+)?(purchase|purchasing|buyer|seller|borrower)\b|\b(buyer|seller|borrower)[:\s]+([A-Z][a-z]+\s[A-Z][a-z]+)/g;

const EXPLICIT_REQUEST_PATTERNS = [
  /please (send|provide|confirm|call|review|advise|forward)/i,
  /can you (send|provide|confirm)/i,
  /could you (send|provide|confirm)/i,
  /we need [^.]*\bby\b/i,
  /\?\s*$/,
];

const IMPLICIT_REQUEST_PATTERNS = [
  /still (have not|haven't|waiting)/i,
  /has not been (received|ordered)/i,
  /have not (received|heard)/i,
  /holding up (underwriting|closing|funding)/i,
  /following up again/i,
  /appears to be missing/i,
  /cannot proceed until/i,
  /wants to know whether/i,
];

const COMPLETION_PATTERNS = [
  /attached (is|please find) the/i,
  /here is the (revised )?(commitment|payoff|cpl|document)/i,
  /confirming receipt/i,
  /this (has been|is) (resolved|completed|ordered|sent)/i,
  /please see attached/i,
];

function detectCategory(text: string): string {
  const lower = text.toLowerCase();
  if (lower.includes("commitment")) return "Commitment revision";
  if (lower.includes("payoff")) return "Payoff follow-up";
  if (lower.includes("cpl")) return "CPL request";
  if (lower.includes("call")) return "Call request";
  if (lower.includes("document") || lower.includes("attach")) return "Document request";
  if (lower.includes("update") || lower.includes("status")) return "Status update";
  if (/\bfriday|monday|tuesday|wednesday|thursday|saturday|sunday|time|schedule|closing at\b/i.test(lower))
    return "Scheduling response";
  return "Other";
}

function detectPriority(text: string): RequestCandidate["priority"] {
  const lower = text.toLowerCase();
  if (lower.includes("urgent") || lower.includes("asap") || lower.includes("holding up"))
    return "urgent";
  if (lower.includes("today") || lower.includes("this morning")) return "high";
  return "normal";
}

function detectDeadlineHint(text: string): RequestCandidate["deadlineHint"] | undefined {
  const lower = text.toLowerCase();
  const byMatch = text.match(/\bby\s+(friday|monday|tuesday|wednesday|thursday|saturday|sunday|tomorrow|eod|end of day|\d{1,2}\/\d{1,2})/i);
  if (byMatch) return { kind: "explicit", text: byMatch[0] };
  if (lower.includes("asap") || lower.includes("urgent"))
    return { kind: "inferred", text: "urgent language detected" };
  if (lower.includes("holding up"))
    return { kind: "inferred", text: "blocking-language detected" };
  return { kind: "office_default", text: "no explicit timing found" };
}

class SimulatedAIProvider implements AIProvider {
  readonly modelVersion = "rule-based-sim-v1";

  async extractFacts(message: EmailMessageRow, threadContext: EmailMessageRow[]): Promise<ExtractedFactCandidate[]> {
    const candidates: ExtractedFactCandidate[] = [];
    const text = `${message.subject}\n${message.bodyText}`;
    const allText = [text, ...threadContext.map((m) => `${m.subject}\n${m.bodyText}`)].join("\n");

    // Address
    for (const m of allText.matchAll(ADDRESS_RE)) {
      candidates.push({
        factType: "PROPERTY_ADDRESS",
        value: m[0].trim(),
        confidence: 0.9,
        evidenceSummary: `Address pattern matched: "${m[0].trim()}"`,
      });
    }

    // Office / location
    for (const m of allText.matchAll(OFFICE_RE)) {
      candidates.push({
        factType: "CLOSING_LOCATION",
        value: `${m[1]} office`,
        confidence: 0.85,
        evidenceSummary: `Location phrase matched: "${m[0]}"`,
      });
    }

    // Day-of-week reference → proposed closing date (needs confirmation)
    const lowerText = text.toLowerCase();
    for (const day of DAY_NAMES) {
      const re = new RegExp(`\\b${day}\\b`, "i");
      if (re.test(lowerText)) {
        const isConfirmatory = /\b(works|confirmed|will be|scheduled for)\b/i.test(text);
        candidates.push({
          factType: "CLOSING_DATE",
          value: { dayOfWeek: day, raw: day },
          confidence: isConfirmatory ? 0.75 : 0.55,
          evidenceSummary: `Day reference "${day}" found${isConfirmatory ? " with confirming language" : ""}`,
        });
      }
    }

    // Time
    for (const m of text.matchAll(TIME_RE)) {
      candidates.push({
        factType: "CLOSING_TIME",
        value: m[0].trim(),
        confidence: 0.85,
        evidenceSummary: `Time pattern matched: "${m[0].trim()}"`,
      });
    }

    // File / loan numbers (require at least one digit — otherwise a bare
    // word like a name can false-positive-match after "file"/"order" text
    // that happens to sit on an adjacent line).
    for (const m of allText.matchAll(FILE_NUM_RE)) {
      if (!/\d/.test(m[1])) continue;
      candidates.push({
        factType: "FILE_NUMBER",
        value: m[1],
        confidence: 0.9,
        evidenceSummary: `File/order number matched: "${m[0].trim()}"`,
      });
    }
    for (const m of allText.matchAll(LOAN_NUM_RE)) {
      if (!/\d/.test(m[1])) continue;
      candidates.push({
        factType: "LOAN_NUMBER",
        value: m[1],
        confidence: 0.9,
        evidenceSummary: `Loan number matched: "${m[0].trim()}"`,
      });
    }

    // Names near role keywords — scan each message's body independently so a
    // capitalized subject word can't bridge into the next message's body via
    // the \s (whitespace, including \n) in the pattern and form a false name.
    for (const bodySrc of [message.bodyText, ...threadContext.map((m) => m.bodyText)]) {
      for (const m of bodySrc.matchAll(NAME_NEAR_ROLE_RE)) {
        const name = m[1] ?? m[4];
        const roleWord = (m[2] ?? m[3] ?? "").toLowerCase();
        const factType = roleWord.includes("sell")
          ? "SELLER_NAME"
          : roleWord.includes("borrow")
          ? "BUYER_NAME"
          : "BUYER_NAME";
        if (name) {
          candidates.push({
            factType,
            value: name,
            confidence: 0.8,
            evidenceSummary: `Name matched near role keyword: "${m[0].trim()}"`,
          });
        }
      }
    }

    // Deadline language (non-task deadlines, e.g. milestone dates)
    if (/rate.?lock|mortgage commitment deadline|recording date|funding date/i.test(text)) {
      candidates.push({
        factType: "MILESTONE",
        value: text.match(/rate.?lock|mortgage commitment deadline|recording date|funding date/i)?.[0],
        confidence: 0.7,
        evidenceSummary: "Transaction milestone language detected",
      });
    }

    return candidates;
  }

  async detectRequests(message: EmailMessageRow): Promise<RequestCandidate[]> {
    if (message.direction !== "INCOMING") return [];
    const results: RequestCandidate[] = [];
    // Split into sentences to allow multiple distinct requests per email.
    const sentences = message.bodyText
      .split(/(?<=[.?!])\s+/)
      .map((s) => s.trim())
      .filter(Boolean);

    for (const sentence of sentences) {
      const explicitHit = EXPLICIT_REQUEST_PATTERNS.some((re) => re.test(sentence));
      const implicitHit = IMPLICIT_REQUEST_PATTERNS.some((re) => re.test(sentence));
      if (!explicitHit && !implicitHit) continue;

      const category = detectCategory(sentence);
      // Scheduling replies (e.g. "Friday works", "2:00 PM works for us") are
      // information, not action-items — filter them out of task detection.
      if (category === "Scheduling response" && !/\?$/.test(sentence) && !/please|can you|confirm/i.test(sentence)) {
        continue;
      }

      results.push({
        isExplicit: explicitHit,
        taskTitle: sentence.length > 90 ? sentence.slice(0, 87) + "…" : sentence,
        category,
        priority: detectPriority(sentence),
        evidenceSummary: `${explicitHit ? "Explicit" : "Implicit"} request language: "${sentence}"`,
        confidence: explicitHit ? 0.88 : 0.68,
        deadlineHint: detectDeadlineHint(sentence),
        waitingCondition: implicitHit && !explicitHit ? sentence : undefined,
      });
    }
    return results;
  }

  async detectCompletionSignal(message: EmailMessageRow): Promise<{ taskHint: string; evidenceSummary: string } | null> {
    if (message.direction !== "OUTGOING") return null;
    for (const re of COMPLETION_PATTERNS) {
      const m = message.bodyText.match(re);
      if (m) {
        return {
          taskHint: detectCategory(message.bodyText),
          evidenceSummary: `Outgoing message contains completion language: "${m[0]}"`,
        };
      }
    }
    return null;
  }
}

export const aiProvider: AIProvider = new SimulatedAIProvider();
