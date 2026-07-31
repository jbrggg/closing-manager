/**
 * ACCURACY SCORECARD
 *
 *   npm run eval                 read every email in evals/cases/ and score it
 *   npm run eval -- --simulated  same, but using the free built-in word-matcher
 *   npm run eval -- --only a2    only run cases whose id contains "a2"
 *   npm run eval -- --jobs 8     run 8 emails at a time (default 4)
 *
 * This replaces the old way of checking accuracy, which was: start the app,
 * open a browser, sign in, paste an email into the Email Test Lab, click
 * Analyze, and read the screen — about a minute per email. This does the same
 * work through the exact same pipeline, with no server and no browser, and
 * scores the answers against what you said they should be.
 *
 * It writes a plain-English report to evals/last-run.md as well as printing
 * to the screen, so you can read the results without a terminal open.
 *
 * Exit code is 0 when every case passes and 1 when any case fails, so this
 * can be used as a go/no-go gate before shipping a prompt change.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { EvalCase, EvalCaseResult } from "./eval-types.mts";

interface Usage {
  apiCalls: number;
  inputTokens: number;
  outputTokens: number;
}
type Batch = { modelVersion: string; usage: Usage; results: EvalCaseResult[] };

/** Published Anthropic pricing per million tokens. Update if pricing changes —
 *  this is only used to print a rough "what did that cost me" line. */
const PRICE_PER_MTOK = { input: 3, output: 15 };

const ROOT = path.resolve(import.meta.dirname, "..");
const CASES_DIR = path.join(ROOT, "evals", "cases");
const REPORT_PATH = path.join(ROOT, "evals", "last-run.md");

// --- arguments ---------------------------------------------------------------
const argv = process.argv.slice(2);
function flag(name: string): boolean {
  return argv.includes(`--${name}`);
}
function option(name: string, fallback: string): string {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
}

const useSimulated = flag("simulated");
const only = option("only", "");
const jobs = Math.max(1, Number(option("jobs", "4")) || 4);

// --- load cases --------------------------------------------------------------
if (!fs.existsSync(CASES_DIR)) {
  console.error(`No cases folder found at ${CASES_DIR}`);
  process.exit(2);
}

/** Every .json under evals/cases/, including the gitignored private/ folder
 *  where the agency's real redacted email lives. */
function findCaseFiles(dir: string): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return findCaseFiles(full);
      return entry.name.endsWith(".json") ? [full] : [];
    });
}

/** Read one case file, explaining the problem in plain English if it's not
 *  valid JSON — a typo in a hand-written case file should not produce a stack
 *  trace, and an empty file should be skipped rather than stopping the run. */
function readCaseFile(file: string): EvalCase[] {
  const shown = path.relative(ROOT, file);
  const text = fs.readFileSync(file, "utf-8");

  if (text.trim() === "") {
    console.log(`Skipping ${shown} — the file is empty.\n`);
    return [];
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    console.error(
      `\nThere is a typo in ${shown} and the scorecard can't read it.\n\n` +
        `  ${err instanceof Error ? err.message : String(err)}\n\n` +
        `Common causes: a missing comma between two lines, a missing closing } or ],\n` +
        `a stray comma after the last item in a list, or a " inside the email text that\n` +
        `needs to be written as \\". Compare it against evals/cases/explicit-request.json.\n`
    );
    process.exit(2);
  }

  const cases = Array.isArray(raw) ? (raw as EvalCase[]) : [raw as EvalCase];
  for (const c of cases) {
    if (!c?.id || !c?.body) {
      console.error(`\n${shown} is missing a required field. Every case needs at least "id" and "body".\n`);
      process.exit(2);
    }
  }
  return cases;
}

const allCases: EvalCase[] = findCaseFiles(CASES_DIR)
  .flatMap(readCaseFile)
  .filter((c) => !only || c.id.toLowerCase().includes(only.toLowerCase()));

if (allCases.length === 0) {
  console.error(only ? `No cases matched "${only}".` : `No cases found in ${CASES_DIR}.`);
  process.exit(2);
}

// Cases in the same group must stay together and in order — a later email in a
// group is checked for filing under an earlier one's transaction.
const groups = new Map<string, EvalCase[]>();
for (const c of allCases) {
  const key = c.group ?? c.id;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key)!.push(c);
}
const slices = [...groups.values()];

// --- provider ----------------------------------------------------------------
loadEnvLocal();
const wantLLM = !useSimulated && (process.env.AI_PROVIDER ?? "").toLowerCase() === "llm";
if (!useSimulated && !wantLLM) {
  console.log(
    "Note: AI_PROVIDER is not set to 'llm' in .env.local, so this run uses the free\n" +
      "      built-in word-matcher rather than the real AI. Results will look worse than\n" +
      "      reality. Set AI_PROVIDER=llm in .env.local to score the real AI.\n"
  );
}
if (wantLLM && !process.env.ANTHROPIC_API_KEY) {
  console.error("AI_PROVIDER=llm but no ANTHROPIC_API_KEY was found in .env.local. Stopping.");
  process.exit(2);
}

