import "./helpers/test-db";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { all, run, nowIso } from "@/lib/db";

// End-to-end proof that the whole pipeline, running against the REAL LLM
// provider, makes one network call per message rather than one per question.
//
// `fetch` is stubbed, so no network traffic and no API spend — but every other
// layer is the real thing: the real provider, the real process-email
// orchestrator, the real database writes.

const ORG_ID = "org-demo";
const ACCOUNT = "closings@keystonetitle.com";

let calls: { direction: "incoming-shaped" | "outgoing-shaped"; system: string }[] = [];
let realFetch: typeof globalThis.fetch;
let concurrentPeak = 0;
let inFlight = 0;

function seedMinimal(accountId: string) {
  run(`INSERT OR IGNORE INTO Organization (id, name, timezone, createdAt) VALUES (?, ?, ?, ?)`, [
    ORG_ID,
    "Keystone Title (test fixture)",
    "America/New_York",
    nowIso(),
  ]);
  run(
    `INSERT OR IGNORE INTO EmailAccount (id, organizationId, providerType, emailAddress, connected) VALUES (?, ?, 'MOCK', ?, 1)`,
    [accountId, ORG_ID, ACCOUNT]
  );
}

function addMessage(threadId: string, index: number, body: string, direction: "INCOMING" | "OUTGOING" = "INCOMING") {
  const id = `msg-${threadId}-${index}`;
  run(
    `INSERT INTO EmailMessage (id, threadId, providerMsgId, fromAddress, toAddresses, subject, bodyText, direction, sentAt, quotedText)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    [
      id,
      threadId,
      `p-${id}`,
      direction === "INCOMING" ? "lender@example.com" : ACCOUNT,
      JSON.stringify([direction === "INCOMING" ? ACCOUNT : "lender@example.com"]),
      "412 Maple Ave",
      body,
      direction,
      new Date(Date.UTC(2026, 6, 20, 9, index)).toISOString(),
    ]
  );
  return id;
}

/**
 * Every test in a file shares one database (see helpers/test-db). Left alone,
 * mail from an earlier test stays in the mailbox and the pipeline's
 * mailbox-wide search legitimately finds it — which is correct behaviour but
 * makes call counts impossible to reason about. Start each test with an empty
 * mailbox instead.
 */
function emptyTheMailbox() {
  for (const table of [
    "EmailMessage",
    "EmailThread",
    "ExtractedFact",
    "AIProposal",
    "ReviewItem",
    "TransactionRecord",
    "AuditEvent",
    "AIProcessingJob",
    "Task",
  ]) {
    run(`DELETE FROM ${table}`);
  }
}

beforeEach(() => {
  emptyTheMailbox();
  calls = [];
  concurrentPeak = 0;
  inFlight = 0;
  realFetch = globalThis.fetch;
  process.env.AI_PROVIDER = "llm";
  process.env.ANTHROPIC_API_KEY = "sk-ant-test-key-not-real";
  process.env.ANTHROPIC_MODEL = "claude-sonnet-5";

  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    inFlight++;
    concurrentPeak = Math.max(concurrentPeak, inFlight);
    const body = JSON.parse(String(init.body)) as Record<string, any>;
    const schemaKeys = Object.keys(body.tools?.[0]?.input_schema?.properties ?? {});
    calls.push({
      direction: schemaKeys.includes("requests") ? "incoming-shaped" : "outgoing-shaped",
      system: String(body.system ?? ""),
    });

    // Small delay so genuinely-parallel calls overlap and concurrentPeak > 1.
    await new Promise((r) => setTimeout(r, 25));
    inFlight--;

    return new Response(
      JSON.stringify({
        content: [
          {
            type: "tool_use",
            name: "emit_email_analysis",
            input: {
              facts: [
                { factType: "PROPERTY_ADDRESS", value: "412 Maple Ave", confidence: 0.9, evidenceSummary: "subject" },
                { factType: "FILE_NUMBER", value: "SS-77120", confidence: 0.95, evidenceSummary: "body" },
              ],
              requests: schemaKeys.includes("requests")
                ? [
                    {
                      isExplicit: true,
                      taskTitle: "Send the CPL",
                      category: "CPL request",
                      priority: "high",
                      evidenceSummary: "please send the CPL",
                      confidence: 0.95,
                    },
                  ]
                : undefined,
              completion: schemaKeys.includes("completion") ? { isCompletion: false } : undefined,
            },
          },
        ],
        usage: { input_tokens: 500, output_tokens: 80 },
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }) as unknown as typeof globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.AI_PROVIDER;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_MODEL;
});

async function freshPipeline() {
  vi.resetModules();
  const mod = await import("@/lib/ai/process-email");
  return mod.processEmailMessage;
}

describe("pipeline cost, running against the real LLM provider", () => {
  it("a one-message email costs ONE API call, not two", async () => {
    const accountId = `acct-${randomUUID().slice(0, 8)}`;
    seedMinimal(accountId);
    const threadId = `thread-${randomUUID().slice(0, 8)}`;
    run(`INSERT INTO EmailThread (id, emailAccountId, subject, participants, createdAt) VALUES (?, ?, ?, ?, ?)`, [
      threadId,
      accountId,
      "412 Maple Ave",
      JSON.stringify(["lender@example.com", ACCOUNT]),
      nowIso(),
    ]);
    const messageId = addMessage(threadId, 0, "Please send the CPL for SS-77120. Closing Thursday at 10.");

    const processEmailMessage = await freshPipeline();
    await processEmailMessage(messageId);

    // Before this change: one call for facts + one call for requests = 2.
    expect(calls).toHaveLength(1);
    expect(calls[0].direction).toBe("incoming-shaped");

    // ...and it still produced the same records.
    const facts = all(`SELECT id FROM ExtractedFact WHERE sourceEmailId = ?`, [messageId]);
    expect(facts.length).toBeGreaterThan(0);
    const tasks = all(`SELECT id FROM AIProposal WHERE proposalType = 'TASK_CREATE' AND sourceEmailIds LIKE ?`, [
      `%${messageId}%`,
    ]);
    expect(tasks).toHaveLength(1);
  });

  it("a four-message thread costs FOUR calls and reads them at the same time", async () => {
    const accountId = `acct-${randomUUID().slice(0, 8)}`;
    seedMinimal(accountId);
    const threadId = `thread-${randomUUID().slice(0, 8)}`;
    run(`INSERT INTO EmailThread (id, emailAccountId, subject, participants, createdAt) VALUES (?, ?, ?, ?, ?)`, [
      threadId,
      accountId,
      "412 Maple Ave",
      JSON.stringify(["lender@example.com", ACCOUNT]),
      nowIso(),
    ]);
    addMessage(threadId, 0, "Opening the file for 412 Maple Ave, ours is SS-77120.");
    addMessage(threadId, 1, "Thanks, noted.", "OUTGOING");
    addMessage(threadId, 2, "Any update on the commitment?");
    const latest = addMessage(threadId, 3, "Please send the CPL for SS-77120.");

    const processEmailMessage = await freshPipeline();
    await processEmailMessage(latest);

    // One call per message in the thread. Before: 4 extractions + 1 separate
    // request-detection call = 5, and all of them one after another.
    expect(calls).toHaveLength(4);

    // Proof they overlapped rather than running in sequence.
    expect(concurrentPeak).toBeGreaterThan(1);
  });

  it("an outgoing message is asked about completion, never about tasks", async () => {
    const accountId = `acct-${randomUUID().slice(0, 8)}`;
    seedMinimal(accountId);
    const threadId = `thread-${randomUUID().slice(0, 8)}`;
    run(`INSERT INTO EmailThread (id, emailAccountId, subject, participants, createdAt) VALUES (?, ?, ?, ?, ?)`, [
      threadId,
      accountId,
      "412 Maple Ave",
      JSON.stringify(["lender@example.com", ACCOUNT]),
      nowIso(),
    ]);
    const messageId = addMessage(threadId, 0, "Please see attached the revised commitment.", "OUTGOING");

    const processEmailMessage = await freshPipeline();
    await processEmailMessage(messageId);

    expect(calls).toHaveLength(1);
    expect(calls[0].direction).toBe("outgoing-shaped");
    expect(
      all(`SELECT id FROM AIProposal WHERE proposalType = 'TASK_CREATE' AND sourceEmailIds LIKE ?`, [`%${messageId}%`])
    ).toHaveLength(0);
  });
});
