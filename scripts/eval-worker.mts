/**
 * Eval worker — runs a slice of test emails through the REAL AI pipeline.
 *
 * Not meant to be run by hand. `scripts/eval.mts` starts several of these
 * at once, each with its own throwaway database, and collects the results.
 *
 * Why a separate process per slice: the data layer holds one database
 * connection per process, so giving each worker its own process is the
 * simplest way to keep test emails from contaminating each other's results.
 *
 * Reads:  argv[2] = path to a JSON file containing the cases for this slice
 * Writes: argv[3] = path to write this slice's results as JSON
 *
 * Required env: CLOSING_MANAGER_DB_PATH (a throwaway .db file, unique per worker)
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { all, run, nowIso } from "@/lib/db";
import { processEmailMessage, MATCHED_FACT_TYPES } from "@/lib/ai/process-email";
import { getActiveAIProvider } from "@/lib/ai";
import { getUsageStats } from "@/lib/ai/llm-provider";
import type { EvalCase, EvalCaseResult, Finding, Identifier, MatchEvidence } from "./eval-types.mts";

const ORG_ID = "org-demo";
const ACCOUNT_ADDRESS = "closings@keystonetitle.com";

const casesPath = process.argv[2];
const outPath = process.argv[3];
if (!casesPath || !outPath) {
  console.error("eval-worker: expected <cases.json> <out.json>");
  process.exit(2);
}

const cases: EvalCase[] = JSON.parse(fs.readFileSync(casesPath, "utf-8"));

/**
 * Minimal fixture: just enough for the pipeline to run. Deliberately does
 * NOT load the nine demo emails — each test email should be judged on its
 * own, not against demo data that happens to mention similar addresses.
 */
function seedMinimal(accountId: string) {
  run(`INSERT OR IGNORE INTO Organization (id, name, timezone, createdAt) VALUES (?, ?, ?, ?)`, [
    ORG_ID,
    "Keystone Title (eval fixture)",
    "America/New_York",
    nowIso(),
  ]);
  run(
    `INSERT OR IGNORE INTO EmailAccount (id, organizationId, providerType, emailAddress, connected) VALUES (?, ?, 'MOCK', ?, 1)`,
    [accountId, ORG_ID, ACCOUNT_ADDRESS]
  );
}

/** Turn a stored fact value back into the text a person would see on screen. */
function factText(structuredValue: string): string {
  let v: unknown;
  try {
    v = JSON.parse(structuredValue);
  } catch {
    return structuredValue;
  }
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    // e.g. { dayOfWeek: "thursday", raw: "thursday" }
    return Object.values(v as Record<string, unknown>)
      .filter((x) => typeof x === "string" || typeof x === "number")
      .join(" ");
  }
  return String(v);
}

