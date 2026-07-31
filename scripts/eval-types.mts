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
  };
}

export interface Finding {
  ok: boolean;
  kind: "fact" | "invented" | "task" | "taskCount" | "filing" | "closing" | "duplicate";
  detail: string;
  why?: string;
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
  };
  elapsedMs: number;
}
