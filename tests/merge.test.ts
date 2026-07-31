import "./helpers/test-db";
import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { all, get, run, nowIso } from "@/lib/db";
import { mergeTransactions, previewMerge, reverseMerge } from "@/lib/services/merge";

// Merge rewrites which file every fact, task and closing belongs to. The two
// properties that matter most are that nothing is lost and that a mistake can
// be undone — both are asserted directly here.

const ORG = "org-demo";

function makeTransaction(status = "POTENTIAL"): string {
  const id = randomUUID();
  run(
    `INSERT INTO TransactionRecord (id, organizationId, officeId, propertyId, fileNumber, loanNumber, transactionType, status, createdAt, updatedAt)
     VALUES (?, ?, NULL, NULL, NULL, NULL, NULL, ?, ?, ?)`,
    [id, ORG, status, nowIso(), nowIso()]
  );
  return id;
}

function addFact(transactionId: string, factType: string, value: unknown, sentAt = "2026-07-01T10:00:00.000Z"): string {
  const id = randomUUID();
  run(
    `INSERT INTO ExtractedFact (id, transactionId, factType, structuredValue, sourceEmailId, sourceThreadId, sourceTimestamp, sourceSender, evidenceSummary, confidence, status, supersedesId, extractedAt, modelVersion)
     VALUES (?, ?, ?, ?, 'm-1', 't-1', ?, 'someone@example.com', 'evidence', 0.9, 'CURRENT', NULL, ?, 'test')`,
    [id, transactionId, factType, JSON.stringify(value), sentAt, nowIso()]
  );
  return id;
}

function addTask(transactionId: string, title: string): string {
  const id = randomUUID();
  run(
    `INSERT INTO Task (id, transactionId, title, category, priority, status, assignedUserId, requester, dueAt, dueIsInferred, waitingCondition, sourceEmailId, confidence, createdAt)
     VALUES (?, ?, ?, 'Other', 'normal', 'OPEN', NULL, 'x@y.com', ?, 0, NULL, 'm-1', 0.9, ?)`,
    [id, transactionId, title, nowIso(), nowIso()]
  );
  return id;
}

function addClosing(transactionId: string): string {
  const id = randomUUID();
  run(
    `INSERT INTO ClosingEvent (id, transactionId, status, date, time, timezone, location, locationTBD, createdAt)
     VALUES (?, ?, 'TENTATIVE', ?, '2:00 PM', 'America/New_York', 'Cherry Hill office', 0, ?)`,
    [id, transactionId, JSON.stringify({ raw: "friday" }), nowIso()]
  );
  return id;
}

beforeEach(() => {
  for (const t of [
    "ExtractedFact",
    "Task",
    "ClosingEvent",
    "AIProposal",
    "ReviewItem",
    "TransactionParticipant",
    "TransactionRecord",
    "TransactionMerge",
    "AuditEvent",
  ]) {
    run(`DELETE FROM ${t}`);
  }
});

describe("merge preview", () => {
  it("counts what would move without moving anything", () => {
    const a = makeTransaction();
    const b = makeTransaction();
    addFact(b, "BUYER_NAME", "Kowalski");
    addFact(b, "LOAN_NUMBER", "LN-44821");
    addTask(b, "Send the CPL");

    const preview = previewMerge(a, b);

    expect(preview.moves.ExtractedFact).toBe(2);
    expect(preview.moves.Task).toBe(1);
    // ...and nothing actually moved.
    expect(all(`SELECT id FROM ExtractedFact WHERE transactionId = ?`, [a])).toHaveLength(0);
    expect(all(`SELECT id FROM ExtractedFact WHERE transactionId = ?`, [b])).toHaveLength(2);
  });

  it("shows which details disagree before the user commits", () => {
    const a = makeTransaction();
    const b = makeTransaction();
    addFact(a, "CLOSING_TIME", "2:00 PM");
    addFact(b, "CLOSING_TIME", "3:00 PM");

    const preview = previewMerge(a, b);

    expect(preview.conflicts).toHaveLength(1);
    expect(preview.conflicts[0]).toMatchObject({
      factType: "CLOSING_TIME",
      keptValue: "2:00 PM",
      supersededValue: "3:00 PM",
    });
  });

  it("warns when the two files name different properties", () => {
    const a = makeTransaction();
    const b = makeTransaction();
    addFact(a, "PROPERTY_ADDRESS", "123 Main Street");
    addFact(b, "PROPERTY_ADDRESS", "900 Birch Avenue");

    expect(previewMerge(a, b).warnings.join(" ")).toMatch(/different property addresses/i);
  });

  it("warns when both files already have a closing scheduled", () => {
    const a = makeTransaction();
    const b = makeTransaction();
    addClosing(a);
    addClosing(b);

    expect(previewMerge(a, b).warnings.join(" ")).toMatch(/both files already have a closing/i);
  });

  it("refuses to merge a transaction into itself", () => {
    const a = makeTransaction();
    expect(() => previewMerge(a, a)).toThrow(/into itself/i);
  });
});