function includesLoose(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

const IDENTIFIER_TYPES: readonly string[] = MATCHED_FACT_TYPES;

/** Every identifying fact currently believed about one file. */
function identifiersOf(transactionId: string): Identifier[] {
  return all<{ factType: string; structuredValue: string }>(
    `SELECT factType, structuredValue FROM ExtractedFact
     WHERE transactionId = ? AND status = 'CURRENT' AND factType IN (${IDENTIFIER_TYPES.map(() => "?").join(",")})`,
    [transactionId, ...IDENTIFIER_TYPES]
  ).map((f) => ({ type: f.factType, value: factText(f.structuredValue) }));
}

/**
 * What the AI read out of one message, from the `facts_extracted` audit event
 * the pipeline writes. Scoped by both the watermark and the message id, so a
 * later case in the same group cannot be credited with an earlier one's facts.
 */
function readFactsExtractedFromMessage(
  auditWatermark: number,
  messageId: string
): { type: string; value: unknown; confidence: number }[] {
  const row = all<{ detail: string | null }>(
    `SELECT detail FROM AuditEvent
     WHERE eventType = 'facts_extracted' AND rowid > ?
     ORDER BY rowid DESC LIMIT 1`,
    [auditWatermark]
  )[0];
  if (!row?.detail) return [];
  try {
    const d = JSON.parse(row.detail) as {
      messageId?: string;
      extractedFromThisMessage?: { type: string; value: unknown; confidence: number }[];
    };
    if (d.messageId !== messageId) return [];
    return d.extractedFromThisMessage ?? [];
  } catch {
    return [];
  }
}

/**
 * Lift the matching decision out of the throwaway database before it is
 * deleted. Reads the `transaction_matched` audit event this case just wrote —
 * `rowid > watermark` picks out this email's event rather than an earlier
 * case's, because every case in a group shares one database.
 *
 * Recomputes nothing. If the audit event is missing, says so by returning null
 * rather than guessing.
 */
function collectMatchEvidence(auditWatermark: number): MatchEvidence | null {
  const row = all<{ entityId: string | null; detail: string | null }>(
    `SELECT entityId, detail FROM AuditEvent
     WHERE eventType = 'transaction_matched' AND rowid > ?
     ORDER BY rowid DESC LIMIT 1`,
    [auditWatermark]
  )[0];
  if (!row?.detail) return null;

  let detail: Partial<MatchEvidence>;
  try {
    detail = JSON.parse(row.detail) as Partial<MatchEvidence>;
  } catch {
    return null;
  }

  const filedOnTransactionId = row.entityId ?? null;
  const otherFiles = all<{ id: string }>(`SELECT id FROM TransactionRecord WHERE id != ?`, [
    filedOnTransactionId ?? "",
  ]).map((t) => ({ transactionId: t.id, identifiers: identifiersOf(t.id) }));

  return {
    score: detail.score ?? 0,
    isStrongMatch: detail.isStrongMatch ?? false,
    reasons: detail.reasons ?? [],
    bestCandidateTransactionId: detail.bestCandidateTransactionId ?? null,
    transactionsConsidered: detail.transactionsConsidered ?? 0,
    identifiersExtracted: detail.identifiersExtracted ?? [],
    filedOnTransactionId,
    otherFiles,
  };
}

/** Whole-word match — so looking for "AM" doesn't fire on "Thursday at 10am"... it should, but not on "MAIN". */
function includesWord(haystack: string, word: string): boolean {
  return new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(haystack);
}

async function runCase(c: EvalCase, accountId: string): Promise<EvalCaseResult> {
  const startedAt = Date.now();
  const threadId = `eval-t-${randomUUID().slice(0, 8)}`;
  const messageId = `eval-m-${randomUUID().slice(0, 8)}`;
  const sentAt = c.sentAt ?? nowIso();
  const direction = c.direction ?? "INCOMING";
  const fromAddress = direction === "INCOMING" ? c.from : ACCOUNT_ADDRESS;
  const toAddress = direction === "INCOMING" ? ACCOUNT_ADDRESS : c.from;

  run(
    `INSERT INTO EmailThread (id, emailAccountId, subject, participants, createdAt) VALUES (?, ?, ?, ?, ?)`,
    [threadId, accountId, c.subject, JSON.stringify([c.from, ACCOUNT_ADDRESS]), sentAt]
  );
  run(
    `INSERT INTO EmailMessage (id, threadId, providerMsgId, fromAddress, toAddresses, subject, bodyText, direction, sentAt, quotedText)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    [messageId, threadId, `eval-${messageId}`, fromAddress, JSON.stringify([toAddress]), c.subject, c.body, direction, sentAt]
  );

  const transactionsBefore = all<{ id: string }>(`SELECT id FROM TransactionRecord`).map((t) => t.id);
  // Where the audit trail stands before this email is processed, so the
  // matching decision written below can be told apart from earlier cases' in
  // the same group.
  const auditWatermark = all<{ n: number }>(`SELECT COALESCE(MAX(rowid), 0) as n FROM AuditEvent`)[0]?.n ?? 0;

  try {
    await processEmailMessage(messageId);
  } catch (err) {
    return {
      id: c.id,
      group: c.group ?? c.id,
      note: c.note,
      passed: false,
      errored: String(err instanceof Error ? err.message : err),
      findings: [],
      observed: { facts: [], tasks: [], filing: "unknown", duplicateFlagged: false, match: null },
      elapsedMs: Date.now() - startedAt,
    };
  }

  const matchEvidence = collectMatchEvidence(auditWatermark);

  // --- Read back exactly what the app recorded ------------------------------
  const factRows = all<{ factType: string; structuredValue: string; confidence: number; transactionId: string }>(
    `SELECT factType, structuredValue, confidence, transactionId FROM ExtractedFact WHERE sourceEmailId = ?`,
    [messageId]
  );
  // What the app STORED against this email...
  const observedFacts = factRows.map((f) => ({
    type: f.factType,
    text: factText(f.structuredValue),
    confidence: f.confidence,
  }));

  // ...plus what the AI READ from it but the app had no reason to store again.
  // Scoring extraction on stored rows alone punishes the model for the dedup
  // system working: a fact the transaction already holds is not re-inserted, so
  // it never carries this email's sourceEmailId. Judged that way, an email that
  // repeated a file number correctly looked like it had missed it entirely.
  // The scorecard asks "did it read this?", so that is what it now checks.
  for (const f of readFactsExtractedFromMessage(auditWatermark, messageId)) {
    const text = typeof f.value === "object" ? factText(JSON.stringify(f.value)) : String(f.value);
    if (observedFacts.some((o) => o.type === f.type && o.text === text)) continue;
    observedFacts.push({ type: f.type, text, confidence: f.confidence });
  }

  const proposalRows = all<{ proposalType: string; payload: string; confidence: number }>(
    `SELECT proposalType, payload, confidence FROM AIProposal WHERE sourceEmailIds LIKE ?`,
    [`%${messageId}%`]
  );
  const observedTasks = proposalRows
    .filter((p) => p.proposalType === "TASK_CREATE")
    .map((p) => {
      const payload = JSON.parse(p.payload) as { title?: string; category?: string };
      return { title: payload.title ?? "", category: payload.category ?? "", confidence: p.confidence };
    });
  const proposedClosing = proposalRows.some((p) => p.proposalType.startsWith("CLOSING_"));

  const transactionId = factRows[0]?.transactionId ?? null;

  // Was this flagged as a possible duplicate? Two places record it: a review
  // item's duplicateCandidates list (when a proposal was created) and the
  // audit trail (when none was, e.g. our own outgoing mail that raises no
  // task). Check both — otherwise the flag is invisible on exactly the emails
  // where it matters most.
  const flaggedOnReview = transactionId
    ? all<{ n: number }>(
        `SELECT COUNT(*) as n FROM ReviewItem WHERE transactionId = ? AND duplicateCandidates IS NOT NULL`,
        [transactionId]
      )[0]?.n ?? 0
    : 0;
  const flaggedInAudit = transactionId
    ? all<{ n: number }>(
        `SELECT COUNT(*) as n FROM AuditEvent
         WHERE entityId = ? AND eventType = 'transaction_matched' AND summary LIKE '%possible duplicate%'`,
        [transactionId]
      )[0]?.n ?? 0
    : 0;
  const duplicateFlagged = flaggedOnReview > 0 || flaggedInAudit > 0;
  const filing: EvalCaseResult["observed"]["filing"] = !transactionId
    ? "unknown"
    : transactionsBefore.includes(transactionId)
    ? "existing"
    : "new";

  // --- Score ----------------------------------------------------------------
  const findings: Finding[] = [];
  const e = c.expect ?? {};

  for (const want of e.facts ?? []) {
    const hit = observedFacts.find((f) => f.type === want.type && includesLoose(f.text, want.contains));
    if (hit) {
      findings.push({ ok: true, kind: "fact", detail: `${want.type} = "${hit.text}" (${Math.round(hit.confidence * 100)}%)` });
    } else {
      const sameType = observedFacts.filter((f) => f.type === want.type).map((f) => `"${f.text}"`);
      findings.push({
        ok: false,
        kind: "fact",
        detail: `MISSED ${want.type} containing "${want.contains}"${sameType.length ? ` — it found ${sameType.join(", ")} instead` : " — it found nothing of this kind"}`,
        why: want.why,
      });
    }
  }

  for (const forbidden of e.mustNotSay ?? []) {
    const offender = observedFacts.find((f) => f.type === forbidden.type && includesWord(f.text, forbidden.text));
    findings.push(
      offender
        ? {
            ok: false,
            kind: "invented",
            detail: `INVENTED — ${forbidden.type} came back as "${offender.text}", which contains "${forbidden.text}"`,
            why: forbidden.why,
          }
        : { ok: true, kind: "invented", detail: `did not invent "${forbidden.text}" in ${forbidden.type}` }
    );
  }

  for (const want of e.tasks ?? []) {
    const hit = observedTasks.find((t) => includesLoose(`${t.title} ${t.category}`, want.contains));
    findings.push(
      hit
        ? { ok: true, kind: "task", detail: `task "${hit.title}" (${Math.round(hit.confidence * 100)}%)` }
        : {
            ok: false,
            kind: "task",
            detail: `MISSED a task about "${want.contains}"${observedTasks.length ? ` — it proposed ${observedTasks.map((t) => `"${t.title}"`).join(", ")} instead` : " — it proposed no tasks at all"}`,
            why: want.why,
          }
    );
  }

  if (typeof e.taskCount === "number") {
    findings.push(
      observedTasks.length === e.taskCount
        ? { ok: true, kind: "taskCount", detail: `proposed exactly ${e.taskCount} task(s), as expected` }
        : {
            ok: false,
            kind: "taskCount",
            detail: `expected ${e.taskCount} task(s) but got ${observedTasks.length}${observedTasks.length ? `: ${observedTasks.map((t) => `"${t.title}"`).join(", ")}` : ""}`,
          }
    );
  }

  if (e.filing) {
    findings.push(
      filing === e.filing
        ? { ok: true, kind: "filing", detail: e.filing === "new" ? "started a new file, as expected" : "filed under the existing file, as expected" }
        : {
            ok: false,
            kind: "filing",
            detail: `WRONG FILE — expected it to ${e.filing === "new" ? "start a new file" : "attach to the existing file"}, but it ${filing === "new" ? "started a new one" : filing === "existing" ? "attached to an existing one" : "filed nothing"}`,
            why: "Filing an email under the wrong property is the most damaging mistake this app can make.",
          }
    );
  }

  if (e.duplicateFlagged !== undefined) {
    findings.push(
      duplicateFlagged === e.duplicateFlagged
        ? {
            ok: true,
            kind: "duplicate",
            detail: e.duplicateFlagged
              ? "flagged as a possible duplicate of an existing file, as expected"
              : "did not flag a duplicate, as expected",
          }
        : {
            ok: false,
            kind: "duplicate",
            detail: e.duplicateFlagged
              ? "expected this to be flagged as a possible duplicate of an existing file, but it was not"
              : "flagged a possible duplicate when there should be none",
            why: e.duplicateFlagged
              ? "When two files look related but the evidence is too weak to link them, the app must raise the flag. An unflagged split file is one nobody knows to merge."
              : undefined,
          }
    );
  }

  if (e.proposesClosing !== undefined) {
    findings.push(
      proposedClosing === e.proposesClosing
        ? { ok: true, kind: "closing", detail: e.proposesClosing ? "proposed a closing, as expected" : "did not propose a closing, as expected" }
        : {
            ok: false,
            kind: "closing",
            detail: e.proposesClosing ? "expected a proposed closing, got none" : "proposed a closing when it should not have",
          }
    );
  }

  return {
    id: c.id,
    group: c.group ?? c.id,
    note: c.note,
    passed: findings.every((f) => f.ok),
    findings,
    observed: { facts: observedFacts, tasks: observedTasks, filing, duplicateFlagged, match: matchEvidence },
    elapsedMs: Date.now() - startedAt,
  };
}

// --- main --------------------------------------------------------------------
const accountId = `acct-eval-${randomUUID().slice(0, 8)}`;
seedMinimal(accountId);

const results: EvalCaseResult[] = [];
for (const c of cases) {
  results.push(await runCase(c, accountId));
}

fs.writeFileSync(
  outPath,
  JSON.stringify(
    { modelVersion: getActiveAIProvider().modelVersion, usage: getUsageStats(), results },
    null,
    2
  )
);
