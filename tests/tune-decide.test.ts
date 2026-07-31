import { describe, it, expect } from "vitest";
import { classifyAll, clusterFailures, decide } from "../scripts/tune-decide.mts";
import type { EvalCaseResult } from "../scripts/eval-types.mts";

// `npm run tune` is only worth having if it reliably puts a bad prompt back.
// These tests pin the rules that decide that, without spending anything on the
// API. The rules are deliberately asymmetric: breaking something that worked is
// a veto, and gaining a case that was never reliable proves nothing.

function result(id: string, passed: boolean, failures: string[] = []): EvalCaseResult {
  return {
    id,
    group: id,
    passed,
    findings: failures.map((detail) => ({ ok: false, kind: "fact" as const, detail })),
    observed: { facts: [], tasks: [], filing: "new", duplicateFlagged: false, addressOnlyLink: false, match: null },
    elapsedMs: 1,
  };
}

describe("telling signal from noise across repeated runs", () => {
  it("calls a case stable only when every run agrees", () => {
    const v = classifyAll([
      [result("a", true), result("b", false), result("c", true)],
      [result("a", true), result("b", false), result("c", false)],
    ]);
    expect(v.get("a")!.stability).toBe("stable-pass");
    expect(v.get("b")!.stability).toBe("stable-fail");
    expect(v.get("c")!.stability).toBe("flaky");
  });

  it("keeps only the failures that recurred in every failing run", () => {
    const v = classifyAll([
      [result("a", false, ["MISSED a task about CPL", "MISSED LOAN_NUMBER containing 307814"])],
      [result("a", false, ["MISSED a task about CPL"])],
    ]);
    // The loan number came back on the second run — chasing it with a prompt
    // edit would be chasing noise.
    expect(v.get("a")!.persistentFailures).toEqual(["MISSED a task about CPL"]);
  });
});

const twice = (rs: EvalCaseResult[]) => classifyAll([rs, rs]);

describe("deciding whether a prompt change survives", () => {
  it("keeps a change that fixes a reliable failure and breaks nothing", () => {
    const before = twice([result("a", true), result("b", false, ["MISSED a task"])]);
    const after = twice([result("a", true), result("b", true)]);

    const d = decide(before, after, true);
    expect(d.keep).toBe(true);
    expect(d.fixed).toEqual(["b"]);
    expect(d.beforeStablePass).toBe(1);
    expect(d.afterStablePass).toBe(2);
  });

  it("reverts when a reliably-passing case breaks, even if the total improves", () => {
    // Two fixed, one broken: a net gain that must still be rejected.
    const before = twice([
      result("a", true),
      result("b", false, ["MISSED a task"]),
      result("c", false, ["MISSED a task"]),
    ]);
    const after = twice([result("a", false, ["INVENTED CLOSING_TIME"]), result("b", true), result("c", true)]);

    const d = decide(before, after, true);
    expect(d.keep).toBe(false);
    expect(d.broken).toEqual(["a"]);
    expect(d.reasons.join(" ")).toMatch(/REVERT/);
  });

  it("reverts when the guard tests fail, whatever the score did", () => {
    const before = twice([result("a", false, ["MISSED a task"])]);
    const after = twice([result("a", true)]);

    const d = decide(before, after, false);
    expect(d.keep).toBe(false);
    expect(d.reasons.join(" ")).toMatch(/guard tests failed/);
    expect(d.reasons.join(" ")).toMatch(/invariants 8 and 10/);
  });

  it("reverts a change that only made a flaky case flakier", () => {
    const before = classifyAll([[result("a", true)], [result("a", false, ["x"])]]);
    const after = classifyAll([[result("a", false, ["x"])], [result("a", false, ["x"])]]);

    expect(decide(before, after, true).keep).toBe(false);
  });

  it("reverts a change that did nothing at all", () => {
    const before = twice([result("a", true), result("b", false, ["MISSED a task"])]);
    const d = decide(before, before, true);
    expect(d.keep).toBe(false);
    expect(d.reasons.join(" ")).toMatch(/No improvement/);
  });

  it("does not count winning a coin toss as an improvement", () => {
    // "b" was never reliable; it passing twice in a row is not evidence.
    const before = classifyAll([[result("b", true)], [result("b", false, ["x"])]]);
    const after = twice([result("b", true)]);
    // This one IS allowed to be kept — flaky to stable-pass is a real gain —
    // but only because nothing regressed alongside it.
    expect(decide(before, after, true).keep).toBe(true);
    expect(decide(before, after, true).fixed).toEqual([]);
  });
});

describe("grouping reproducible failures by likely cause", () => {
  it("groups by cause rather than by email, and never on flaky cases", () => {
    const verdicts = classifyAll([
      [
        result("hud", false, ["expected 1 task(s) but got 4: ..."]),
        result("balanced-hud", false, ["expected 1 task(s) but got 5: ..."]),
        result("flaky-one", false, ["expected 1 task(s) but got 2: ..."]),
      ],
      [
        result("hud", false, ["expected 1 task(s) but got 4: ..."]),
        result("balanced-hud", false, ["expected 1 task(s) but got 5: ..."]),
        result("flaky-one", true),
      ],
    ]);

    const clusters = clusterFailures(verdicts);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].pattern).toBe("too many tasks from one checklist");
    expect(clusters[0].cases.sort()).toEqual(["balanced-hud", "hud"]);
    expect(clusters[0].hint).toMatch(/Invariant 10/);
  });

  it("points a wrong-file failure at the diagnostic, not at the prompt", () => {
    const verdicts = twice([result("x", false, ["WRONG FILE — expected it to attach to the existing file"])]);
    const [cluster] = clusterFailures(verdicts);
    expect(cluster.pattern).toBe("filed under the wrong property");
    expect(cluster.hint).toMatch(/npm run diagnose/);
    expect(cluster.hint).toMatch(/invariant 4/);
  });

  it("says so plainly when a failure matches no known pattern", () => {
    const [cluster] = clusterFailures(twice([result("x", false, ["something nobody has seen before"])]));
    expect(cluster.pattern).toBe("other");
    expect(cluster.hint).toMatch(/No known pattern/);
  });
});
