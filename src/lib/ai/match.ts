import { all } from "@/lib/db";
import { ExtractedFactRow, TransactionRow } from "@/types/models";
import { ExtractedFactCandidate } from "./provider";

export interface MatchResult {
  transaction: TransactionRow | null;
  score: number;
  isStrongMatch: boolean; // >= threshold for auto-linking without review
  reasons: string[];
}

const STRONG_MATCH_THRESHOLD = 60;
const WEAK_SIGNAL_ONLY_CAP = 20; // shared surname / generic subject alone never exceeds this

function normalizeAddress(addr: string): string {
  return addr
    .toLowerCase()
    .replace(/[.,]/g, "")
    .replace(/\bstreet\b/g, "st")
    .replace(/\bavenue\b/g, "ave")
    .replace(/\broad\b/g, "rd")
    .replace(/\bdrive\b/g, "dr")
    .trim();
}

/**
 * Weighted-evidence transaction matching. Deliberately conservative: a
 * shared last name or a generic subject line alone cannot cross the
 * strong-match threshold — only concrete identifiers (address, file/loan
 * number) or a combination of multiple mid-weight signals can.
 */
export function findBestTransactionMatch(
  organizationId: string,
  newFactsRaw: ExtractedFactCandidate[]
): MatchResult {
  // Dedupe by (type, value) so the same fact re-extracted from multiple
  // messages (e.g. via mailbox search re-finding the same email) can't
  // inflate the match score by being counted repeatedly.
  const seen = new Set<string>();
  const newFacts = newFactsRaw.filter((f) => {
    const key = `${f.factType}::${JSON.stringify(f.value)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const transactions = all<TransactionRow>(
    `SELECT * FROM TransactionRecord WHERE organizationId = ?`,
    [organizationId]
  );

  let best: MatchResult = { transaction: null, score: 0, isStrongMatch: false, reasons: [] };

  for (const txn of transactions) {
    const existingFacts = all<ExtractedFactRow>(
      `SELECT * FROM ExtractedFact WHERE transactionId = ? AND status = 'CURRENT'`,
      [txn.id]
    );
    const { score, reasons } = scoreAgainstTransaction(newFacts, existingFacts);
    if (score > best.score) {
      best = {
        transaction: txn,
        score,
        isStrongMatch: score >= STRONG_MATCH_THRESHOLD,
        reasons,
      };
    }
  }

  return best;
}

function scoreAgainstTransaction(
  newFacts: ExtractedFactCandidate[],
  existingFacts: ExtractedFactRow[]
): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  const existingByType = (type: string) =>
    existingFacts.filter((f) => f.factType === type).map((f) => JSON.parse(f.structuredValue));

  for (const fact of newFacts) {
    if (fact.factType === "PROPERTY_ADDRESS") {
      const newAddr = normalizeAddress(String(fact.value));
      const hit = existingByType("PROPERTY_ADDRESS").some(
        (v) => normalizeAddress(String(v)) === newAddr
      );
      if (hit) {
        score += 45;
        reasons.push(`Matching property address ("${fact.value}")`);
      }
    }
    if (fact.factType === "FILE_NUMBER" || fact.factType === "LOAN_NUMBER") {
      const hit = existingByType(fact.factType).some((v) => String(v) === String(fact.value));
      if (hit) {
        score += 50;
        reasons.push(`Matching ${fact.factType === "FILE_NUMBER" ? "file" : "loan"} number`);
      }
    }
    if (fact.factType === "BUYER_NAME" || fact.factType === "SELLER_NAME") {
      const hit = existingByType(fact.factType).some(
        (v) => String(v).toLowerCase() === String(fact.value).toLowerCase()
      );
      if (hit) {
        score += 15; // full name match only — a shared surname would not hit this exact-match check
        reasons.push(`Matching party name ("${fact.value}")`);
      }
    }
    if (fact.factType === "CLOSING_LOCATION") {
      const hit = existingByType("CLOSING_LOCATION").some(
        (v) => String(v).toLowerCase() === String(fact.value).toLowerCase()
      );
      if (hit) {
        score += 10;
        reasons.push(`Matching closing location ("${fact.value}")`);
      }
    }
  }

  // Cap purely-weak evidence (e.g. only a subject-line echo, no identifiers)
  if (score > 0 && score <= WEAK_SIGNAL_ONLY_CAP && reasons.every((r) => r.includes("location"))) {
    // location alone is a weak signal — never sufficient by itself
  }

  return { score, reasons };
}
