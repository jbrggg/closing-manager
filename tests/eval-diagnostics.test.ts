import "./helpers/test-db";
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { all, run, nowIso } from "@/lib/db";
import { processEmailMessage, MATCHED_FACT_TYPES } from "@/lib/ai/process-email";
import { readStrongMatchThreshold } from "../scripts/match-threshold.mts";
import { explainFiling } from "../scripts/explain-filing.mts";
import type { EvalCaseResult, MatchEvidence } from "../scripts/eval-types.mts";

// The filing diagnostic exists because "WRONG FILE" on its own says something
// is broken without saying what. These tests pin down the two halves of it:
// that the pipeline records WHY it filed where it did, and that the explainer
// turns that record into English a non-developer can act on.

const ORG_ID = "org-demo";
const ACCOUNT = "closings@keystonetitle.com";
const ROOT = path.resolve(import.meta.dirname, "..");

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

function addMessage(id: string, subject: string, body: string) {
  const threadId = `thr-${id}`;
  run(`INSERT INTO EmailThread (id, emailAccountId, subject, participants, createdAt) VALUES (?, ?, ?, ?, ?)`, [
    threadId,
    "acct-diag",
    subject,
    JSON.stringify(["broker@example.com", ACCOUNT]),
    nowIso(),
  ]);
  run(
    `INSERT INTO EmailMessage (id, threadId, providerMsgId, fromAddress, toAddresses, subject, bodyText, direction, sentAt, quotedText)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'INCOMING', ?, NULL)`,
    [id, threadId, `p-${id}`, "broker@example.com", JSON.stringify([ACCOUNT]), subject, body, nowIso()]
  );
  return id;
}

/** The structured detail written alongside the most recent matching decision. */
function latestMatchDetail(): Record<string, unknown> | null {
  const row = all<{ detail: string | null }>(
    `SELECT detail FROM AuditEvent WHERE eventType = 'transaction_matched' ORDER BY rowid DESC LIMIT 1`
  )[0];
  return row?.detail ? JSON.parse(row.detail) : null;
}

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
  seedMinimal("acct-diag");
});

