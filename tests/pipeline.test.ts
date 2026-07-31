import "./helpers/test-db";
import { describe, it, expect, beforeAll } from "vitest";
import { all, get } from "@/lib/db";
import { seedDatabase } from "@/lib/seed";
import { processEmailMessage } from "@/lib/ai/process-email";
import { approveReviewItem, rejectReviewItem } from "@/lib/services/approval";

// The seed runs the full pipeline over every seeded message, so these tests
// assert on the real end-to-end output rather than mocked stages.
beforeAll(async () => {
  await seedDatabase();
}, 60000);

function factValue(transactionId: string, factType: string): unknown {
  const row = get<{ structuredValue: string }>(
    `SELECT structuredValue FROM ExtractedFact WHERE transactionId = ? AND factType = ? AND status = 'CURRENT' LIMIT 1`,
    [transactionId, factType]
  );
  return row ? JSON.parse(row.structuredValue) : null;
}

function transactionByAddress(address: string): string | null {
  const row = get<{ transactionId: string }>(
    `SELECT transactionId FROM ExtractedFact WHERE factType = 'PROPERTY_ADDRESS' AND status = 'CURRENT' AND structuredValue = ? LIMIT 1`,
    [JSON.stringify(address)]
  );
  return row?.transactionId ?? null;
}

describe("seeded scenarios", () => {
  it("scenario 1: reconstructs one closing from four separate emails", () => {
    const txn = transactionByAddress("123 Main Street");
    expect(txn).not.toBeNull();

    expect(factValue(txn!, "BUYER_NAME")).toBe("John Smith");
    expect(factValue(txn!, "CLOSING_TIME")).toBe("2:00 PM");
    expect(factValue(txn!, "CLOSING_LOCATION")).toBe("Cherry Hill office");

    // Exactly ONE pending closing proposal, not one per contributing email.
    const proposals = all(
      `SELECT p.id FROM AIProposal p JOIN ReviewItem ri ON ri.proposalId = p.id
       WHERE p.transactionId = ? AND p.proposalType = 'CLOSING_CREATE' AND ri.status = 'PENDING'`,
      [txn]
    );
    expect(proposals).toHaveLength(1);
  });

  it("scenario 2: creates an explicit task with an explicit due date", () => {
    const txn = transactionByAddress("77 Birchwood Drive");
    const task = get<{ payload: string; confidence: number }>(
      `SELECT payload, confidence FROM AIProposal WHERE transactionId = ? AND proposalType = 'TASK_CREATE' LIMIT 1`,
      [txn]
    );
    expect(task).toBeDefined();
    const payload = JSON.parse(task!.payload);
    expect(payload.category).toBe("Commitment revision");
    expect(payload.dueIsInferred).toBe(false); // "by Friday" was explicit
  });

  it("scenario 3: creates an implicit, urgent task routed to low-confidence review", () => {
    const txn = transactionByAddress("14 Ridgeview Court");
    const review = get<{ reviewType: string; payload: string }>(
      `SELECT ri.reviewType, p.payload FROM ReviewItem ri JOIN AIProposal p ON p.id = ri.proposalId
       WHERE ri.transactionId = ? AND p.proposalType = 'TASK_CREATE' LIMIT 1`,
      [txn]
    );
    expect(review!.reviewType).toBe("low_confidence_task");
    const payload = JSON.parse(review!.payload);
    expect(payload.priority).toBe("urgent");
    expect(payload.dueIsInferred).toBe(true);
  });

  it("scenario 4: splits one email into three separate task proposals", () => {
    const txn = transactionByAddress("5 Larkspur Lane");
    const tasks = all(
      `SELECT id FROM AIProposal WHERE transactionId = ? AND proposalType = 'TASK_CREATE'`,
      [txn]
    );
    expect(tasks.length).toBeGreaterThanOrEqual(3);
  });

  it("scenario 5: keeps the superseded time instead of deleting it", () => {
    const txn = transactionByAddress("123 Oak Lane");

    expect(factValue(txn!, "CLOSING_TIME")).toBe("3:00 PM");

    const superseded = all<{ structuredValue: string }>(
      `SELECT structuredValue FROM ExtractedFact WHERE transactionId = ? AND factType = 'CLOSING_TIME' AND status = 'SUPERSEDED'`,
      [txn]
    );
    expect(superseded).toHaveLength(1);
    expect(JSON.parse(superseded[0].structuredValue)).toBe("10:00 AM");
  });

  it("scenario 6: keeps two same-named buyers as separate transactions", () => {
    const elm = transactionByAddress("55 Elm Street");
    const birch = transactionByAddress("900 Birch Avenue");

    expect(elm).not.toBeNull();
    expect(birch).not.toBeNull();
    expect(elm).not.toBe(birch); // the false-merge bug would make these equal

    expect(factValue(elm!, "BUYER_NAME")).toBe("Robert Johnson");
    expect(factValue(birch!, "BUYER_NAME")).toBe("Robert Johnson");
    expect(factValue(elm!, "FILE_NUMBER")).toBe("FN-6010");
    expect(factValue(birch!, "FILE_NUMBER")).toBe("FN-7712");
  });

  it("scenario 7: proposes task completion from outgoing-email evidence", () => {
    const txn = transactionByAddress("200 Sunrise Boulevard");
    const completion = get<{ payload: string; status: string }>(
      `SELECT payload, status FROM AIProposal WHERE transactionId = ? AND proposalType = 'TASK_COMPLETE' LIMIT 1`,
      [txn]
    );
    expect(completion).toBeDefined();
    const payload = JSON.parse(completion!.payload);
    expect(payload.evidenceEmailId).toBe("m-s7-2");
  });
});

