import { randomUUID } from "node:crypto";
import { get, all, run, nowIso } from "@/lib/db";
import { recordAudit } from "./audit";
import { TransactionRow, ExtractedFactRow } from "@/types/models";

const ORG_ID = "org-demo";

// -----------------------------------------------------------------------------
// TRANSACTION MERGE (roadmap D1).
//
// Why this exists, concretely: two real emails three days apart about the same
// property shared only the address — the broker quoted a loan number, our own
// orders desk quoted a search number. A matching address scores 45 against a
// 60-point threshold, so `match.ts` deliberately refuses to link them
// (invariant 4, tuned against a real false-merge bug). One file therefore
// arrives as two transactions with a duplicate flag on the review item, and
// until now there was no way to act on that flag.
//
// Merge is the correct fix. Lowering the matching threshold is not — the same
// property legitimately has several transactions over the years, and the
// conservative weights are load-bearing.
//
// The two rules this code exists to honour:
//
//   1. NOTHING IS DELETED. Every fact from the losing transaction moves across
//      with its evidence intact. Facts that would collide are marked
//      SUPERSEDED rather than dropped, so the history of what was believed and
//      when survives the merge (CLAUDE.md invariant 2).
//
//   2. THE MERGE IS REVERSIBLE. Every row that moves is written to a
//      TransactionMerge record, so an incorrect merge can be undone exactly.
//      A human who merges two files by mistake must not be stuck with it.
// -----------------------------------------------------------------------------

/** Tables carrying a transactionId, and whether the column allows NULL. */
const OWNED_TABLES = [
  "TransactionParticipant",
  "ExtractedFact",
  "ClosingEvent",
  "Task",
  "AIProposal",
  "ReviewItem",
] as const;

export interface MergePreview {
  primary: TransactionRow;
  secondary: TransactionRow;
  /** Row counts that would move, per table. */
  moves: Record<string, number>;
  /** Facts that exist on both sides with the same type but a different value. */
  conflicts: {
    factType: string;
    keptValue: unknown;
    supersededValue: unknown;
  }[];
  /** True when the two look like genuinely different deals. */
  warnings: string[];
}

function requireTransaction(id: string, label: string): TransactionRow {
  const txn = get<TransactionRow>(`SELECT * FROM TransactionRecord WHERE id = ?`, [id]);
  if (!txn) throw new Error(`${label} transaction not found`);
  return txn;
}

function currentFacts(transactionId: string): ExtractedFactRow[] {
  return all<ExtractedFactRow>(
    `SELECT * FROM ExtractedFact WHERE transactionId = ? AND status = 'CURRENT'`,
    [transactionId]
  );
}

/** Fact types where only one value can be current at a time. */
const SINGLE_VALUE_TYPES = ["CLOSING_DATE", "CLOSING_TIME", "CLOSING_LOCATION", "PROPERTY_ADDRESS"];

/**
 * What would happen, without doing it. The review queue shows this before the
 * user commits, because merging the wrong two files is the mistake this whole
 * feature is trying to prevent — it should not be a blind click.
 */
export function previewMerge(primaryId: string, secondaryId: string): MergePreview {
  if (primaryId === secondaryId) throw new Error("Cannot merge a transaction into itself");
  const primary = requireTransaction(primaryId, "Primary");
  const secondary = requireTransaction(secondaryId, "Secondary");

  const moves: Record<string, number> = {};
  for (const table of OWNED_TABLES) {
    const row = get<{ n: number }>(`SELECT COUNT(*) as n FROM ${table} WHERE transactionId = ?`, [
      secondaryId,
    ]);
    moves[table] = row?.n ?? 0;
  }

  const primaryFacts = currentFacts(primaryId);
  const secondaryFacts = currentFacts(secondaryId);
  const conflicts: MergePreview["conflicts"] = [];

  for (const type of SINGLE_VALUE_TYPES) {
    const keep = primaryFacts.find((f) => f.factType === type);
    const incoming = secondaryFacts.find((f) => f.factType === type);
    if (!keep || !incoming) continue;
    if (keep.structuredValue !== incoming.structuredValue) {
      conflicts.push({
        factType: type,
        keptValue: JSON.parse(keep.structuredValue),
        supersededValue: JSON.parse(incoming.structuredValue),
      });
    }
  }

  // Signals that these may be different deals after all. Advisory only — the
  // human decides — but they should be shown, not buried.
  const warnings: string[] = [];
  const addr = (facts: ExtractedFactRow[]) =>
    facts.find((f) => f.factType === "PROPERTY_ADDRESS")?.structuredValue;
  const a = addr(primaryFacts);
  const b = addr(secondaryFacts);
  if (a && b && a !== b) {
    warnings.push(
      `The two files list different property addresses (${JSON.parse(a)} and ${JSON.parse(b)}). ` +
        `Check this is really one deal before merging.`
    );
  }
  const closings =
    (get<{ n: number }>(`SELECT COUNT(*) as n FROM ClosingEvent WHERE transactionId = ?`, [primaryId])?.n ?? 0) +
    (get<{ n: number }>(`SELECT COUNT(*) as n FROM ClosingEvent WHERE transactionId = ?`, [secondaryId])?.n ?? 0);
  if (closings > 1) {
    warnings.push(
      `Both files already have a closing scheduled. After merging, both closings will sit on the ` +
        `same file and one of them is probably wrong.`
    );
  }

  return { primary, secondary, moves, conflicts, warnings };
}

