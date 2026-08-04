import "./helpers/test-db";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EmailMessageRow } from "@/types/models";

// These tests never touch the network. `fetch` is replaced with a stub that
// returns responses shaped exactly like the Anthropic API's, so we can prove
// how many calls the provider makes and how it handles bad or missing data.
//
// The provider is imported fresh in each test (`vi.resetModules`) because it
// reads the API key at construction time and keeps a per-instance cache.

const KEY_ENV = "AI_API_KEY";
const MODEL_ENV = "AI_MODEL";

interface StubCall {
  system: string;
  toolName: string;
  schemaKeys: string[];
  body: Record<string, unknown>;
}

let calls: StubCall[] = [];
let realFetch: typeof globalThis.fetch;

/** Build a response in the exact shape the Anthropic messages API returns. */
function apiResponse(toolInput: unknown, toolName = "emit_email_analysis") {
  return new Response(
    JSON.stringify({
      content: [{ type: "tool_use", name: toolName, input: toolInput }],
      usage: { input_tokens: 100, output_tokens: 20 },
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

function stubFetch(handler: (call: StubCall) => Response) {
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Record<string, any>;
    const call: StubCall = {
      system: String(body.system ?? ""),
      toolName: body.tools?.[0]?.name ?? "",
      schemaKeys: Object.keys(body.tools?.[0]?.input_schema?.properties ?? {}),
      body,
    };
    calls.push(call);
    return handler(call);
  }) as unknown as typeof globalThis.fetch;
}

async function freshProvider() {
  vi.resetModules();
  const mod = await import("@/lib/ai/llm-provider");
  return { provider: mod.createLLMAIProvider(), mod };
}

function msg(overrides: Partial<EmailMessageRow> = {}): EmailMessageRow {
  return {
    id: "m-1",
    threadId: "t-1",
    providerMsgId: "p-1",
    fromAddress: "lender@example.com",
    toAddresses: JSON.stringify(["closings@keystonetitle.com"]),
    subject: "88 Rosewood",
    bodyText: "Please send the CPL. Closing Thursday at 10.",
    direction: "INCOMING",
    sentAt: "2026-07-20T09:00:00.000Z",
    quotedText: null,
    ...overrides,
  };
}

const FULL_ANALYSIS = {
  facts: [
    { factType: "PROPERTY_ADDRESS", value: "88 Rosewood", confidence: 0.7, evidenceSummary: "subject line" },
    { factType: "CLOSING_TIME", value: "Thursday at 10", confidence: 0.6, evidenceSummary: "body" },
  ],
  requests: [
    {
      isExplicit: true,
      taskTitle: "Send the CPL",
      category: "CPL request",
      priority: "high",
      evidenceSummary: "Please send the CPL",
      confidence: 0.97,
    },
  ],
};

beforeEach(() => {
  calls = [];
  realFetch = globalThis.fetch;
  process.env[KEY_ENV] = "sk-ant-test-key-not-real";
  process.env[MODEL_ENV] = "claude-sonnet-5";
});

afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env[KEY_ENV];
  delete process.env[MODEL_ENV];
});

describe("one API call per message", () => {
  it("answers facts AND requests from a single call", async () => {
    stubFetch(() => apiResponse(FULL_ANALYSIS));
    const { provider } = await freshProvider();
    const m = msg();

    const facts = await provider.extractFacts(m, []);
    const requests = await provider.detectRequests(m);

    expect(calls).toHaveLength(1);
    expect(facts).toHaveLength(2);
    expect(requests).toHaveLength(1);
    expect(requests[0].taskTitle).toBe("Send the CPL");
  });

  it("prefetchAnalysis warms the same single call the pipeline then reads", async () => {
    stubFetch(() => apiResponse(FULL_ANALYSIS));
    const { provider } = await freshProvider();
    const m = msg();

    await provider.prefetchAnalysis!(m, []);
    await provider.extractFacts(m, []);
    await provider.detectRequests(m);
    await provider.detectCompletionSignal(m);

    expect(calls).toHaveLength(1);
  });

  it("REGRESSION: asking the same question twice does not pay twice", async () => {
    stubFetch(() => apiResponse(FULL_ANALYSIS));
    const { provider } = await freshProvider();
    const m = msg();

    await provider.extractFacts(m, []);
    await provider.extractFacts(m, []);
    await provider.detectRequests(m);

    expect(calls).toHaveLength(1);
  });

  it("still makes a separate call for a different message", async () => {
    stubFetch(() => apiResponse(FULL_ANALYSIS));
    const { provider } = await freshProvider();

    await provider.extractFacts(msg({ id: "m-1" }), []);
    await provider.extractFacts(msg({ id: "m-2" }), []);

    expect(calls).toHaveLength(2);
  });
});