describe("merging", () => {
  it("moves every kind of record onto the surviving file", () => {
    const a = makeTransaction();
    const b = makeTransaction();
    addFact(b, "BUYER_NAME", "Kowalski");
    addTask(b, "Send the CPL");
    addClosing(b);

    const result = mergeTransactions(a, b, "user-admin");

    expect(result.movedRows).toBe(3);
    expect(all(`SELECT id FROM ExtractedFact WHERE transactionId = ?`, [a])).toHaveLength(1);
    expect(all(`SELECT id FROM Task WHERE transactionId = ?`, [a])).toHaveLength(1);
    expect(all(`SELECT id FROM ClosingEvent WHERE transactionId = ?`, [a])).toHaveLength(1);
    expect(all(`SELECT id FROM Task WHERE transactionId = ?`, [b])).toHaveLength(0);
  });

  it("INVARIANT 2: never deletes a fact — conflicts become SUPERSEDED", () => {
    const a = makeTransaction();
    const b = makeTransaction();
    addFact(a, "CLOSING_TIME", "2:00 PM");
    const losing = addFact(b, "CLOSING_TIME", "3:00 PM");

    mergeTransactions(a, b, "user-admin");

    const row = get<{ status: string; transactionId: string }>(
      `SELECT status, transactionId FROM ExtractedFact WHERE id = ?`,
      [losing]
    );
    expect(row?.status).toBe("SUPERSEDED"); // kept, not dropped
    expect(row?.transactionId).toBe(a); // and it moved across with the rest

    const current = all<{ structuredValue: string }>(
      `SELECT structuredValue FROM ExtractedFact WHERE transactionId = ? AND factType = 'CLOSING_TIME' AND status = 'CURRENT'`,
      [a]
    );
    expect(current).toHaveLength(1);
    expect(JSON.parse(current[0].structuredValue)).toBe("2:00 PM");
  });

  it("supersedes an exact duplicate rather than double-counting the evidence", () => {
    const a = makeTransaction();
    const b = makeTransaction();
    addFact(a, "LOAN_NUMBER", "LN-44821");
    addFact(b, "LOAN_NUMBER", "LN-44821");

    mergeTransactions(a, b, "user-admin");

    expect(
      all(`SELECT id FROM ExtractedFact WHERE transactionId = ? AND factType = 'LOAN_NUMBER' AND status = 'CURRENT'`, [a])
    ).toHaveLength(1);
    expect(
      all(`SELECT id FROM ExtractedFact WHERE transactionId = ? AND factType = 'LOAN_NUMBER' AND status = 'SUPERSEDED'`, [a])
    ).toHaveLength(1);
  });

  it("keeps both values when a fact type allows several (party names)", () => {
    const a = makeTransaction();
    const b = makeTransaction();
    addFact(a, "BUYER_NAME", "Anna Kowalski");
    addFact(b, "SELLER_NAME", "Robert Johnson");

    mergeTransactions(a, b, "user-admin");

    expect(all(`SELECT id FROM ExtractedFact WHERE transactionId = ? AND status = 'CURRENT'`, [a])).toHaveLength(2);
  });

  it("marks the losing file MERGED instead of deleting it, so old links still resolve", () => {
    const a = makeTransaction();
    const b = makeTransaction();
    mergeTransactions(a, b, "user-admin");

    const row = get<{ status: string }>(`SELECT status FROM TransactionRecord WHERE id = ?`, [b]);
    expect(row?.status).toBe("MERGED");
  });

  it("inherits a file number the surviving file was missing, without overwriting one it has", () => {
    const a = makeTransaction();
    const b = makeTransaction();
    run(`UPDATE TransactionRecord SET loanNumber = ? WHERE id = ?`, ["LN-1", a]);
    run(`UPDATE TransactionRecord SET loanNumber = ?, fileNumber = ? WHERE id = ?`, ["LN-2", "KT-9", b]);

    mergeTransactions(a, b, "user-admin");

    const row = get<{ loanNumber: string; fileNumber: string }>(
      `SELECT loanNumber, fileNumber FROM TransactionRecord WHERE id = ?`,
      [a]
    );
    expect(row?.loanNumber).toBe("LN-1"); // not overwritten
    expect(row?.fileNumber).toBe("KT-9"); // filled in from the other file
  });

  it("records who did it, from the session", () => {
    const a = makeTransaction();
    const b = makeTransaction();
    mergeTransactions(a, b, "user-processor", "same property, two orders");

    const merge = get<{ mergedByUserId: string; explanation: string }>(
      `SELECT mergedByUserId, explanation FROM TransactionMerge LIMIT 1`
    );
    expect(merge?.mergedByUserId).toBe("user-processor");
    expect(merge?.explanation).toBe("same property, two orders");

    const audit = get<{ summary: string; actorType: string; actorId: string }>(
      `SELECT summary, actorType, actorId FROM AuditEvent WHERE eventType = 'transaction_merged'`
    );
    expect(audit?.actorType).toBe("HUMAN");
    expect(audit?.actorId).toBe("user-processor");
  });

  it("clears the duplicate flag that prompted the merge", () => {
    const a = makeTransaction();
    const b = makeTransaction();
    const proposalId = randomUUID();
    run(
      `INSERT INTO AIProposal (id, transactionId, proposalType, payload, confidence, fieldConfidence, status, idempotencyKey, sourceEmailIds, createdAt)
       VALUES (?, ?, 'CLOSING_CREATE', '{}', 0.5, '{}', 'PROPOSED', ?, '[]', ?)`,
      [proposalId, a, randomUUID(), nowIso()]
    );
    run(
      `INSERT INTO ReviewItem (id, transactionId, proposalId, reviewType, reason, conflictingEvidence, duplicateCandidates, status, createdAt)
       VALUES (?, ?, ?, 'closing_proposal', 'r', NULL, ?, 'PENDING', ?)`,
      [randomUUID(), a, proposalId, JSON.stringify([b]), nowIso()]
    );

    mergeTransactions(a, b, "user-admin");

    const item = get<{ duplicateCandidates: string | null }>(`SELECT duplicateCandidates FROM ReviewItem LIMIT 1`);
    expect(item?.duplicateCandidates).toBeNull();
  });

  it("refuses to merge a file that has already been merged away", () => {
    const a = makeTransaction();
    const b = makeTransaction();
    const c = makeTransaction();
    mergeTransactions(a, b, "user-admin");

    expect(() => mergeTransactions(c, b, "user-admin")).toThrow(/already been merged/i);
  });
});

