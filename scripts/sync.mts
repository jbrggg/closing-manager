/**
 * SYNC — fetches new mail and runs it through the AI, with no browser open.
 *
 *   npm run sync
 *   npm run sync -- --quiet     one line of output, for a scheduled task
 *   npm run sync -- --dry-run   fetch and store mail, but don't run the AI
 *
 * The app's own /api/v1/integrations/microsoft/sync route does the same work,
 * but it requires a signed-in browser session, which a scheduled task does not
 * have. This does the same thing directly against the database so Windows Task
 * Scheduler can drive it on a timer.
 *
 * Exit codes, because a scheduled task can only see the number:
 *   0  worked (including "nothing new")
 *   1  something is wrong and needs a person
 *   2  nothing is connected yet
 *
 * Everything it does is recorded on the same audit trail as a sync started
 * from the browser, so the AI Activity page shows both identically.
 */
import { get, run, nowIso } from "@/lib/db";
import { MicrosoftEmailProvider } from "@/lib/email/microsoft-provider";
import { processEmailMessage } from "@/lib/ai/process-email";
import { recordAudit } from "@/lib/services/audit";
import { diagnoseGraphResponse, formatDiagnosis } from "@/lib/email/microsoft-diagnostics";
import { loadEnvLocal } from "./load-env.mts";
import { exitCleanly } from "./exit-cleanly.mts";

loadEnvLocal();

const quiet = process.argv.includes("--quiet");
const dryRun = process.argv.includes("--dry-run");
const startedAt = Date.now();

/** Suppressed by --quiet; the summary line always prints. */
function say(line = "") {
  if (!quiet) console.log(line);
}

function stamp(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

say("");
say("  Mailbox sync");
say("  " + "=".repeat(50));
say("");

const account = get<{ id: string; emailAddress: string; connected: number }>(
  `SELECT id, emailAddress, connected FROM EmailAccount WHERE providerType = 'MICROSOFT_365' LIMIT 1`
);

if (!account) {
  console.log(`${stamp()}  sync: no Outlook mailbox is connected yet.`);
  say("");
  say("  Connect one first:");
  say("    1.  npm run preflight");
  say("    2.  npm run dev");
  say("    3.  open http://localhost:3000/settings and click Connect Outlook");
  say("");
  await exitCleanly(2);
  process.exit(2);
}

say(`  Mailbox: ${account.emailAddress}`);
say("");

try {
  const provider = new MicrosoftEmailProvider(account.id, account.emailAddress);
  const fetched = await provider.syncMailbox();

  say(`  Fetched ${fetched.length} new message(s).`);

  let processed = 0;
  const failures: string[] = [];

  if (dryRun) {
    say("  --dry-run: messages stored, AI not run.");
  } else {
    for (const message of fetched) {
      try {
        await processEmailMessage(message.id);
        processed++;
        say(`    read: ${message.subject.slice(0, 60)}`);
      } catch (err) {
        // One unreadable message must never abort the run — the rest of the
        // morning's mail is more valuable than this one message's error.
        const detail = String(err instanceof Error ? err.message : err);
        failures.push(`${message.id}: ${detail}`);
        say(`    FAILED: ${message.subject.slice(0, 50)} — ${detail.slice(0, 120)}`);
      }
    }
  }

  const pending =
    get<{ c: number }>(`SELECT COUNT(*) as c FROM ReviewItem WHERE status = 'PENDING'`)?.c ?? 0;

  const organizationId =
    get<{ organizationId: string }>(`SELECT organizationId FROM EmailAccount WHERE id = ?`, [
      account.id,
    ])?.organizationId ?? "org-demo";

  recordAudit({
    organizationId,
    eventType: "email_processed",
    entityType: "EmailAccount",
    entityId: account.id,
    summary: `Scheduled sync: ${fetched.length} new message(s), ${processed} processed, ${failures.length} failed`,
    actorType: "SYSTEM",
  });

  // A run that fetched nothing is still a healthy run, and the dashboard needs
  // to know that — "last synced 3 days ago" on a quiet mailbox is alarming for
  // no reason. syncMailbox already stamps lastSyncedAt; this records the
  // outcome so the dashboard can show what the last run actually did.
  run(
    `UPDATE EmailAccount SET lastSyncSummary = ?, lastSyncFinishedAt = ? WHERE id = ?`,
    [
      `${fetched.length} fetched, ${processed} processed${failures.length ? `, ${failures.length} failed` : ""}`,
      nowIso(),
      account.id,
    ]
  );

  say("");
  say("  " + "=".repeat(50));

  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `${stamp()}  sync ok: ${fetched.length} fetched, ${processed} processed, ` +
      `${failures.length} failed, ${pending} awaiting review (${seconds}s)`
  );

  if (pending > 0) say(`\n  ${pending} item(s) waiting for you at http://localhost:3000/review\n`);

  // Failures inside individual messages are worth a non-zero exit so a
  // scheduled task can be set to notify, but the mail itself is safely stored.
  await exitCleanly(failures.length > 0 ? 1 : 0);
} catch (err) {
  const detail = String(err instanceof Error ? err.message : err);
  console.log(`${stamp()}  sync FAILED: ${detail.slice(0, 200)}`);

  // Pull the HTTP status back out of the adapter's message so the same
  // plain-English diagnosis the browser flow gives is available here too.
  const status = Number(detail.match(/\((\d{3})\)/)?.[1] ?? 0);
  if (status) {
    say("");
    say(formatDiagnosis(diagnoseGraphResponse(status, detail)));
  }
  say("");
  await exitCleanly(1);
}