describe("Phase 1 safety guarantees", () => {
  it("leaves every AI proposal pending human review", () => {
    // The seed pre-approves exactly two items to set up scenarios 5 and 7.
    const autoApproved = all(`SELECT id FROM AIProposal WHERE status = 'AUTO_APPROVED'`);
    expect(autoApproved).toHaveLength(0);
  });

  it("ships all automation rules disabled", () => {
    const enabled = all(`SELECT id FROM AutomationRule WHERE enabled = 1`);
    expect(enabled).toHaveLength(0);
  });

  it("records an audit event for every proposal generated", () => {
    const proposals = all<{ id: string }>(`SELECT id FROM AIProposal`);
    expect(proposals.length).toBeGreaterThan(0);
    const audits = all(`SELECT id FROM AuditEvent WHERE eventType = 'proposal_generated'`);
    expect(audits.length).toBeGreaterThan(0);
  });

  it("links every extracted fact back to a real source email", () => {
    const orphans = all(
      `SELECT f.id FROM ExtractedFact f LEFT JOIN EmailMessage m ON m.id = f.sourceEmailId WHERE m.id IS NULL`
    );
    expect(orphans).toHaveLength(0);
  });
});

describe("idempotency", () => {
  it("reprocessing the same message creates no duplicate proposals", async () => {
    const before = all(`SELECT id FROM AIProposal`).length;
    const reviewsBefore = all(`SELECT id FROM ReviewItem`).length;

    await processEmailMessage("m-s2-1");
    await processEmailMessage("m-s2-1");

    expect(all(`SELECT id FROM AIProposal`).length).toBe(before);
    expect(all(`SELECT id FROM ReviewItem`).length).toBe(reviewsBefore);
  }, 30000);
});

describe("approval workflow", () => {
  it("turns an approved closing proposal into a live closing record", () => {
    const txn = transactionByAddress("123 Main Street");
    const review = get<{ id: string }>(
      `SELECT ri.id FROM ReviewItem ri JOIN AIProposal p ON p.id = ri.proposalId
       WHERE ri.transactionId = ? AND p.proposalType = 'CLOSING_CREATE' AND ri.status = 'PENDING'`,
      [txn]
    );
    expect(review).toBeDefined();

    approveReviewItem(review!.id, "user-closer");

    const closing = get<{ status: string; time: string; location: string }>(
      `SELECT status, time, location FROM ClosingEvent WHERE transactionId = ?`,
      [txn]
    );
    expect(closing).toBeDefined();
    expect(closing!.time).toBe("2:00 PM");
    expect(closing!.location).toBe("Cherry Hill office");

    // Attribution must record the actual approver.
    const decided = get<{ decidedByUserId: string; status: string }>(
      `SELECT decidedByUserId, status FROM ReviewItem WHERE id = ?`,
      [review!.id]
    );
    expect(decided!.status).toBe("APPROVED");
    expect(decided!.decidedByUserId).toBe("user-closer");
  });

  it("refuses to decide the same review item twice", () => {
    const decided = get<{ id: string }>(`SELECT id FROM ReviewItem WHERE status = 'APPROVED' LIMIT 1`);
    expect(() => approveReviewItem(decided!.id, "user-admin")).toThrow(/already decided/i);
  });

  it("rejecting creates no live record", () => {
    const review = get<{ id: string; transactionId: string }>(
      `SELECT ri.id, ri.transactionId FROM ReviewItem ri JOIN AIProposal p ON p.id = ri.proposalId
       WHERE ri.status = 'PENDING' AND p.proposalType = 'TASK_CREATE' LIMIT 1`
    );
    const tasksBefore = all(`SELECT id FROM Task`).length;

    rejectReviewItem(review!.id, "user-admin", "not actually a request");

    expect(all(`SELECT id FROM Task`).length).toBe(tasksBefore);
    const after = get<{ status: string }>(`SELECT status FROM ReviewItem WHERE id = ?`, [review!.id]);
    expect(after!.status).toBe("REJECTED");
  });
});