describe("the pipeline records why an email was filed where it was", () => {
  it("records the score, the reasons, and what it had to match on", async () => {
    addMessage(
      "m-first",
      "New order - 412 Maple Ave",
      "Opening a new file for 412 Maple Ave. Buyer is Denise Okafor. Our file number is SS-77120."
    );
    await processEmailMessage("m-first");

    const detail = latestMatchDetail();
    expect(detail).not.toBeNull();
    expect(detail).toMatchObject({ score: 0, isStrongMatch: false, transactionsConsidered: 0 });

    // The whole point: it says what the email offered up to be matched on,
    // so a score of 0 can be told apart from "extracted nothing".
    const identifiers = detail!.identifiersExtracted as { type: string; value: string }[];
    expect(identifiers.length).toBeGreaterThan(0);
    expect(identifiers.map((i) => i.type)).toContain("PROPERTY_ADDRESS");
  });

  // The word-matcher used by the test suite does not pick up file numbers, so
  // a second email about the same property matches on the address alone: 45
  // points against a threshold of 60. That is not a bug — it is invariant 4
  // doing its job, and it is the exact shape of the real split-file case in
  // ROADMAP D1. It also makes a deterministic near-miss fixture.
  it("records the score and the reason for a near miss that does not link", async () => {
    addMessage(
      "m-first",
      "New order - 412 Maple Ave",
      "Opening a new file for 412 Maple Ave. Buyer is Denise Okafor. Our file number is SS-77120."
    );
    await processEmailMessage("m-first");

    addMessage(
      "m-second",
      "RE: New order - 412 Maple Ave",
      "Following up on SS-77120 - can we do Wednesday at 11 at the Cherry Hill office?"
    );
    await processEmailMessage("m-second");

    const detail = latestMatchDetail();
    expect(detail!.transactionsConsidered).toBe(1);
    expect(detail!.score).toBe(45);
    expect(detail!.isStrongMatch).toBe(false);
    expect((detail!.reasons as string[]).join(" ")).toMatch(/property address/i);
  });

  it("does not report the same identifier twice just because two emails carried it", async () => {
    addMessage("m-first", "New order - 412 Maple Ave", "Opening a new file for 412 Maple Ave.");
    await processEmailMessage("m-first");
    addMessage("m-second", "RE: New order - 412 Maple Ave", "Following up on 412 Maple Ave, any update?");
    await processEmailMessage("m-second");

    const identifiers = latestMatchDetail()!.identifiersExtracted as { type: string; value: string }[];
    const keys = identifiers.map((i) => `${i.type}::${i.value}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("the threshold is read from match.ts, never copied", () => {
  it("finds the real strong-match threshold", () => {
    expect(readStrongMatchThreshold(ROOT)).toBe(60);
  });

  it("returns null rather than a guess when it cannot read the file", () => {
    expect(readStrongMatchThreshold(path.join(ROOT, "no-such-folder"))).toBeNull();
  });
});

describe("the diagnostic stays in step with what match.ts actually scores", () => {
  // If someone adds a new signal to match.ts and forgets this list, the
  // diagnostic would quietly stop mentioning it and start giving misleading
  // explanations. Fail loudly instead. This reads match.ts; it does not
  // change it (invariant 4).
  it("knows about every fact type match.ts scores on", () => {
    const source = fs.readFileSync(path.join(ROOT, "src", "lib", "ai", "match.ts"), "utf-8");
    const scored = new Set(
      [...source.matchAll(/fact\.factType === "([A-Z_]+)"/g)].map((m) => m[1])
    );
    expect(scored.size).toBeGreaterThan(0);
    expect([...scored].sort()).toEqual([...MATCHED_FACT_TYPES].sort());
  });
});

function resultWith(match: MatchEvidence | null, duplicateFlagged = false): EvalCaseResult {
  return {
    id: "case",
    group: "case",
    passed: false,
    findings: [],
    observed: { facts: [], tasks: [], filing: "new", duplicateFlagged, match },
    elapsedMs: 1,
  };
}

const NEAR_MISS: MatchEvidence = {
  score: 45,
  isStrongMatch: false,
  reasons: ['Matching property address ("1274 Danforth Ave")'],
  bestCandidateTransactionId: "txn-aaaaaaaa-1111",
  transactionsConsidered: 1,
  identifiersExtracted: [{ type: "PROPERTY_ADDRESS", value: "1274 Danforth Ave" }],
  filedOnTransactionId: "txn-bbbbbbbb-2222",
  otherFiles: [
    {
      transactionId: "txn-aaaaaaaa-1111",
      identifiers: [
        { type: "PROPERTY_ADDRESS", value: "1274 Danforth Ave" },
        { type: "LOAN_NUMBER", value: "2607093481" },
      ],
    },
  ],
};

describe("explaining a filing decision in plain English", () => {
  it("separates an extraction failure from a matching failure", () => {
    const text = explainFiling(
      resultWith({ ...NEAR_MISS, score: 0, reasons: [], identifiersExtracted: [], otherFiles: [] }),
      60
    ).join("\n");

    expect(text).toMatch(/extracted no identifying facts at all/);
    expect(text).toMatch(/extraction failure, not a matching failure/);
  });

  it("names the score, the threshold, and what would have linked the two files", () => {
    const text = explainFiling(resultWith(NEAR_MISS), 60).join("\n");

    expect(text).toMatch(/scored 45 of the 60 needed/);
    expect(text).toMatch(/not enough to link/);
    expect(text).toMatch(/Matching property address/);
    // The actionable half: the loan number is on the other file and was not
    // extracted here, and extracting it is what would have joined them.
    expect(text).toMatch(/Not extracted from this email: loan number "2607093481"/);
  });

  it("points out when a near miss should have raised the duplicate flag", () => {
    expect(explainFiling(resultWith(NEAR_MISS, false), 60).join("\n")).toMatch(/no flag was raised/);
    expect(explainFiling(resultWith(NEAR_MISS, true), 60).join("\n")).not.toMatch(/no flag was raised/);
  });

  it("says the threshold is unknown rather than inventing one", () => {
    const text = explainFiling(resultWith(NEAR_MISS), null).join("\n");
    expect(text).toMatch(/could not read it from match\.ts/);
    expect(text).not.toMatch(/\b60\b/);
  });

  it("says so plainly when matching never ran", () => {
    expect(explainFiling(resultWith(null), 60).join("\n")).toMatch(/stopped before it got as far as matching/);
  });

  it("does not blame the matcher when there was nothing to match against", () => {
    const text = explainFiling(
      resultWith({ ...NEAR_MISS, score: 0, reasons: [], transactionsConsidered: 0, otherFiles: [] }),
      60
    ).join("\n");
    expect(text).toMatch(/no existing files to compare against/i);
  });
});
