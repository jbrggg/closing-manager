/**
 * PROMPT TUNING LOOP
 *
 *   npm run tune                     measure the prompt as it stands
 *   npm run tune -- --runs 3         measure it 3 times instead of 2
 *   npm run tune -- --apply my.ts    swap in a candidate llm-provider.ts, score
 *                                    it, and KEEP it only if it is genuinely
 *                                    better — otherwise put the old one back
 *   npm run tune -- --group larkin   work on one deal only (cheaper)
 *
 * WHAT THIS IS FOR
 *
 * Invariant 8 says the extraction prompt must not be reworded without re-running
 * the scorecard. This makes that mechanical instead of a promise: a candidate
 * prompt is measured, and if it is not better the original file is restored
 * byte-for-byte before this script exits.
 *
 * It measures more than once on purpose. The scorecard is not deterministic —
 * three runs of the same two emails on 2026-07-31 produced three different sets
 * of failures — so a single before/after comparison cannot tell an improvement
 * from luck. Only cases that pass (or fail) in EVERY run are treated as signal.
 *
 * WHAT IT DOES NOT DO
 *
 * It does not write the prompt for you. Wording the instructions for a title
 * agency's email is a judgement call about how this office works, and the point
 * of this script is to be the thing you can trust to check that judgement
 * honestly. You (or an agent) supply the candidate; this decides its fate.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { EvalCaseResult } from "./eval-types.mts";
import { classifyAll, clusterFailures, decide, type CaseVerdict } from "./tune-decide.mts";

const ROOT = path.resolve(import.meta.dirname, "..");
const PROMPT_FILE = path.join(ROOT, "src", "lib", "ai", "llm-provider.ts");
const GUARD_TESTS = "tests/llm-provider.test.ts";

const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(`--${n}`);
const option = (n: string, fb: string) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fb;
};

const runs = Math.max(1, Number(option("runs", "2")) || 2);
const candidate = option("apply", "");
const group = option("group", "");
const only = option("only", "");
const simulated = flag("simulated");

function heading(s: string) {
  console.log(`\n${"=".repeat(64)}\n${s}\n${"=".repeat(64)}`);
}

/** Run one command to completion, returning its exit code. */
function exec(command: string, args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32" });
    child.stdout.on("data", () => {});
    child.stderr.on("data", () => {});
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });
}

/** One scorecard run, returning the per-case results. */
async function scoreOnce(tmpDir: string, label: string): Promise<EvalCaseResult[]> {
  const out = path.join(tmpDir, `run-${label}-${randomUUID().slice(0, 6)}.json`);
  const args = [path.join("scripts", "eval.mts"), "--json", out];
  if (group) args.push("--group", group);
  if (only) args.push("--only", only);
  if (simulated) args.push("--simulated");

  // eval.mts exits 1 when any case fails, which is normal here — we want the
  // results either way. Only a missing output file is a real failure.
  await exec(path.join(ROOT, "node_modules", ".bin", "tsx"), args);
  if (!fs.existsSync(out)) throw new Error(`the scorecard produced no results (run ${label})`);
  return (JSON.parse(fs.readFileSync(out, "utf-8")) as { results: EvalCaseResult[] }).results;
}

async function measure(tmpDir: string, label: string): Promise<Map<string, CaseVerdict>> {
  const batches: EvalCaseResult[][] = [];
  for (let i = 1; i <= runs; i++) {
    process.stdout.write(`  ${label} run ${i} of ${runs}...`);
    batches.push(await scoreOnce(tmpDir, `${label}${i}`));
    console.log(" done");
  }
  return classifyAll(batches);
}

function report(verdicts: Map<string, CaseVerdict>) {
  const by = (s: string) => [...verdicts.values()].filter((v) => v.stability === s);
  console.log(
    `\n  ${by("stable-pass").length} pass every run, ` +
      `${by("flaky").length} come and go, ` +
      `${by("stable-fail").length} fail every run (of ${verdicts.size})`
  );
  const flaky = by("flaky");
  if (flaky.length > 0) {
    console.log(`\n  Not reliable either way — do not tune against these:`);
    for (const v of flaky) console.log(`    ${v.id}  (passed ${v.passes} of ${v.runs})`);
  }
}

/** Do the guard tests still pass? Invariants 8 and 10 live in this file. */
async function guardsPass(): Promise<boolean> {
  return (await exec(path.join(ROOT, "node_modules", ".bin", "vitest"), ["run", GUARD_TESTS])) === 0;
}

// --- main --------------------------------------------------------------------
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cm-tune-"));
/** The exact bytes of the prompt file as found. Restoring these is what makes
 *  "it will put it back" a fact rather than a promise. */
const originalPrompt = fs.readFileSync(PROMPT_FILE);
let restored = false;

function restorePrompt(why: string) {
  if (restored || !candidate) return;
  fs.writeFileSync(PROMPT_FILE, originalPrompt);
  restored = true;
  console.log(`\n  Put the original llm-provider.ts back (${why}).`);
}

// If this process is killed part-way through, the prompt file must not be left
// in a half-tested state on the user's disk.
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    restorePrompt("interrupted");
    process.exit(130);
  });
}

try {
  heading(`Measuring the prompt as it stands (${runs} run${runs === 1 ? "" : "s"})`);
  const before = await measure(tmpDir, "before");
  report(before);

  const clusters = clusterFailures(before);
  if (clusters.length > 0) {
    console.log(`\n  Reproducible failures, grouped by likely cause:`);
    for (const c of clusters) {
      console.log(`\n    ${c.pattern.toUpperCase()} — ${c.cases.length} case(s): ${c.cases.join(", ")}`);
      console.log(`      ${c.hint}`);
      for (const e of c.examples) console.log(`      e.g. ${e}`);
    }
  }

  if (!candidate) {
    console.log(
      `\n  No candidate prompt given, so nothing was changed.\n` +
        `  When you have one: npm run tune -- --apply path/to/candidate-llm-provider.ts`
    );
    process.exit(0);
  }

  // --- try the candidate ------------------------------------------------------
  const candidatePath = path.resolve(ROOT, candidate);
  if (!fs.existsSync(candidatePath)) {
    console.error(`\nThere is no file at ${candidatePath}. Nothing was changed.`);
    process.exit(2);
  }

  heading("Trying the candidate prompt");
  fs.writeFileSync(PROMPT_FILE, fs.readFileSync(candidatePath));
  console.log(`  Swapped in ${path.relative(ROOT, candidatePath)}.`);

  process.stdout.write("  Checking the guard tests...");
  const guarded = await guardsPass();
  console.log(guarded ? " they pass" : " THEY FAIL");

  // No point spending money scoring a prompt that already broke an invariant.
  const after = guarded ? await measure(tmpDir, "after") : new Map<string, CaseVerdict>();
  if (guarded) report(after);

  const decision = decide(before, after, guarded);

  heading("Verdict");
  for (const r of decision.reasons) console.log(`  ${r}`);

  if (decision.keep) {
    console.log(`\n  Kept the candidate. Run \`npm run verify\` before committing.`);
  } else {
    restorePrompt("the candidate was not better");
    console.log(`  llm-provider.ts is exactly as you found it.`);
  }
  process.exit(decision.keep ? 0 : 1);
} catch (err) {
  restorePrompt("something went wrong");
  console.error(`\nThe tuning run could not finish.\n\n${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
