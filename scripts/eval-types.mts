/** Shared shapes for the accuracy scorecard (scripts/eval.mts + eval-worker.mts). */

export interface ExpectedFact {
  /** One of the fact types the app understands, e.g. PROPERTY_ADDRESS, CLOSING_TIME, BUYER_NAME. */
  type: string;
  /** Text that must appear in what the AI extracted. Case-insensitive, partial match. */
  contains: string;
  /** Optional plain-English note explaining why this matters. Printed when it fails. */
  why?: string;
}

export interface ForbiddenFact {
  type: string;
  /** A word that must NOT appear — used to catch the AI inventing detail. */
  text: string;
  why?: string;
}

export interface ExpectedTask {
  /** Text that must appear in a proposed task's title or category. */
  contains: string;
  why?: string;
}

export interface EvalCase {
  id: string;
  /** Cases sharing a group run in order against the same database, so a later
   *  email can be checked for filing under the earlier one's transaction. */
  group?: string;
  note?: string;
  from: string;
  subject: string;
  body: string;
  direction?: "INCOMING" | "OUTGOING";
  sentAt?: string;
  expect?: {
    facts?: ExpectedFact[];
    mustNotSay?: ForbiddenFact[];
    tasks?: ExpectedTask[];
    /** Exact number of tasks expected. Use 0 for "this email asks for nothing". */
    taskCount?: number;
    filing?: "new" | "existing";
    proposesClosing?: boolean;
    /** Did the app flag this as a possible duplicate of an existing file?
     *  This is the other half of invariant 4: when the evidence is too weak to
     *  link two files automatically, it must still raise the flag rather than
     *  silently starting a fresh file. */
    duplicateFlagged?: boolean;
    /** Was this filed onto an existing file on the property address alone, with
     *  the missing-file-number warning raised? Office rule, 2026-07-31: that is
     *  the right answer when the address agrees and nothing else does — better
     *  than starting a second file, but weak enough to need a human. */
    addressOnlyLink?: boolean;
  };
}

export interface Finding {
  ok: boolean;
  kind: "fact" | "invented" | "task" | "taskCount" | "filing" | "closing" | "duplicate" | "link";
  detail: string;
  why?: string;
}

/** An identifying fact — the kind of thing `match.ts` actually scores on. */
export interface Identifier {
  type: string;
  value: string;
}

/**
 * Why an email landed on the file it did.
 *
 * The pipeline has always recorded this decision in the audit trail, but the
 * scorecard ran each case against a throwaway database and deleted it at the
 * end, so a "WRONG FILE" line came with no explanation. This carries the
 * evidence out of that database before it is destroyed.
 *
 * Nothing here is recomputed — it is read back from the `transaction_matched`
 * audit event written by `src/lib/ai/process-email.ts`. The scoring itself
 * lives in `src/lib/ai/match.ts` and is not touched (invariant 4).
 */
export interface MatchEvidence {
  score: number;
  isStrongMatch: boolean;
  reasons: string[];
  bestCandidateTransactionId: string | null;
  /** How many files existed to compare against when this email arrived. */
  transactionsConsidered: number;
  /** What this email offered up to match on. Empty means it extracted nothing. */
  identifiersExtracted: Identifier[];
  /** Where it actually ended up. */
  filedOnTransactionId: string | null;
  /** What was already on every *other* file — i.e. what it could have joined. */
  otherFiles: { transactionId: string; identifiers: Identifier[] }[];
}

export interface EvalCaseResult {
  id: string;
  group: string;
  note?: string;
  passed: boolean;
  errored?: string;
  findings: Finding[];
  observed: {
    facts: { type: string; text: string; confidence: number }[];
    tasks: { title: string; category: string; confidence: number }[];
    filing: "new" | "existing" | "unknown";
    duplicateFlagged: boolean;
    addressOnlyLink: boolean;
    /** Null only when the pipeline threw before it got as far as matching. */
    match: MatchEvidence | null;
  };
  elapsedMs: number;
}
