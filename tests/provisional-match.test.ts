import "./helpers/test-db";
import { describe, it, expect, beforeEach } from "vitest";
import { all, get, run, nowIso } from "@/lib/db";
import { processEmailMessage } from "@/lib/ai/process-email";
import { approveReviewItem, rejectReviewItem } from "@/lib/services/approval";

// Office decision, 2026-07-31: an email that agrees on the property address and
// nothing else should go ON the file with a warning, rather than starting a
// second file or firing a duplicate flag.
//
// That is a weaker link than the app makes anywhere else — address agreement is
// 45 of the 60 a strong match needs — so what these tests really pin down is
// the safety around it: the warning always appears, it is never auto-approved,
// two files sharing an address stay ambiguous, and saying "no" actually takes
// the email back off the file.

const ORG_ID = "org-demo";
const ACCOUNT = "closings@keystonetitle.com";

function seed() {
  run(`INSERT OR IGNORE INTO Organization (id, name, timezone, createdAt) VALUES (?,?,?,?)`, [
    ORG_ID,
    "Keystone Title (test fixture)",
    "America/New_York",
    nowIso(),
  ]);
  run(
    `INSERT OR IGNORE INTO EmailAccount (id, organizationId, providerType, emailAddress, connected) VALUES (?,?,?,?,1)`,
    ["acct-pm", ORG_ID, "MOCK", ACCOUNT]
  );
}

function addMessage(id: string, subject: string, body: string) {
  run(`INSERT INTO EmailThread (id, emailAccountId, subject, participants, createdAt) VALUES (?,?,?,?,?)`, [
    `thr-${id}`,
    "acct-pm",
    subject,
    JSON.stringify(["broker@example.com", ACCOUNT]),
    nowIso(),
  ]);
  run(
    `INSERT INTO EmailMessage (id, threadId, providerMsgId, fromAddress, toAddresses, subject, bodyText, direction, sentAt, quotedText)
     VALUES (?,?,?,?,?,?,?,'INCOMING',?,NULL)`,
    [id, `thr-${id}`, `p-${id}`, "broker@example.com", JSON.stringify([ACCOUNT]), subject, body, nowIso()]
  );
}

function emptyTheMailbox() {
  for (const t of [
    "EmailMessage", "EmailThread", "ExtractedFact", "AIProposal", "ReviewItem",
    "TransactionRecord", "AuditEvent", "AIProcessingJob", "Task", "ProvisionalMatch",
  ]) {
    run(`DELETE FROM ${t}`);
  }
}

beforeEach(() => {
  emptyTheMailbox();
  seed();
});

/** The Danforth shape: one email opens the file, a second shares only the
 *  address — and writes it at a different level of detail. */
async function twoEmailsSharingOnlyTheAddress() {
  addMessage("m-open", "New order - 1274 Danforth Ave., Jersey City NJ", "Opening a new file for 1274 Danforth Ave., Jersey City NJ.");
  await processEmailMessage("m-open");
  // The closing date is deliberately something match.ts does NOT score, so the
  // link stays address-only while the email still contributes a new fact —
  // which is what the undo has to be able to move back out.
  addMessage(
    "m-search",
    "Search ordered - 1274 Danforth Ave",
    "Search request sent to the abstractor for 1274 Danforth Ave. Closing is Wednesday."
  );
  await processEmailMessage("m-search");
}

const linkReview = () =>
  get<{ id: string; transactionId: string; reason: string; status: string }>(
    `SELECT ri.id, ri.transactionId, ri.reason, ri.status FROM ReviewItem ri
     JOIN AIProposal p ON p.id = ri.proposalId WHERE p.proposalType = 'TRANSACTION_LINK'`
  );

describe("an email that agrees on the address alone", () => {
  it("goes onto the existing file instead of starting a second one", async () => {
    await twoEmailsSharingOnlyTheAddress();

    // One file, not two. This is the whole point of the change.
    expect(all(`SELECT id FROM TransactionRecord`)).toHaveLength(1);
    const facts = all<{ transactionId: string }>(`SELECT transactionId FROM ExtractedFact WHERE sourceEmailId = ?`, ["m-search"]);
    expect(facts.length).toBeGreaterThan(0);
  });

  it("always raises the missing-file-number warning", async () => {
    await twoEmailsSharingOnlyTheAddress();
    const review = linkReview();
    expect(review).toBeDefined();
    expect(review!.status).toBe("PENDING");
    expect(review!.reason).toMatch(/no file number/i);
  });

  it("is not flagged as a duplicate — it was matched, not split", async () => {
    await twoEmailsSharingOnlyTheAddress();
    const dupes = all(`SELECT id FROM ReviewItem WHERE duplicateCandidates IS NOT NULL`);
    expect(dupes).toHaveLength(0);
  });

  it("records what it wrote, so the link can be taken back", async () => {
    await twoEmailsSharingOnlyTheAddress();
    const pm = get<{ movedFactIds: string; status: string }>(`SELECT movedFactIds, status FROM ProvisionalMatch`);
    expect(pm!.status).toBe("ACTIVE");
    expect((JSON.parse(pm!.movedFactIds) as string[]).length).toBeGreaterThan(0);
  });
});

