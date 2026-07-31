/**
 * ONE HEALTH CHECK COMMAND
 *
 *   npm run verify          type check + tests + linter, all at the same time
 *   npm run verify:full     the above, then the production build
 *
 * Replaces running four commands one after another and reading four walls of
 * output. Prints one line per check and a single verdict at the end.
 *
 * The three fast checks don't depend on each other, so they run side by side.
 * The build is slow and is only needed before shipping, so it's opt-in and
 * runs last (it also needs the type check to have passed to be meaningful).
 */
import { spawn } from "node:child_process";

const wantBuild = process.argv.includes("--build");

const CHECKS = [
  { name: "Type check", cmd: "npx", args: ["tsc", "--noEmit"], explain: "the code's own consistency" },
  { name: "Tests", cmd: "npx", args: ["vitest", "run"], explain: "the app still behaves correctly" },
  { name: "Linter", cmd: "npx", args: ["eslint"], explain: "style and common mistakes" },
];

function run({ name, cmd, args }) {
  const startedAt = Date.now();
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { shell: process.platform === "win32" });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("error", (err) => resolve({ name, ok: false, out: String(err), ms: Date.now() - startedAt }));
    child.on("close", (code) => resolve({ name, ok: code === 0, out, ms: Date.now() - startedAt }));
  });
}

const results = await Promise.all(CHECKS.map(run));

if (wantBuild) {
  results.push(await run({ name: "Production build", cmd: "npx", args: ["next", "build"] }));
}

console.log("");
for (const r of results) {
  const secs = (r.ms / 1000).toFixed(1);
  console.log(`${r.ok ? "  OK  " : " FAIL "} ${r.name.padEnd(18)} ${secs}s`);
}

const failed = results.filter((r) => !r.ok);

if (failed.length === 0) {
  console.log("\nEverything passed.");
  if (!wantBuild) console.log("(Run `npm run verify:full` to also check the production build.)");
  process.exit(0);
}

console.log(`\n${failed.length} check(s) failed. Details below.\n`);
for (const r of failed) {
  console.log("=".repeat(60));
  console.log(r.name);
  console.log("=".repeat(60));
  console.log(r.out.trim());
  console.log("");
}
process.exit(1);