/** Read .env.local the same way the app does, so this script sees the same settings. */
function loadEnvLocal() {
  const envPath = path.join(ROOT, ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const [, key, rawValue] = m;
    if (process.env[key] !== undefined) continue;
    process.env[key] = rawValue.replace(/^["']|["']$/g, "");
  }
}

// --- run ---------------------------------------------------------------------
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cm-eval-"));
const startedAt = Date.now();

console.log(
  `Scoring ${allCases.length} email${allCases.length === 1 ? "" : "s"} ` +
    `(${slices.length} independent group${slices.length === 1 ? "" : "s"}, ${Math.min(jobs, slices.length)} at a time)...\n`
);

async function runSlice(slice: EvalCase[], index: number): Promise<Batch> {
  const casesFile = path.join(tmpDir, `cases-${index}.json`);
  const outFile = path.join(tmpDir, `out-${index}.json`);
  fs.writeFileSync(casesFile, JSON.stringify(slice));

  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs"), path.join(ROOT, "scripts", "eval-worker.mts"), casesFile, outFile],
      {
        cwd: ROOT,
        env: {
          ...process.env,
          AI_PROVIDER: useSimulated ? "simulated" : (process.env.AI_PROVIDER ?? "simulated"),
          CLOSING_MANAGER_DB_PATH: path.join(tmpDir, `eval-${index}-${randomUUID().slice(0, 6)}.db`),
        },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    let stderr = "";
    child.stdout.on("data", () => {});
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0 || !fs.existsSync(outFile)) {
        return reject(new Error(`worker ${index} failed (exit ${code}):\n${stderr.slice(0, 2000)}`));
      }
      resolve(JSON.parse(fs.readFileSync(outFile, "utf-8")));
    });
  });
}

/** Run slices with a cap on how many are in flight at once. */
async function runAll(): Promise<Batch[]> {
  const out: Batch[] = new Array(slices.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= slices.length) return;
      out[i] = await runSlice(slices[i], i);
      const done = out.filter(Boolean).length;
      process.stdout.write(`  ...${done}/${slices.length} groups finished\r`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(jobs, slices.length) }, worker));
  return out;
}

let batches: Batch[];
try {
  batches = await runAll();
} catch (err) {
  console.error(`\nThe scorecard could not finish.\n\n${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
}

const results = batches.flatMap((b) => b.results);
const modelVersion = batches[0]?.modelVersion ?? "unknown";
const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);

// --- report ------------------------------------------------------------------
const passed = results.filter((r) => r.passed).length;
const lines: string[] = [];
const say = (s = "") => {
  lines.push(s);
  console.log(s);
};

process.stdout.write("\r".padEnd(60) + "\r");
say(`Read by: ${modelVersion}${useSimulated ? "  (forced to the built-in word-matcher)" : ""}`);
say(`Finished in ${elapsedSec}s`);
say();

for (const r of results) {
  const icon = r.passed ? "PASS" : "FAIL";
  say(`${icon}  ${r.id}`);
  if (r.note) say(`      ${r.note}`);
  if (r.errored) {
    say(`      ERROR: ${r.errored}`);
    say();
    continue;
  }
  for (const f of r.findings.filter((x) => !x.ok)) {
    say(`      - ${f.detail}`);
    if (f.why) say(`        (${f.why})`);
  }
  if (r.passed) {
    const factSummary = r.observed.facts.map((f) => `${f.type}="${f.text}"`).join(", ");
    if (factSummary) say(`      ${factSummary}`);
  }
  say();
}

const usage: Usage = batches.reduce(
  (acc, b) => ({
    apiCalls: acc.apiCalls + (b.usage?.apiCalls ?? 0),
    inputTokens: acc.inputTokens + (b.usage?.inputTokens ?? 0),
    outputTokens: acc.outputTokens + (b.usage?.outputTokens ?? 0),
  }),
  { apiCalls: 0, inputTokens: 0, outputTokens: 0 }
);

const bar = "=".repeat(56);
say(bar);
say(`SCORE: ${passed} of ${results.length} emails fully correct`);
if (results.length >= 20) {
  say(
    passed >= 15
      ? "That clears the 15-of-20 bar in ROADMAP.md task A3."
      : "That is BELOW the 15-of-20 bar in ROADMAP.md task A3."
  );
}
if (usage.apiCalls > 0) {
  const dollars =
    (usage.inputTokens / 1_000_000) * PRICE_PER_MTOK.input +
    (usage.outputTokens / 1_000_000) * PRICE_PER_MTOK.output;
  const perEmail = dollars / results.length;
  say(
    `COST:  ${usage.apiCalls} API call${usage.apiCalls === 1 ? "" : "s"} for ${results.length} email${results.length === 1 ? "" : "s"} ` +
      `- about ${money(dollars)} total, ${money(perEmail)} per email`
  );
}
say(bar);

function money(d: number): string {
  return d < 1 ? `${(d * 100).toFixed(1)} cents` : `$${d.toFixed(2)}`;
}

fs.writeFileSync(
  REPORT_PATH,
  [
    `# Accuracy scorecard — ${new Date().toISOString()}`,
    "",
    "Generated by `npm run eval`. Overwritten on every run.",
    "",
    "```",
    ...lines,
    "```",
    "",
  ].join("\n")
);
say(`\nSaved a copy of this report to evals/last-run.md`);

fs.rmSync(tmpDir, { recursive: true, force: true });
process.exit(passed === results.length ? 0 : 1);