export interface MergeResult {
  mergeId: string;
  movedRows: number;
  supersededFactIds: string[];
}

/**
 * Move everything from `secondaryId` onto `primaryId`.
 *
 * The secondary transaction is NOT deleted — it is marked `MERGED` and keeps
 * pointing at the merge record, so its id remains a valid link target for any
 * audit entry or email evidence that already referenced it.
 */
export function mergeTransactions(
  primaryId: string,
  secondaryId: string,
  decidedByUserId?: string,
  explanation?: string
): MergeResult {
  const preview = previewMerge(primaryId, secondaryId);
  const { primary, secondary } = preview;

  if (primary.status === "MERGED") throw new Error("The primary transaction has already been merged away");
  if (secondary.status === "MERGED") throw new Error("That transaction has already been merged into another file");

  const mergeId = randomUUID();
  const movedRowIds: Record<string, string[]> = {};
  const supersededFactIds: string[] = [];

  // 1. Supersede colliding single-value facts BEFORE moving, so the primary's
  //    value stays current and the incoming one is preserved as history rather
  //    than silently winning or silently vanishing.
  const primaryFacts = currentFacts(primaryId);
  for (const type of SINGLE_VALUE_TYPES) {
    const keep = primaryFacts.find((f) => f.factType === type);
    if (!keep) continue;
    const colliding = all<ExtractedFactRow>(
      `SELECT * FROM ExtractedFact
       WHERE transactionId = ? AND factType = ? AND status = 'CURRENT' AND structuredValue != ?`,
      [secondaryId, type, keep.structuredValue]
    );
    for (const fact of colliding) {
      run(`UPDATE ExtractedFact SET status = 'SUPERSEDED', supersedesId = ? WHERE id = ?`, [keep.id, fact.id]);
      supersededFactIds.push(fact.id);
    }
  }

  // Exact duplicates of a fact already on the primary become SUPERSEDED too —
  // keeping both would double-count the evidence in future match scoring.
  for (const fact of currentFacts(secondaryId)) {
    const twin = primaryFacts.find(
      (f) => f.factType === fact.factType && f.structuredValue === fact.structuredValue
    );
    if (twin) {
      run(`UPDATE ExtractedFact SET status = 'SUPERSEDED', supersedesId = ? WHERE id = ?`, [twin.id, fact.id]);
      supersededFactIds.push(fact.id);
    }
  }

  // 2. Move every owned row.
  let movedRows = 0;
  for (const table of OWNED_TABLES) {
    const rows = all<{ id: string }>(`SELECT id FROM ${table} WHERE transactionId = ?`, [secondaryId]);
    movedRowIds[table] = rows.map((r) => r.id);
    if (rows.length === 0) continue;
    run(`UPDATE ${table} SET transactionId = ? WHERE transactionId = ?`, [primaryId, secondaryId]);
    movedRows += rows.length;
  }

  // 3. Fill any blank identifying field on the primary from the secondary,
  //    rather than losing it. Never overwrite a value the primary already has.
  const inherited: string[] = [];
  for (const field of ["fileNumber", "loanNumber", "transactionType", "officeId", "propertyId"] as const) {
    if (!primary[field] && secondary[field]) {
      run(`UPDATE TransactionRecord SET ${field} = ? WHERE id = ?`, [secondary[field], primaryId]);
      inherited.push(field);
    }
  }

  // 4. Record the merge so it can be reversed exactly.
  run(
    `INSERT INTO TransactionMerge (id, organizationId, primaryTransactionId, secondaryTransactionId,
       movedRowIds, supersededFactIds, inheritedFields, explanation, mergedByUserId, mergedAt, reversedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    [
      mergeId,
      ORG_ID,
      primaryId,
      secondaryId,
      JSON.stringify(movedRowIds),
      JSON.stringify(supersededFactIds),
      JSON.stringify(inherited),
      explanation ?? null,
      decidedByUserId ?? null,
      nowIso(),
    ]
  );

  run(`UPDATE TransactionRecord SET status = 'MERGED', updatedAt = ? WHERE id = ?`, [nowIso(), secondaryId]);
  run(`UPDATE TransactionRecord SET updatedAt = ? WHERE id = ?`, [nowIso(), primaryId]);

  // 5. Any review item that flagged this pair as duplicates has been answered.
  clearDuplicateFlags(primaryId, secondaryId);

  recordAudit({
    organizationId: ORG_ID,
    eventType: "transaction_merged",
    entityType: "TransactionRecord",
    entityId: primaryId,
    summary:
      `Merged transaction ${secondaryId} into ${primaryId} — moved ${movedRows} record(s), ` +
      `superseded ${supersededFactIds.length} duplicate/conflicting fact(s)` +
      (inherited.length ? `, inherited ${inherited.join(", ")}` : "") +
      (explanation ? `. Reason: ${explanation}` : ""),
    detail: { mergeId, movedRowIds, supersededFactIds, inherited },
    actorType: "HUMAN",
    actorId: decidedByUserId,
  });

  return { mergeId, movedRows, supersededFactIds };
}

/** Drop `otherId` from any review item's duplicate-candidate list for `txnId`. */
function clearDuplicateFlags(txnId: string, otherId: string) {
  const items = all<{ id: string; transactionId: string; duplicateCandidates: string | null }>(
    `SELECT id, transactionId, duplicateCandidates FROM ReviewItem
     WHERE duplicateCandidates IS NOT NULL AND (transactionId = ? OR transactionId = ?)`,
    [txnId, otherId]
  );
  for (const item of items) {
    let candidates: string[];
    try {
      candidates = JSON.parse(item.duplicateCandidates ?? "[]");
    } catch {
      continue;
    }
    const remaining = candidates.filter((c) => c !== txnId && c !== otherId);
    run(`UPDATE ReviewItem SET duplicateCandidates = ? WHERE id = ?`, [
      remaining.length ? JSON.stringify(remaining) : null,
      item.id,
    ]);
  }
}

/**
 * Undo a merge, putting every moved row back where it came from.
 *
 * Rows created *after* the merge stay with the primary — they were never part
 * of the secondary file and moving them would be inventing history.
 */
export function reverseMerge(mergeId: string, decidedByUserId?: string): { restoredRows: number } {
  const merge = get<{
    id: string;
    primaryTransactionId: string;
    secondaryTransactionId: string;
    movedRowIds: string;
    supersededFactIds: string;
    inheritedFields: string;
    reversedAt: string | null;
  }>(`SELECT * FROM TransactionMerge WHERE id = ?`, [mergeId]);

  if (!merge) throw new Error("Merge record not found");
  if (merge.reversedAt) throw new Error("That merge has already been reversed");

  const movedRowIds: Record<string, string[]> = JSON.parse(merge.movedRowIds);
  const supersededFactIds: string[] = JSON.parse(merge.supersededFactIds);
  const inherited: string[] = JSON.parse(merge.inheritedFields);

  let restoredRows = 0;
  for (const [table, ids] of Object.entries(movedRowIds)) {
    if (!(OWNED_TABLES as readonly string[]).includes(table)) continue; // defensive
    for (const id of ids) {
      run(`UPDATE ${table} SET transactionId = ? WHERE id = ?`, [merge.secondaryTransactionId, id]);
      restoredRows += 1;
    }
  }

  for (const factId of supersededFactIds) {
    run(`UPDATE ExtractedFact SET status = 'CURRENT', supersedesId = NULL WHERE id = ?`, [factId]);
  }

  for (const field of inherited) {
    if (!["fileNumber", "loanNumber", "transactionType", "officeId", "propertyId"].includes(field)) continue;
    run(`UPDATE TransactionRecord SET ${field} = NULL WHERE id = ?`, [merge.primaryTransactionId]);
  }

  run(`UPDATE TransactionRecord SET status = 'POTENTIAL', updatedAt = ? WHERE id = ?`, [
    nowIso(),
    merge.secondaryTransactionId,
  ]);
  run(`UPDATE TransactionMerge SET reversedAt = ?, reversedByUserId = ? WHERE id = ?`, [
    nowIso(),
    decidedByUserId ?? null,
    mergeId,
  ]);

  recordAudit({
    organizationId: ORG_ID,
    eventType: "transaction_merge_reversed",
    entityType: "TransactionRecord",
    entityId: merge.primaryTransactionId,
    summary: `Reversed merge ${mergeId} — returned ${restoredRows} record(s) to transaction ${merge.secondaryTransactionId}`,
    detail: { mergeId },
    actorType: "HUMAN",
    actorId: decidedByUserId,
  });

  return { restoredRows };
}
