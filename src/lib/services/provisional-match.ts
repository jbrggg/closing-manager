import { randomUUID } from "node:crypto";
import { all, get, run, nowIso } from "@/lib/db";
import { recordAudit } from "./audit";

const ORG_ID = "org-demo";

export interface ProvisionalMatchRow {
  id: string;
  transactionId: string;
  sourceEmailId: string;
  reason: string;
  movedFactIds: string;
  movedProposalIds: string;
  status: string;
  createdAt: string;
  decidedAt: string | null;
  decidedByUserId: string | null;
}

/** The active address-only link an email made onto a file, if there is one. */
export function findActiveProvisionalMatch(sourceEmailId: string): ProvisionalMatchRow | null {
  return (
    get<ProvisionalMatchRow>(
      `SELECT * FROM ProvisionalMatch WHERE sourceEmailId = ? AND status = 'ACTIVE' ORDER BY createdAt DESC LIMIT 1`,
      [sourceEmailId]
    ) ?? null
  );
}

/** The link stands. Nothing moves; the office has said it is the same file. */
export function confirmProvisionalMatch(id: string, decidedByUserId?: string) {
  const pm = get<ProvisionalMatchRow>(`SELECT * FROM ProvisionalMatch WHERE id = ?`, [id]);
  if (!pm) throw new Error("Provisional match not found");
  if (pm.status !== "ACTIVE") throw new Error("Provisional match already decided");

  run(`UPDATE ProvisionalMatch SET status = 'CONFIRMED', decidedAt = ?, decidedByUserId = ? WHERE id = ?`, [
    nowIso(),
    decidedByUserId ?? null,
    id,
  ]);
  recordAudit({
    organizationId: ORG_ID,
    eventType: "human_decision",
    entityType: "TransactionRecord",
    entityId: pm.transactionId,
    summary: "Confirmed an address-only link — the email belongs on this file",
    actorType: "HUMAN",
    actorId: decidedByUserId,
  });
}

/**
 * The link was wrong — this is a different deal on the same property.
 *
 * Moves exactly the rows the email wrote onto a fresh file, using the list
 * recorded when the link was made. This is the scoped undo that an address-only
 * link needs and that a general transaction split (still unbuilt, ROADMAP D1)
 * would otherwise be required for.
 *
 * Deliberately narrow: it moves only the rows named in the record. Anything
 * written to the file afterwards stays put, for the same reason reverseMerge
 * leaves later rows alone — moving them would be inventing history (invariant 9).
 * Nothing is deleted (invariant 2).
 */
export function undoProvisionalMatch(id: string, decidedByUserId?: string): { newTransactionId: string; movedFacts: number; movedProposals: number } {
  const pm = get<ProvisionalMatchRow>(`SELECT * FROM ProvisionalMatch WHERE id = ?`, [id]);
  if (!pm) throw new Error("Provisional match not found");
  if (pm.status !== "ACTIVE") throw new Error("Provisional match already decided");

  const factIds: string[] = JSON.parse(pm.movedFactIds);
  const proposalIds: string[] = JSON.parse(pm.movedProposalIds);

  const newTransactionId = randomUUID();
  run(
    `INSERT INTO TransactionRecord (id, organizationId, officeId, propertyId, fileNumber, loanNumber, transactionType, status, createdAt, updatedAt)
     VALUES (?, ?, NULL, NULL, NULL, NULL, NULL, 'POTENTIAL', ?, ?)`,
    [newTransactionId, ORG_ID, nowIso(), nowIso()]
  );

  // Only rows that are still where we left them. If a later merge already moved
  // one, it is no longer ours to move back.
  let movedFacts = 0;
  for (const factId of factIds) {
    const row = get<{ id: string }>(`SELECT id FROM ExtractedFact WHERE id = ? AND transactionId = ?`, [
      factId,
      pm.transactionId,
    ]);
    if (!row) continue;
    run(`UPDATE ExtractedFact SET transactionId = ? WHERE id = ?`, [newTransactionId, factId]);
    movedFacts++;
  }

  let movedProposals = 0;
  for (const proposalId of proposalIds) {
    const row = get<{ id: string }>(`SELECT id FROM AIProposal WHERE id = ? AND transactionId = ?`, [
      proposalId,
      pm.transactionId,
    ]);
    if (!row) continue;
    run(`UPDATE AIProposal SET transactionId = ? WHERE id = ?`, [newTransactionId, proposalId]);
    run(`UPDATE ReviewItem SET transactionId = ? WHERE proposalId = ?`, [newTransactionId, proposalId]);
    movedProposals++;
  }

  run(`UPDATE ProvisionalMatch SET status = 'UNDONE', decidedAt = ?, decidedByUserId = ? WHERE id = ?`, [
    nowIso(),
    decidedByUserId ?? null,
    id,
  ]);

  recordAudit({
    organizationId: ORG_ID,
    eventType: "human_decision",
    entityType: "TransactionRecord",
    entityId: newTransactionId,
    summary:
      `Rejected an address-only link — moved ${movedFacts} fact(s) and ${movedProposals} proposal(s) ` +
      `off file ${pm.transactionId.slice(0, 8)} onto a file of their own`,
    detail: { undoneFrom: pm.transactionId, provisionalMatchId: id },
    actorType: "HUMAN",
    actorId: decidedByUserId,
  });

  return { newTransactionId, movedFacts, movedProposals };
}

/** Facts on this file that arrived through an address-only link still awaiting
 *  a decision — used to show the warning banner on the transaction page. */
export function activeProvisionalMatchesFor(transactionId: string): ProvisionalMatchRow[] {
  return all<ProvisionalMatchRow>(
    `SELECT * FROM ProvisionalMatch WHERE transactionId = ? AND status = 'ACTIVE' ORDER BY createdAt DESC`,
    [transactionId]
  );
}