describe("reversing a merge", () => {
  it("puts every moved record back where it came from", () => {
    const a = makeTransaction();
    const b = makeTransaction();
    const factId = addFact(b, "BUYER_NAME", "Kowalski");
    const taskId = addTask(b, "Send the CPL");

    const { mergeId } = mergeTransactions(a, b, "user-admin");
    expect(all(`SELECT id FROM ExtractedFact WHERE transactionId = ?`, [a])).toHaveLength(1);

    const { restoredRows } = reverseMerge(mergeId, "user-admin");

    expect(restoredRows).toBe(2);
    expect(get<{ transactionId: string }>(`SELECT transactionId FROM ExtractedFact WHERE id = ?`, [factId])?.transactionId).toBe(b);
    expect(get<{ transactionId: string }>(`SELECT transactionId FROM Task WHERE id = ?`, [taskId])?.transactionId).toBe(b);
    expect(get<{ status: string }>(`SELECT status FROM TransactionRecord WHERE id = ?`, [b])?.status).toBe("POTENTIAL");
  });

  it("restores a fact that the merge had superseded", () => {
    const a = makeTransaction();
    const b = makeTransaction();
    addFact(a, "CLOSING_TIME", "2:00 PM");
    const losing = addFact(b, "CLOSING_TIME", "3:00 PM");

    const { mergeId } = mergeTransactions(a, b, "user-admin");
    expect(get<{ status: string }>(`SELECT status FROM ExtractedFact WHERE id = ?`, [losing])?.status).toBe("SUPERSEDED");

    reverseMerge(mergeId, "user-admin");

    const row = get<{ status: string; transactionId: string }>(`SELECT status, transactionId FROM ExtractedFact WHERE id = ?`, [losing]);
    expect(row?.status).toBe("CURRENT");
    expect(row?.transactionId).toBe(b);
  });

  it("gives back an inherited field", () => {
    const a = makeTransaction();
    const b = makeTransaction();
    run(`UPDATE TransactionRecord SET fileNumber = ? WHERE id = ?`, ["KT-9", b]);

    const { mergeId } = mergeTransactions(a, b, "user-admin");
    expect(get<{ fileNumber: string }>(`SELECT fileNumber FROM TransactionRecord WHERE id = ?`, [a])?.fileNumber).toBe("KT-9");

    reverseMerge(mergeId, "user-admin");
    expect(get<{ fileNumber: string | null }>(`SELECT fileNumber FROM TransactionRecord WHERE id = ?`, [a])?.fileNumber).toBeNull();
  });

  it("leaves records created AFTER the merge on the surviving file", () => {
    const a = makeTransaction();
    const b = makeTransaction();
    addFact(b, "BUYER_NAME", "Kowalski");

    const { mergeId } = mergeTransactions(a, b, "user-admin");
    const laterTask = addTask(a, "Something that happened after the merge");

    reverseMerge(mergeId, "user-admin");

    // The later task was never part of the other file — moving it would be
    // inventing history.
    expect(get<{ transactionId: string }>(`SELECT transactionId FROM Task WHERE id = ?`, [laterTask])?.transactionId).toBe(a);
  });

  it("refuses to reverse the same merge twice", () => {
    const a = makeTransaction();
    const b = makeTransaction();
    const { mergeId } = mergeTransactions(a, b, "user-admin");
    reverseMerge(mergeId, "user-admin");

    expect(() => reverseMerge(mergeId, "user-admin")).toThrow(/already been reversed/i);
  });

  it("writes an audit entry naming who reversed it", () => {
    const a = makeTransaction();
    const b = makeTransaction();
    const { mergeId } = mergeTransactions(a, b, "user-admin");
    reverseMerge(mergeId, "user-closer");

    const audit = get<{ actorId: string; actorType: string }>(
      `SELECT actorId, actorType FROM AuditEvent WHERE eventType = 'transaction_merge_reversed'`
    );
    expect(audit?.actorId).toBe("user-closer");
    expect(audit?.actorType).toBe("HUMAN");
  });
});

