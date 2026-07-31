/**
 * The judgement half of `npm run tune`. Pure functions, no I/O, so the rules
 * that decide whether a prompt change survives are testable without spending a
 * cent on the API. See tests/tune-decide.test.ts.
 *
 * WHY THIS EXISTS AT ALL
 *
 * The scorecard is not deterministic. Running the same two emails three times
 * on 2026-07-31 produced three different sets of failures. So "the score went
 * up after I changed the prompt" is not evidence that the prompt is better —
 * it may be the same prompt getting luckier. Every rule below exists to stop a
 * change being kept on the strength of noise.
 */
import type { EvalCaseResult } from "./eval-types.mts";

export type Stability = "stable-pass" | "flaky" | "stable-fail";

export interface CaseVerdict {
  id: string;
  stability: Stability;
  passes: number;
  runs: number;
  /** Failure descriptions seen in EVERY failing run — the reproducible part. */
  persistentFailures: string[];
}

/** One case's outcome across N repeated runs of the same prompt. */
export function classifyCase(id: string, runs: EvalCaseResult[]): CaseVerdict {
  const passes = runs.filter((r) => r.passed).length;
  const stability: Stability = passes === runs.length ? "stable-pass" : passes === 0 ? "stable-fail" : "flaky";

  // Only failures that showed up in every single failing run are worth acting
  // on. A finding that appeared once out of three is noise, and chasing it
  // with a prompt edit is how you make the prompt worse while feeling busy.
  const failingRuns = runs.filter((r) => !r.passed);
  const counts = new Map<string, number>();
  for (const r of failingRuns) {
    for (const d of new Set(r.findings.filter((f) => !f.ok).map((f) => f.detail))) {
      counts.set(d, (counts.get(d) ?? 0) + 1);
    }
  }
  const persistentFailures = [...counts.entries()]
    .filter(([, n]) => n === failingRuns.length && failingRuns.length > 0)
    .map(([d]) => d)
    .sort();

  return { id, stability, passes, runs: runs.length, persistentFailures };
}

/** Roll a set of repeated runs up into one verdict per case. */
export function classifyAll(batches: EvalCaseResult[][]): Map<string, CaseVerdict> {
  const byId = new Map<string, EvalCaseResult[]>();
  for (const batch of batches) {
    for (const r of batch) {
      if (!byId.has(r.id)) byId.set(r.id, []);
      byId.get(r.id)!.push(r);
    }
  }
  const out = new Map<string, CaseVerdict>();
  for (const [id, runs] of byId) out.set(id, classifyCase(id, runs));
  return out;
}

export interface Decision {
  keep: boolean;
  /** Plain-English reasons, printed to the user in order. */
  reasons: string[];
  fixed: string[];
  broken: string[];
  beforeStablePass: number;
  afterStablePass: number;
}

/**
 * Should a prompt change be kept?
 *
 * Deliberately asymmetric. Breaking something that used to work reliably is a
 * veto on its own, because in this app a wrong answer that looks confident is
 * worse than a missing one. Gaining a case that was already flaky is not
 * evidence of anything.
 */