describe("what gets asked, by direction", () => {
  it("asks for requests but not completion on incoming mail", async () => {
    stubFetch(() => apiResponse(FULL_ANALYSIS));
    const { provider } = await freshProvider();
    await provider.extractFacts(msg({ direction: "INCOMING" }), []);

    expect(calls[0].schemaKeys).toContain("facts");
    expect(calls[0].schemaKeys).toContain("requests");
    expect(calls[0].schemaKeys).not.toContain("completion");
  });

  it("asks for completion but not requests on outgoing mail", async () => {
    stubFetch(() => apiResponse({ facts: [], completion: { isCompletion: false } }));
    const { provider } = await freshProvider();
    await provider.extractFacts(msg({ direction: "OUTGOING" }), []);

    expect(calls[0].schemaKeys).toContain("completion");
    expect(calls[0].schemaKeys).not.toContain("requests");
  });

  it("never raises tasks from our own outgoing mail", async () => {
    stubFetch(() => apiResponse({ facts: [], completion: { isCompletion: false } }));
    const { provider } = await freshProvider();
    const out = msg({ direction: "OUTGOING" });

    expect(await provider.detectRequests(out)).toEqual([]);
    expect(calls).toHaveLength(0); // short-circuits before spending anything
  });

  it("never looks for completions in incoming mail", async () => {
    stubFetch(() => apiResponse(FULL_ANALYSIS));
    const { provider } = await freshProvider();

    expect(await provider.detectCompletionSignal(msg({ direction: "INCOMING" }))).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("reports an outgoing completion with its category", async () => {
    stubFetch(() =>
      apiResponse({
        facts: [],
        completion: { isCompletion: true, taskCategory: "Commitment revision", evidenceSummary: "attached the commitment" },
      })
    );
    const { provider } = await freshProvider();
    const signal = await provider.detectCompletionSignal(msg({ direction: "OUTGOING" }));

    expect(signal).toEqual({ taskHint: "Commitment revision", evidenceSummary: "attached the commitment" });
  });
});

describe("the extraction instructions the model receives", () => {
  it("REGRESSION: still forbids inventing an AM/PM the email does not state", async () => {
    // The model wrote "10:00 AM" for an email that only said "Thursday at 10"
    // during the first live run (2026-07-31). This sentence is the fix.
    stubFetch(() => apiResponse(FULL_ANALYSIS));
    const { provider } = await freshProvider();
    await provider.extractFacts(msg(), []);

    expect(calls[0].system).toContain("never add an AM/PM");
    expect(calls[0].system).toContain("record the time exactly as written");
  });

  it("OFFICE RULE: a lender checklist is one task, not one task per bullet", async () => {
    // Decided 2026-07-31. A lender's list of closing/funding requirements is
    // a single piece of work for one person, not eight separate to-dos. But
    // genuinely separate asks must still split — see the assertion below.
    stubFetch(() => apiResponse(FULL_ANALYSIS));
    const { provider } = await freshProvider();
    await provider.extractFacts(msg(), []);

    expect(calls[0].system).toContain("report ONE request covering that list as a whole");
    expect(calls[0].system).toContain("not one per bullet point");
    // ...and the instruction to split genuinely distinct asks survives.
    expect(calls[0].system).toContain("genuinely separate things");
  });

  it("tells the model not to resolve relative dates itself", async () => {
    stubFetch(() => apiResponse(FULL_ANALYSIS));
    const { provider } = await freshProvider();
    await provider.extractFacts(msg(), []);

    expect(calls[0].system).toContain("do not resolve relative");
  });

  it("scopes request detection to the message under review when a thread is supplied", async () => {
    stubFetch(() => apiResponse(FULL_ANALYSIS));
    const { provider } = await freshProvider();
    await provider.extractFacts(msg(), [msg({ id: "m-old", bodyText: "earlier message" })]);

    expect(calls[0].system).toContain("ONLY in the message under review");
    expect(calls[0].body.messages).toBeDefined();
    expect(String((calls[0].body.messages as any)[0].content)).toContain("earlier message");
  });

  it("forces the model to use the tool rather than free text", async () => {
    stubFetch(() => apiResponse(FULL_ANALYSIS));
    const { provider } = await freshProvider();
    await provider.extractFacts(msg(), []);

    expect(calls[0].body.tool_choice).toEqual({ type: "tool", name: "emit_email_analysis" });
  });
});

describe("bad data never reaches the database", () => {
  it("drops a fact whose type the app does not recognise", async () => {
    stubFetch(() =>
      apiResponse({
        facts: [
          { factType: "MOON_PHASE", value: "waxing", confidence: 0.9, evidenceSummary: "nonsense" },
          { factType: "BUYER_NAME", value: "Kowalski", confidence: 0.4, evidenceSummary: "subject" },
        ],
        requests: [],
      })
    );
    const { provider } = await freshProvider();
    const facts = await provider.extractFacts(msg(), []);

    expect(facts).toHaveLength(1);
    expect(facts[0].factType).toBe("BUYER_NAME");
  });

  it("falls back to safe values for an unknown category or priority", async () => {
    stubFetch(() =>
      apiResponse({
        facts: [],
        requests: [
          {
            isExplicit: true,
            taskTitle: "Do the thing",
            category: "Interpretive Dance",
            priority: "SUPER URGENT",
            evidenceSummary: "x",
            confidence: 0.8,
          },
        ],
      })
    );
    const { provider } = await freshProvider();
    const requests = await provider.detectRequests(msg());

    expect(requests[0].category).toBe("Other");
    expect(requests[0].priority).toBe("normal");
  });

  it("clamps a confidence score outside 0-1", async () => {
    stubFetch(() =>
      apiResponse({
        facts: [{ factType: "BUYER_NAME", value: "X", confidence: 4.2, evidenceSummary: "e" }],
        requests: [],
      })
    );
    const { provider } = await freshProvider();
    const facts = await provider.extractFacts(msg(), []);

    expect(facts[0].confidence).toBe(1);
  });

  it("ignores a completion whose category the app does not recognise", async () => {
    stubFetch(() =>
      apiResponse({ facts: [], completion: { isCompletion: true, taskCategory: "Telepathy", evidenceSummary: "x" } })
    );
    const { provider } = await freshProvider();

    expect(await provider.detectCompletionSignal(msg({ direction: "OUTGOING" }))).toBeNull();
  });
});

describe("failures are never mistaken for empty results", () => {
  it("throws rather than reporting no facts when the API is unreachable", async () => {
    globalThis.fetch = (async () => {
      throw new Error("getaddrinfo ENOTFOUND");
    }) as unknown as typeof globalThis.fetch;
    const { provider } = await freshProvider();

    await expect(provider.extractFacts(msg(), [])).rejects.toThrow(/unreachable/i);
  });

  it("surfaces a rejected key verbatim instead of retrying forever", async () => {
    let attempts = 0;
    globalThis.fetch = (async () => {
      attempts++;
      return new Response("invalid x-api-key", { status: 401 });
    }) as unknown as typeof globalThis.fetch;
    const { provider } = await freshProvider();

    await expect(provider.extractFacts(msg(), [])).rejects.toThrow(/AI_API_KEY/);
    expect(attempts).toBe(1); // a bad key is permanent — do not burn retries on it
  });

  it("retries a rate limit and succeeds", async () => {
    let attempts = 0;
    globalThis.fetch = (async () => {
      attempts++;
      if (attempts === 1) return new Response("slow down", { status: 429, headers: { "retry-after": "0" } });
      return apiResponse(FULL_ANALYSIS);
    }) as unknown as typeof globalThis.fetch;
    const { provider } = await freshProvider();

    const facts = await provider.extractFacts(msg(), []);
    expect(attempts).toBe(2);
    expect(facts).toHaveLength(2);
  });

  it("treats 'the model found nothing' as an empty result, not an error", async () => {
    stubFetch(
      () =>
        new Response(JSON.stringify({ content: [{ type: "text", text: "nothing here" }], usage: {} }), {
          status: 200,
        })
    );
    const { provider } = await freshProvider();

    expect(await provider.extractFacts(msg(), [])).toEqual([]);
  });

  it("refuses to start without an API key", async () => {
    delete process.env[KEY_ENV];
    delete process.env.ANTHROPIC_API_KEY;
    vi.resetModules();
    const mod = await import("@/lib/ai/llm-provider");
    expect(() => mod.createLLMAIProvider()).toThrow(/AI_API_KEY/);
  });

  // The documentation is written with vendor-neutral variable names, but
  // nobody should have to edit a working .env.local because a document was
  // rewritten. The old name keeps working; this is that promise, tested.
  it("still accepts the older vendor-specific key name", async () => {
    delete process.env[KEY_ENV];
    process.env.ANTHROPIC_API_KEY = "legacy-key-not-real";
    vi.resetModules();
    const mod = await import("@/lib/ai/llm-provider");
    expect(() => mod.createLLMAIProvider()).not.toThrow();
    delete process.env.ANTHROPIC_API_KEY;
  });
});

describe("cost reporting", () => {
  it("counts calls and tokens so a run can report what it cost", async () => {
    stubFetch(() => apiResponse(FULL_ANALYSIS));
    const { provider, mod } = await freshProvider();
    mod.resetUsageStats();

    await provider.extractFacts(msg({ id: "a" }), []);
    await provider.extractFacts(msg({ id: "b" }), []);

    const stats = mod.getUsageStats();
    expect(stats.apiCalls).toBe(2);
    expect(stats.inputTokens).toBe(200);
    expect(stats.outputTokens).toBe(40);
  });
});
