/**
 * BACK UP TO GITHUB
 *
 *   npm run backup
 *
 * Every commit already pushes itself (see .githooks/post-commit). This is the
 * manual version for when that failed — offline, credentials expired, or a
 * push that was rejected — and for answering the question "is my work safe
 * right now?" without reading git output.
 *
 * It reports in plain English and never destroys anything: no force, no
 * rebase, no history rewriting.
 */
import { execFileSync } from "node:child_process";

function git(args, { quiet = false } = {}) {
  try {
    return execFileSync("git", args, { encoding: "utf-8", stdio: quiet ? "pipe" : ["pipe", "pipe", "pipe"] }).trim();
  } catch (err) {
    if (quiet) return "";
    throw err;
  }
}

console.log("");
console.log("  Backup to GitHub");
console.log("  " + "-".repeat(50));

const remote = git(["remote", "get-url", "origin"], { quiet: true });
if (!remote) {
  console.log("  No GitHub repository is connected to this folder.");
  console.log("  Nothing is being backed up anywhere.\n");
  console.log("  To connect one, see Step 5 of NEXT-STEPS.md.\n");
  process.exit(2);
}
console.log(`  Repository: ${remote}`);

const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
const uncommitted = git(["status", "--porcelain"], { quiet: true });

if (uncommitted) {
  const files = uncommitted.split("\n").filter(Boolean);
  console.log("");
  console.log(`  ${files.length} file(s) have changes that are not committed yet:`);
  for (const line of files.slice(0, 10)) console.log(`      ${line.trim()}`);
  if (files.length > 10) console.log(`      ...and ${files.length - 10} more`);
  console.log("");
  console.log("  These will NOT be backed up. A backup only covers committed work.");
  console.log("  Ask me to commit them, or run:  git add -A && git commit -m \"...\"");
}

// What is on this machine and not on GitHub yet.
git(["fetch", "origin", branch], { quiet: true });
const unpushed = git(["log", "--oneline", `origin/${branch}..HEAD`], { quiet: true });

if (!unpushed) {
  console.log("");
  console.log("  Already up to date — everything committed is on GitHub.\n");
  process.exit(0);
}

const count = unpushed.split("\n").filter(Boolean).length;
console.log("");
console.log(`  ${count} commit(s) on this machine only:`);
for (const line of unpushed.split("\n").slice(0, 10)) console.log(`      ${line}`);
console.log("");

try {
  execFileSync("git", ["push", "origin", branch], { stdio: "inherit" });
  console.log("");
  console.log(`  Backed up. All ${count} commit(s) are now on GitHub.\n`);
} catch {
  console.log("");
  console.log("  The push did not go through. Your work is still safe on this");
  console.log("  machine — it just isn't backed up yet. Common causes:");
  console.log("    - no internet connection");
  console.log("    - GitHub sign-in expired: a browser window may be waiting");
  console.log("    - someone else pushed first: run  git pull  then try again\n");
  process.exit(1);
}