export function decide(
  before: Map<string, CaseVerdict>,
  after: Map<string, CaseVerdict>,
  guardsPassed: boolean
): Decision {
  const reasons: string[] = [];
  const fixed: string[] = [];
  const broken: string[] = [];

  for (const [id, b] of before) {
    const a = after.get(id);
    if (!a) continue;
    if (b.stability === "stable-fail" && a.stability === "stable-pass") fixed.push(id);
    if (b.stability === "stable-pass" && a.stability !== "stable-pass") broken.push(id);
  }

  const beforeStablePass = [...before.values()].filter((v) => v.stability === "stable-pass").length;
  const afterStablePass = [...after.values()].filter((v) => v.stability === "stable-pass").length;

  // Guard tests come first. tests/llm-provider.test.ts holds the AM/PM
  // regression guard and the one-checklist-is-one-task rule (invariant 10);
  // a prompt edit that breaks either is rejected no matter what it scored.
  if (!guardsPassed) {
    reasons.push("REVERT: the llm-provider guard tests failed. Those pin down invariants 8 and 10 and are not negotiable.");
    return { keep: false, reasons, fixed, broken, beforeStablePass, afterStablePass };
  }

  if (broken.length > 0) {
    reasons.push(
      `REVERT: ${broken.length} case(s) that passed reliably before no longer do — ${broken.join(", ")}. ` +
        `Breaking a case that worked is worse than not fixing one that didn't.`
    );
    return { keep: false, reasons, fixed, broken, beforeStablePass, afterStablePass };
  }

  if (afterStablePass <= beforeStablePass) {
    reasons.push(
      `REVERT: reliably-passing cases went from ${beforeStablePass} to ${afterStablePass}. ` +
        `No improvement, so the change is not worth the risk of keeping.`
    );
    return { keep: false, reasons, fixed, broken, beforeStablePass, afterStablePass };
  }

  reasons.push(
    `KEEP: reliably-passing cases went from ${beforeStablePass} to ${afterStablePass}` +
      (fixed.length ? `, fixing ${fixed.join(", ")}` : "") +
      ", and nothing that worked before broke."
  );
  return { keep: true, reasons, fixed, broken, beforeStablePass, afterStablePass };
}

/** A group of reproducible failures that probably share one root cause. */
export interface Cluster {
  pattern: string;
  hint: string;
  cases: string[];
  examples: string[];
}

/**
 * Group the reproducible failures so a prompt edit can aim at a cause rather
 * than at one email. The patterns are the ones this project has actually hit,
 * documented in evals/README.md and ROADMAP.md — not a generic taxonomy.
 */
const PATTERNS: { pattern: string; hint: string; test: RegExp }[] = [
  {
    pattern: "invented detail",
    hint: "The prompt needs a sharper prohibition. Inventing a fact is worse than missing one — see invariant 8 and the AM/PM guard already in llm-provider.ts.",
    test: /^INVENTED/,
  },
  {
    pattern: "too many tasks from one checklist",
    hint: "Invariant 10: one party sending a list of requirements for a single purpose is ONE task, not one per bullet. The rule is in the prompt already, so it needs strengthening, not adding.",
    test: /expected \d+ task\(s\) but got [1-9]/,
  },
  {
    pattern: "missed a task entirely",
    hint: "The ask is probably buried at the top of a long quoted chain, or phrased without a question mark.",
    test: /MISSED a task/,
  },
  {
    pattern: "missed a fact in a quoted reply chain",
    hint: "The facts are in the quoted part below the reply. The prompt needs to say the whole thread is evidence, not just the new text at the top.",
    test: /MISSED (PROPERTY_ADDRESS|LOAN_NUMBER|FILE_NUMBER|BUYER_NAME|SELLER_NAME|CLOSING_DATE)/,
  },
  {
    pattern: "filed under the wrong property",
    hint: "Run `npm run diagnose` first. If the score was near the threshold this is a matching question, not a prompt one — and match.ts is invariant 4. If the address came back in a different shape on the two emails, that IS a prompt question.",
    test: /WRONG FILE/,
  },
  {
    pattern: "duplicate not flagged",
    hint: "Usually a score of 0 rather than a near miss — the two emails wrote the same address differently. Making address extraction consistent is a prompt fix; lowering the threshold is not (invariant 4).",
    test: /flagged as a possible duplicate/,
  },
];

export function clusterFailures(verdicts: Map<string, CaseVerdict>): Cluster[] {
  const out = new Map<string, Cluster>();
  for (const v of verdicts.values()) {
    if (v.stability !== "stable-fail") continue;
    for (const detail of v.persistentFailures) {
      const p = PATTERNS.find((x) => x.test.test(detail));
      const key = p?.pattern ?? "other";
      if (!out.has(key)) {
        out.set(key, { pattern: key, hint: p?.hint ?? "No known pattern — read the case note.", cases: [], examples: [] });
      }
      const c = out.get(key)!;
      if (!c.cases.includes(v.id)) c.cases.push(v.id);
      if (c.examples.length < 3) c.examples.push(detail);
    }
  }
  return [...out.values()].sort((a, b) => b.cases.length - a.cases.length);
}
