/**
 * PROCESS STORED MAIL — run the AI over messages already in the database.
 *
 *   npm run process                    read the next 10 unread messages
 *   npm run process -- --limit 25      read the next 25
 *   npm run process -- --all           read everything outstanding
 *   npm run process -- --dry-run       list what WOULD be read, spend nothing
 *   npm run process -- --retry-failed  re-attempt messages that errored
 *
 * Why this exists, and why the default is 10.
 *
 * `npm run sync -- --dry-run` fetches mail from the mailbox and stores it
 * WITHOUT running the AI. That is the safe way to make first contact with a
 * live mailbox: it proves the connection works and costs nothing, because no
 * model is called. But it leaves a pile of stored messages nobody has read.
 *
 * This is the other half. It reads them in a batch you choose, so the first
 * encounter with a real mailbox is a handful of messages you can check by eye
 * and a bill you can look at — not four hundred messages processed before
 * anyone has seen whether the first one was any good.
 *
 * Every message costs a model call. There is no way to make that free, so the
 * design goal is that a mistake is cheap and visible rather than large and
 * discovered later.
 *
 * Exit codes, because a scheduled task can only see the number:
 *   0  worked (including "nothing to do")
 *   1  one or more messages failed
 */
import { all, get, run, nowIso } from "@/lib/db";
import { processEmailMessage } from "@/lib/ai/process-email";
import { recordAudit } from "@/lib/services/audit";
import { loadEnvLocal } from "./load-env.mts";
import { exitCleanly } from "./exit-cleanly.mts";

loadEnvLocal();

const flag = (name: string) => process.argv.includes(`--${name}`);
function option(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0 || !process.argv[i + 1]) return fallback;
  const parsed = Number(process.argv[i + 1]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

const dryRun = flag("dry-run");
const retryFailed = flag("retry-failed");
const limit = flag("all") ? Number.MAX_SAFE_INTEGER : option("limit", 10);

// A message counts as outstanding when no processing job has finished for it.
// FAILED jobs are excluded by default so a message that reliably breaks the
// pipeline isn't retried on every run, quietly costing money each time —
// --retry-failed is the deliberate way back in.
const outstandingSql = `
  SELECT m.id, m.subject, m.direction, m.fromAddress, m.sentAt
  FROM EmailMessage m
  WHERE NOT EXISTS (
    SELECT 1 FROM AIProcessingJob j
    WHERE j.emailMessageId = m.id
      AND j.status IN (${retryFailed ? "'DONE'" : "'DONE','FAILED','RUNNING'"})
  )
  ORDER BY m.sentAt ASC
`;

type Pending = {
  id: string;
  subject: string;
  direction: string;
  fromAddress: string;
  sentAt: string;
};

console.log("");
console.log("  Read stored mail");
console.log("  " + "=".repeat(52));

const provider = (process.env.AI_PROVIDER ?? "simulated").toLowerCase();
const usingRealModel = provider === "llm";
console.log(`  Reader:  ${usingRealModel ? "the real model (this costs money)" : "the free offline word-matcher (costs nothing)"}`);

const pending = all<Pending>(outstandingSql);

if (pending.length === 0) {
  console.log("");
  console.log("  Nothing outstanding — every stored message has been read.");
  const failed =
    get<{ c: number }>(`SELECT COUNT(*) as c FROM AIProcessingJob WHERE status = 'FAILED'`)?.c ?? 0;
  if (failed > 0) {
    console.log(`  (${failed} message(s) failed previously — retry with  npm run process -- --retry-failed)`);
  }
  console.log("");
  await exitCleanly(0);
  process.exit(0);
}

const batch = pending.slice(0, limit);

console.log(`  Waiting: ${pending.length} message(s)`);
console.log(`  Reading: ${batch.length}${pending.length > batch.length ? `  (run again for the rest)` : ""}`);
console.log("");

if (dryRun) {
  for (const m of batch) {
    console.log(`  ${m.direction === "INCOMING" ? "IN " : "OUT"}  ${m.subject.slice(0, 58)}`);
  }
  console.log("");
  console.log("  --dry-run: nothing was read, nothing was spent.");
  console.log("");
  await exitCleanly(0);
  process.exit(0);
}

const startedAt = Date.now();
let processed = 0;
const failures: string[] = [];

for (const m of batch) {
  try {
    await processEmailMessage(m.id);
    processed++;
    console.log(`  ${m.direction === "INCOMING" ? "IN " : "OUT"}  ${m.subject.slice(0, 58)}`);
  } catch (err) {
    // One unreadable message must never abort the batch — the rest of the
    // morning's mail is worth more than this one message's error.
    const detail = String(err instanceof Error ? err.message : err);
    failures.push(`${m.id}: ${detail}`);
    console.log(`  FAILED  ${m.subject.slice(0, 46)} — ${detail.slice(0, 100)}`);
  }
}

const organizationId =
  get<{ organizationId: string }>(`SELECT organizationId FROM EmailAccount LIMIT 1`)?.organizationId ??
  "org-demo";

recordAudit({
  organizationId,
  eventType: "email_processed",
  entityType: "EmailAccount",
  entityId: "batch",
  summary: `Batch read: ${processed} message(s) read, ${failures.length} failed`,
  actorType: "SYSTEM",
});

const pendingReview =
  get<{ c: number }>(`SELECT COUNT(*) as c FROM ReviewItem WHERE status = 'PENDING'`)?.c ?? 0;
const remaining = pending.length - batch.length;

console.log("");
console.log("  " + "=".repeat(52));
console.log(
  `  Read ${processed}${failures.length ? `, ${failures.length} failed` : ""} in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`
);
if (remaining > 0) {
  console.log(`  ${remaining} still waiting — run this again when you're ready.`);
}
console.log(`  ${pendingReview} item(s) now waiting for you in the review queue.`);
console.log("");
console.log("  Open the app (start-app.cmd) and go to the review queue.");
console.log("  The lines above only prove the mail was read. The review queue");
console.log("  is where you see what it concluded.");
console.log("");

// Touch the account row so the dashboard's sync panel reflects this run too.
run(`UPDATE EmailAccount SET lastSyncSummary = ?, lastSyncFinishedAt = ? WHERE id = (SELECT id FROM EmailAccount LIMIT 1)`, [
  `${processed} read${failures.length ? `, ${failures.length} failed` : ""}`,
  nowIso(),
]);

await exitCleanly(failures.length > 0 ? 1 : 0);