describe("the real-world case this was built for", () => {
  it("joins a broker's order and our own search order into one file", () => {
    // Two real emails, three days apart, about the same property. The broker
    // quoted a loan number; our orders desk quoted a search number. A matching
    // address alone scores 45 against a 60 threshold, so match.ts correctly
    // refuses to link them and flags a duplicate instead.
    const brokerOrder = makeTransaction();
    addFact(brokerOrder, "PROPERTY_ADDRESS", "1274 Danforth Ave");
    addFact(brokerOrder, "LOAN_NUMBER", "2607093481");
    addTask(brokerOrder, "Open the title order");

    const searchOrder = makeTransaction();
    addFact(searchOrder, "PROPERTY_ADDRESS", "1274 Danforth Ave");
    addFact(searchOrder, "FILE_NUMBER", "SAS26-812R");

    mergeTransactions(brokerOrder, searchOrder, "user-admin", "same property, two order numbers");

    const current = all<{ factType: string }>(
      `SELECT factType FROM ExtractedFact WHERE transactionId = ? AND status = 'CURRENT'`,
      [brokerOrder]
    ).map((f) => f.factType);

    // One file, carrying both identifiers, with the duplicate address kept as
    // history rather than counted twice.
    expect(current).toContain("LOAN_NUMBER");
    expect(current).toContain("FILE_NUMBER");
    expect(current.filter((t) => t === "PROPERTY_ADDRESS")).toHaveLength(1);
    expect(all(`SELECT id FROM Task WHERE transactionId = ?`, [brokerOrder])).toHaveLength(1);
  });
});