describe("the human decision on an address-only link", () => {
  it("approving leaves the email where it is and closes the warning", async () => {
    await twoEmailsSharingOnlyTheAddress();
    const review = linkReview()!;

    approveReviewItem(review.id, "user-admin");

    expect(all(`SELECT id FROM TransactionRecord`)).toHaveLength(1);
    expect(get<{ status: string }>(`SELECT status FROM ProvisionalMatch`)!.status).toBe("CONFIRMED");
    expect(get<{ decidedByUserId: string }>(`SELECT decidedByUserId FROM ReviewItem WHERE id = ?`, [review.id])!
      .decidedByUserId).toBe("user-admin");
  });

  it("rejecting actually takes the email back off the file", async () => {
    await twoEmailsSharingOnlyTheAddress();
    const review = linkReview()!;
    const joinedFile = review.transactionId;
    const before = all<{ id: string }>(`SELECT id FROM ExtractedFact WHERE sourceEmailId = ?`, ["m-search"]).length;
    expect(before).toBeGreaterThan(0);

    rejectReviewItem(review.id, "user-admin", "different deal on the same property");

    // A second file now exists and the email's facts are on it, not the first.
    expect(all(`SELECT id FROM TransactionRecord`)).toHaveLength(2);
    const moved = all<{ transactionId: string }>(`SELECT transactionId FROM ExtractedFact WHERE sourceEmailId = ?`, ["m-search"]);
    expect(moved).toHaveLength(before);
    expect(moved.every((f) => f.transactionId !== joinedFile)).toBe(true);

    // Invariant 2: nothing was deleted on the way.
    expect(all(`SELECT id FROM ExtractedFact`).length).toBeGreaterThanOrEqual(before);
    expect(get<{ status: string }>(`SELECT status FROM ProvisionalMatch`)!.status).toBe("UNDONE");
  });

  it("leaves the first email's own facts alone when the link is rejected", async () => {
    await twoEmailsSharingOnlyTheAddress();
    const review = linkReview()!;
    const originals = all<{ id: string; transactionId: string }>(
      `SELECT id, transactionId FROM ExtractedFact WHERE sourceEmailId = ?`, ["m-open"]
    );

    rejectReviewItem(review.id, "user-admin");

    for (const o of originals) {
      const now = get<{ transactionId: string }>(`SELECT transactionId FROM ExtractedFact WHERE id = ?`, [o.id]);
      expect(now!.transactionId).toBe(o.transactionId);
    }
  });
});

describe("the guards that make an address-only link safe enough to make", () => {
  it("refuses when two files share the address — sale then refinance stays ambiguous", async () => {
    // Two separate deals on one property, linked by nothing but the address.
    addMessage("m-sale", "Sale - 1274 Danforth Ave., Jersey City NJ", "Opening a file for 1274 Danforth Ave., Jersey City NJ. File number KT-1000.");
    await processEmailMessage("m-sale");
    run(`UPDATE ExtractedFact SET transactionId = ? WHERE sourceEmailId = ?`, ["txn-refi", "m-sale"]);
    run(
      `INSERT INTO TransactionRecord (id, organizationId, officeId, propertyId, fileNumber, loanNumber, transactionType, status, createdAt, updatedAt)
       VALUES ('txn-refi', ?, NULL, NULL, NULL, NULL, NULL, 'POTENTIAL', ?, ?)`,
      [ORG_ID, nowIso(), nowIso()]
    );
    // Copy the address onto the original file too, so BOTH agree on it.
    const addr = get<{ structuredValue: string }>(
      `SELECT structuredValue FROM ExtractedFact WHERE factType = 'PROPERTY_ADDRESS' LIMIT 1`
    )!.structuredValue;
    const firstTxn = get<{ id: string }>(`SELECT id FROM TransactionRecord WHERE id != 'txn-refi' LIMIT 1`)!.id;
    run(
      `INSERT INTO ExtractedFact (id, transactionId, factType, structuredValue, sourceEmailId, sourceThreadId, sourceTimestamp, sourceSender, evidenceSummary, confidence, status, supersedesId, extractedAt, modelVersion)
       VALUES ('f-dup', ?, 'PROPERTY_ADDRESS', ?, 'm-sale', 'thr-m-sale', ?, 'x@y.com', 'fixture', 1, 'CURRENT', NULL, ?, 'test')`,
      [firstTxn, addr, nowIso(), nowIso()]
    );

    addMessage("m-later", "Search ordered - 1274 Danforth Ave", "Search request sent for 1274 Danforth Ave.");
    await processEmailMessage("m-later");

    // Two candidates agree on the address, so it must NOT pick one.
    expect(linkReview()).toBeUndefined();
    const facts = all<{ transactionId: string }>(`SELECT transactionId FROM ExtractedFact WHERE sourceEmailId = ?`, ["m-later"]);
    expect(facts.every((f) => f.transactionId !== firstTxn && f.transactionId !== "txn-refi")).toBe(true);
  });

  it("never auto-approves, whatever an automation rule says", async () => {
    // Phase 1 ships every rule disabled (invariant 1), but this link is
    // excluded from auto-approval by construction, not just by configuration.
    run(`UPDATE AutomationRule SET enabled = 1, minConfidence = 0 WHERE actionType = 'TRANSACTION_MERGE'`);
    await twoEmailsSharingOnlyTheAddress();
    expect(linkReview()!.status).toBe("PENDING");
  });
});
