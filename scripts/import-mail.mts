/**
 * IMPORT REAL MAIL FROM FILES
 *
 *   npm run import                      read everything in ./inbox
 *   npm run import -- --dir C:\path     read a different folder
 *   npm run import -- --dry-run         show what would be imported, change nothing
 *   npm run import -- --reset           clear previous imports first
 *
 * Why this exists: connecting a live mailbox needs an Entra app registration,
 * which is a portal job. Exporting messages to a file needs nothing. This puts
 * real email through the real pipeline today — same extraction, same matching,
 * same review queue — so the AI can be judged on real mail before any adapter
 * is live.
 *
 * Accepts:
 *   .eml    one message per file (Gmail: "Show original" then "Download Original")
 *   .mbox   many messages in one file (Google Takeout, one download for the lot)
 *
 * FORWARDED MAIL IS HANDLED PROPERLY. When you forward work email to a test
 * account the envelope says you sent it, which would make every message look
 * INCOMING and would leave the real content in the quoted section the AI never
 * reads. This unwraps the forward, recovers the original sender, and decides
 * direction from that — see src/lib/email/forwarded.ts.
 *
 * For that to work, set your own domains in .env.local:
 *   ORG_EMAIL_DOMAINS=aglobaltitleagency.com,psatitle.com
 * Anything from those is OUTGOING; everything else is INCOMING.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { all, get, run, nowIso } from "@/lib/db";
import { parseEml, splitMbox } from "@/lib/email/eml";
import { unwrapForwarded, directionFor } from "@/lib/email/forwarded";
import { getDocumentStore } from "@/lib/storage";
import { processEmailMessage } from "@/lib/ai/process-email";
import { recordAudit } from "@/lib/services/audit";
import { loadEnvLocal } from "./load-env.mts";
import { exitCleanly } from "./exit-cleanly.mts";

loadEnvLocal();

const ROOT = path.resolve(import.meta.dirname, "..");
const ORG_ID = "org-demo";

function option(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const dir = path.resolve(option("dir", path.join(ROOT, "inbox")));
const dryRun = flag("dry-run");
const reset = flag("reset");

// --- account -----------------------------------------------------------------

function ensureAccount(): { id: string; emailAddress: string } {
  const existing = get<{ id: string; emailAddress: string }>(
    `SELECT id, emailAddress FROM EmailAccount ORDER BY providerType = 'MOCK' DESC LIMIT 1`
  );
  if (existing) return existing;

  const id = `acct-import-${randomUUID().slice(0, 8)}`;
  const address = process.env.ORG_MAILBOX_ADDRESS ?? "closings@keystonetitle.com";
  run(`INSERT OR IGNORE INTO Organization (id, name, timezone, createdAt) VALUES (?, ?, ?, ?)`, [
    ORG_ID,
    "Keystone Title",
    "America/New_York",
    nowIso(),
  ]);
  run(
    `INSERT INTO EmailAccount (id, organizationId, providerType, emailAddress, connected) VALUES (?, ?, 'MOCK', ?, 1)`,
    [id, ORG_ID, address]
  );
  return { id, emailAddress: address };
}

// --- gather ------------------------------------------------------------------

function rawMessagesIn(directory: string): { source: string; raw: string }[] {
  if (!fs.existsSync(directory)) {
    console.error(`\nNo folder at ${directory}\n`);
    console.error(`Make one and put your exported email in it:\n  mkdir "${directory}"\n`);
    console.error(`In Gmail, open a message, click the three dots, "Show original",`);
    console.error(`then "Download Original". Drop the .eml files in that folder.\n`);
    exitCleanly(2);
  }

  const out: { source: string; raw: string }[] = [];
  for (const name of fs.readdirSync(directory).sort()) {
    const full = path.join(directory, name);
    if (!fs.statSync(full).isFile()) continue;
    const lower = name.toLowerCase();
    if (!lower.endsWith(".eml") && !lower.endsWith(".mbox") && !lower.endsWith(".txt")) continue;

    const raw = fs.readFileSync(full, "utf-8");
    if (lower.endsWith(".mbox")) {
      splitMbox(raw).forEach((msg, i) => out.push({ source: `${name}#${i + 1}`, raw: msg }));
    } else {
      out.push({ source: name, raw });
    }
  }
  return out;
}

// --- run ---------------------------------------------------------------------

console.log("");
console.log("  Import real mail");
console.log("  " + "-".repeat(52));
console.log(`  Folder:  ${dir}`);

if (!process.env.ORG_EMAIL_DOMAINS && !process.env.ORG_EMAIL_ADDRESSES) {
  console.log("");
  console.log("  WARNING: ORG_EMAIL_DOMAINS is not set in .env.local.");
  console.log("  Without it, forwarded mail cannot be told apart from mail you");
  console.log("  received, and everything will be filed as INCOMING. Add e.g.");
  console.log("    ORG_EMAIL_DOMAINS=youragency.com");
  console.log("  and run this again.");
}

const messages = rawMessagesIn(dir);
if (messages.length === 0) {
  console.log("\n  Nothing to import — no .eml or .mbox files in that folder.\n");
  exitCleanly(0);
}

const account = ensureAccount();
const store = getDocumentStore();

if (reset && !dryRun) {
  const ids = all<{ id: string }>(`SELECT id FROM EmailMessage WHERE id LIKE 'import-%'`).map((r) => r.id);
  for (const table of ["ExtractedFact", "AIProposal", "ReviewItem"]) {
    for (const id of ids) run(`DELETE FROM ${table} WHERE sourceEmailId = ?`, [id]).changes;
  }
  run(`DELETE FROM EmailMessage WHERE id LIKE 'import-%'`);
  run(`DELETE FROM EmailThread WHERE id LIKE 'import-%'`);
  console.log(`  Cleared ${ids.length} previously imported message(s).`);
}

console.log(`  Found:   ${messages.length} message(s)`);
console.log("");

let imported = 0;
let skipped = 0;
let failed = 0;
const summary: string[] = [];

for (const { source, raw } of messages) {
  let parsed;
  try {
    parsed = parseEml(raw);
  } catch (err) {
    console.log(`  SKIP  ${source} — could not be read (${String(err)})`);
    failed++;
    continue;
  }

  const unwrapped = unwrapForwarded(parsed.body);
  const direction =
    directionFor({ fromAddress: parsed.from, unwrapped }, account.emailAddress) ?? "INCOMING";

  // On a forward the original sender is who the app should treat as the
  // counterparty; the forwarding envelope is just how it reached us.
  const effectiveFrom = unwrapped.isForwarded && unwrapped.original?.from
    ? unwrapped.original.from
    : parsed.from;

  const effectiveTo = unwrapped.isForwarded && unwrapped.original?.to?.length
    ? unwrapped.original.to
    : parsed.to;

  const sentAt = (unwrapped.isForwarded ? unwrapped.original?.sentAt : undefined)
    ?? parsed.sentAt
    ?? nowIso();

  // Stable id from the Message-ID so re-running does not duplicate work.
  const stableKey = (parsed.messageId ?? `${source}:${parsed.subject}:${sentAt}`)
    .replace(/[^A-Za-z0-9._@-]/g, "")
    .slice(0, 60);
  const messageId = `import-m-${stableKey}`;

  if (get(`SELECT id FROM EmailMessage WHERE id = ?`, [messageId])) {
    skipped++;
    continue;
  }

  const label = `${direction === "INCOMING" ? "IN " : "OUT"}  ${parsed.subject.slice(0, 58)}`;
  const forwardNote = unwrapped.isForwarded ? `  (forward, original from ${effectiveFrom})` : "";

  if (dryRun) {
    console.log(`  ${label}${forwardNote}`);
    imported++;
    continue;
  }

  const threadId = `import-t-${stableKey}`;
  const participants = [...new Set([effectiveFrom, ...effectiveTo, ...parsed.participants])].filter(Boolean);

  run(
    `INSERT OR IGNORE INTO EmailThread (id, emailAccountId, subject, participants, createdAt) VALUES (?, ?, ?, ?, ?)`,
    [threadId, account.id, parsed.subject, JSON.stringify(participants), sentAt]
  );
  run(
    `INSERT INTO EmailMessage (id, threadId, providerMsgId, fromAddress, toAddresses, subject, bodyText, direction, sentAt, quotedText)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    [
      messageId,
      threadId,
      parsed.messageId ?? messageId,
      effectiveFrom,
      JSON.stringify(effectiveTo),
      parsed.subject,
      // The FULL text, deliberately. On a forward the quoted part is the message.
      unwrapped.body,
      direction,
      sentAt,
    ]
  );

  // Keep the documents, not just the fact that documents existed. In title
  // work the HUD, CPL and commitment ARE the job.
  let storedCount = 0;
  for (const att of parsed.attachments) {
    try {
      const doc = await store.put(att.bytes, att.filename);
      run(
        `INSERT INTO EmailAttachment (id, messageId, filename, mimeType, sizeBytes, storageKey, sha256)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [randomUUID(), messageId, att.filename, att.mimeType, doc.sizeBytes, doc.storageKey, doc.sha256]
      );
      storedCount++;
    } catch (err) {
      // A document we cannot store must not lose us the email.
      console.log(`        ! could not store "${att.filename}": ${String(err instanceof Error ? err.message : err)}`);
    }
  }

  recordAudit({
    organizationId: ORG_ID,
    eventType: "email_imported",
    entityType: "EmailMessage",
    entityId: messageId,
    summary:
      `Imported "${parsed.subject}" from ${source}` +
      (unwrapped.isForwarded ? ` — forwarded message, original sender ${effectiveFrom}` : ""),
    detail: { source, forwarded: unwrapped.isForwarded, direction },
    actorType: "SYSTEM",
  });

  try {
    await processEmailMessage(messageId);
    console.log(`  ${label}${forwardNote}${storedCount ? `  [${storedCount} file(s) kept]` : ""}`);
    summary.push(`${direction} — ${parsed.subject}`);
    imported++;
  } catch (err) {
    console.log(`  FAIL  ${parsed.subject.slice(0, 50)} — ${String(err instanceof Error ? err.message : err)}`);
    failed++;
  }
}

console.log("");
console.log("  " + "-".repeat(52));
console.log(`  Imported ${imported}${dryRun ? " (dry run — nothing was written)" : ""}` +
  (skipped ? `, skipped ${skipped} already imported` : "") +
  (failed ? `, ${failed} failed` : ""));

if (!dryRun && imported > 0) {
  const pending = all(`SELECT id FROM ReviewItem WHERE status = 'PENDING'`).length;
  console.log(`  ${pending} item(s) now waiting in the review queue.`);
  console.log("");
  console.log("  Start the app with  npm run dev  and open http://localhost:3000/review");
}
console.log("");

exitCleanly(failed > 0 ? 1 : 0);
