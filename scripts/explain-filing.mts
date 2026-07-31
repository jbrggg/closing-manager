/**
 * FILING DIAGNOSTIC
 *
 * Turns the matching evidence collected by eval-worker.mts into plain English.
 *
 * The scorecard used to say "WRONG FILE" and stop there, which tells you that
 * something is broken but not what. The pipeline had always recorded the
 * reasoning in the audit trail; the scorecard just deleted the database it was
 * written to. This reads it back and says it in words.
 *
 * It recomputes nothing and decides nothing. `src/lib/ai/match.ts` owns the
 * scoring and is not touched (invariant 4) — this only reports what it did.
 */
import type { EvalCaseResult, Identifier } from "./eval-types.mts";

/** "PROPERTY_ADDRESS" -> "property address" */
function human(type: string): string {
  return type.toLowerCase().replace(/_/g, " ");
}

function shortId(id: string | null): string {
  return id ? `file ${id.slice(0, 8)}` : "no file";
}

function listIdentifiers(ids: Identifier[]): string {
  if (ids.length === 0) return "nothing";
  return ids.map((i) => `${human(i.type)} "${i.value}"`).join(", ");
}

/** Same normalisation shape match.ts uses for equality: case-insensitive. */
function sameValue(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Explain where an email was filed and why, as a list of lines to print.
 *
 * `threshold` is read from match.ts at runtime; null means it could not be
 * read, in which case the explanation says so rather than inventing a number.
 */
export function explainFiling(result: EvalCaseResult, threshold: number | null): string[] {
  const m = result.observed.match;
  const need = threshold === null ? "the strong-match threshold (could not read it from match.ts)" : `the ${threshold} needed`;
  const out: string[] = [];

  if (!m) {
    return ["WHY: the pipeline stopped before it got as far as matching, so there is no decision to explain."];
  }

  // --- What it had to work with ---------------------------------------------
  if (m.identifiersExtracted.length === 0) {
    out.push(
      "WHY: it extracted no identifying facts at all — no property address, file number, " +
        "loan number or party name. With nothing to compare, the score could only be 0 and a " +
        "new file was the only possible outcome. This is an extraction failure, not a matching failure."
    );
  } else {
    out.push(`WHY: it had ${listIdentifiers(m.identifiersExtracted)} to match on.`);
  }

  // --- What it was matching against -----------------------------------------
  if (m.transactionsConsidered === 0) {
    out.push("     There were no existing files to compare against — this was the first email in its group.");
  } else {
    out.push(
      `     It compared against ${m.transactionsConsidered} existing file(s) and scored ` +
        `${m.score} of ${need}${m.isStrongMatch ? " — enough to link" : " — not enough to link"}.`
    );
    if (m.reasons.length > 0) {
      out.push(`     What matched: ${m.reasons.join("; ")}.`);
    } else if (m.identifiersExtracted.length > 0) {
      out.push("     Nothing it extracted appeared on any existing file, so the score stayed at 0.");
    }
  }

  // --- The near miss --------------------------------------------------------
  // When an email should have joined an existing file but didn't, the useful
  // question is "what does that file know that this email didn't say?".
  for (const other of m.otherFiles) {
    if (other.identifiers.length === 0) continue;
    const missed = other.identifiers.filter(
      (o) => !m.identifiersExtracted.some((e) => e.type === o.type && sameValue(e.value, o.value))
    );
    out.push(`     ${shortId(other.transactionId)} holds: ${listIdentifiers(other.identifiers)}.`);
    if (missed.length > 0 && m.identifiersExtracted.length > 0) {
      out.push(
        `       Not extracted from this email: ${listIdentifiers(missed)}` +
          ` — extracting any of these is what would have linked them.`
      );
    }
  }

  out.push(`     Filed on: ${shortId(m.filedOnTransactionId)}.`);

  // The one case where a wrong file is genuinely correct behaviour, and the
  // flag is the thing that should have fired instead. See ROADMAP D1.
  if (!m.isStrongMatch && m.score > 0 && !result.observed.duplicateFlagged) {
    out.push(
      "     NOTE: partial evidence that did not reach the threshold is exactly the case " +
        "the duplicate flag exists for, and no flag was raised."
    );
  }

  return out;
}
