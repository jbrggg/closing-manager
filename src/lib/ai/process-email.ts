import { randomUUID } from "node:crypto";
import { all, get, run, nowIso } from "@/lib/db";
import { getActiveEmailProvider } from "@/lib/email";
import { recordAudit } from "@/lib/services/audit";
import { getActiveAIProvider } from "./index";
import { AIProvider, ExtractedFactCandidate } from "./provider";
import { findBestTransactionMatch } from "./match";
import { inferTaskDueDate } from "@/lib/services/office-rules";
import { maybeAutoApprove } from "@/lib/services/automation";
import { EmailMessageRow, ExtractedFactRow } from "@/types/models";

const ORG_ID = "org-demo"; // single-tenant demo; organizationId is threaded everywhere for future multi-tenant use

/** How many messages to read at once. Keeps a long thread from firing dozens
 *  of simultaneous API requests and tripping the provider's rate limit. */
const MAX_PARALLEL_AI_CALLS = 5;

/**
 * Like `items.map(fn)` but runs up to `limit` of them at the same time.
 * Results stay in the same order as the input, so callers can pair them back
 * up positionally.
 */
async function mapConcurrent<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

interface TaggedFact extends ExtractedFactCandidate {
  sourceEmailId: string;
  sourceThreadId: string;
  sourceTimestamp: string;
  sourceSender: string;
}

export async function processEmailMessage(messageId: string): Promise<{ jobId: string }> {
  const jobId = randomUUID();
  const startedAt = nowIso();
  run(
    `INSERT INTO AIProcessingJob (id, emailMessageId, status, startedAt) VALUES (?, ?, 'RUNNING', ?)`,
    [jobId, messageId, startedAt]
  );

  const emailProvider = getActiveEmailProvider();
  const aiProvider = getActiveAIProvider();

  try {
    const message = get<EmailMessageRow>(`SELECT * FROM EmailMessage WHERE id = ?`, [messageId]);
    if (!message) throw new Error(`Message ${messageId} not found`);

    const threadMessages = await emailProvider.getMessagesForThread(message.threadId);
    recordAudit({
      organizationId: ORG_ID,
      eventType: "email_processed",
      entityType: "EmailMessage",
      entityId: message.id,
      summary: `Read message "${message.subject}" and ${threadMessages.length - 1} other message(s) in thread`,
      actorType: "AI",
    });

    // 1. Extract from the primary thread ----------------------------------
    // Tell a network-backed provider up front that we're going to ask it
    // about this message three times, so it can answer all three from one
    // API call instead of three. No-op for the rule-based engine. This
    // returns immediately — the request runs while the thread is read.
    await aiProvider.prefetchAnalysis?.(
      message,
      threadMessages.filter((t) => t.id !== message.id)
    );

    // Read every message in the thread at the same time rather than one
    // after another. With the rule-based engine this changes nothing; with a
    // network-backed provider a five-message thread takes about as long as
    // one message instead of five times as long. Results come back in thread
    // order because mapConcurrent preserves it, so what gets written to the
    // database is identical either way.
    const perMessageFacts = await mapConcurrent(threadMessages, MAX_PARALLEL_AI_CALLS, (m) =>
      aiProvider.extractFacts(m, threadMessages.filter((t) => t.id !== m.id))
    );

    const taggedFacts: TaggedFact[] = [];
    threadMessages.forEach((m, i) => {
      taggedFacts.push(
        ...perMessageFacts[i].map((c) => ({
          ...c,
          sourceEmailId: m.id,
          sourceThreadId: m.threadId,
          sourceTimestamp: m.sentAt,
          sourceSender: m.fromAddress,
        }))
      );
    });

    // 2. Mailbox-wide search if closing info is incomplete ------------------
    const hasType = (t: string) => taggedFacts.some((f) => f.factType === t);
    const isIncomplete = !(hasType("PROPERTY_ADDRESS") && hasType("CLOSING_DATE") && hasType("CLOSING_TIME"));

    if (isIncomplete) {
      const names = taggedFacts
        .filter((f) => f.factType === "BUYER_NAME" || f.factType === "SELLER_NAME")
        .map((f) => String(f.value));
      const thread = await emailProvider.getThread(message.threadId);
      const participants: string[] = JSON.parse(thread?.participants ?? "[]");
      const fileNumbers = taggedFacts.filter((f) => f.factType === "FILE_NUMBER").map((f) => String(f.value));

      const searchResultsScored = await emailProvider.searchMailboxScored({
        participants,
        personNames: names,
        fileNumber: fileNumbers[0],
      });
      const searchResults = searchResultsScored
        .filter((s) => s.msg.threadId !== message.threadId)
        .filter((s) => s.score >= 3) // exclude weak, name-only coincidences from evidence
        .slice(0, 8)
        .map((s) => s.msg);

      recordAudit({
        organizationId: ORG_ID,
        eventType: "search_performed",
        entityType: "EmailMessage",
        entityId: message.id,
        summary: `Closing info incomplete — searched mailbox using ${names.length} name(s) and ${participants.length} participant(s); found ${searchResults.length} related message(s)`,
        detail: { names, participants },
        actorType: "AI",
      });

      const perResultFacts = await mapConcurrent(searchResults, MAX_PARALLEL_AI_CALLS, (m) =>
        aiProvider.extractFacts(m, [])
      );
      searchResults.forEach((m, i) => {
        taggedFacts.push(
          ...perResultFacts[i].map((c) => ({
            ...c,
            sourceEmailId: m.id,
            sourceThreadId: m.threadId,
            sourceTimestamp: m.sentAt,
            sourceSender: m.fromAddress,
          }))
        );
      });
    }

    // 3. Transaction matching -------------------------------------------------
    const matchResult = findBestTransactionMatch(ORG_ID, taggedFacts);
    let transactionId: string;
    let ambiguousDuplicateCandidateId: string | null = null;

    if (matchResult.isStrongMatch && matchResult.transaction) {
      transactionId = matchResult.transaction.id;
      recordAudit({
        organizationId: ORG_ID,
        eventType: "transaction_matched",
        entityType: "TransactionRecord",
        entityId: transactionId,
        summary: `Matched existing transaction (score ${matchResult.score}): ${matchResult.reasons.join("; ")}`,
        actorType: "AI",
      });
    } else {
      if (matchResult.score >= 15 && matchResult.transaction) {
        // Ambiguous — do not merge automatically; create a new transaction
        // but retain the candidate so a human can review/merge.
        ambiguousDuplicateCandidateId = matchResult.transaction.id;
      }
      transactionId = randomUUID();
      run(
        `INSERT INTO TransactionRecord (id, organizationId, officeId, propertyId, fileNumber, loanNumber, transactionType, status, createdAt, updatedAt)
         VALUES (?, ?, NULL, NULL, NULL, NULL, NULL, 'POTENTIAL', ?, ?)`,
        [transactionId, ORG_ID, nowIso(), nowIso()]
      );
      recordAudit({
        organizationId: ORG_ID,
        eventType: "transaction_matched",
        entityType: "TransactionRecord",
        entityId: transactionId,
        summary: ambiguousDuplicateCandidateId
          ? `No strong match found (best score ${matchResult.score}) — created new potential transaction; flagged possible duplicate for review`
          : "No existing transaction matched — created new potential transaction",
        actorType: "AI",
      });
    }

    // 4. Persist extracted facts, handling supersession ----------------------
    const relevantFacts = taggedFacts.filter((f) =>
      ["PROPERTY_ADDRESS", "CLOSING_DATE", "CLOSING_TIME", "CLOSING_LOCATION", "BUYER_NAME", "SELLER_NAME", "FILE_NUMBER", "LOAN_NUMBER", "MILESTONE"].includes(
        f.factType
      )
    );

    for (const fact of relevantFacts) {
      persistFactWithSupersession(transactionId, fact, aiProvider.modelVersion);
    }

    recordAudit({
      organizationId: ORG_ID,
      eventType: "facts_extracted",
      entityType: "TransactionRecord",
      entityId: transactionId,
      summary: `Extracted ${relevantFacts.length} candidate fact(s) from ${new Set(taggedFacts.map((f) => f.sourceEmailId)).size} message(s)`,
      actorType: "AI",
    });

    // 5. Build proposals -------------------------------------------------------
    const currentFacts = all<ExtractedFactRow>(
      `SELECT * FROM ExtractedFact WHERE transactionId = ? AND status = 'CURRENT'`,
      [transactionId]
    );

    const newProposalIds: string[] = [];
    newProposalIds.push(...(maybeProposeClosing(transactionId, currentFacts, ambiguousDuplicateCandidateId, message) ?? []));
    newProposalIds.push(...(await proposeTasksFromRequests(transactionId, message, aiProvider)));
    newProposalIds.push(...(await proposeCompletionsFromMessage(transactionId, message, aiProvider)));

    // 6. Phase 2/3: optional confidence-threshold auto-approval ---------------
    // No-op unless an AutomationRule is enabled for the relevant action type
    // (Phase 1 launch keeps every rule disabled — see src/lib/services/automation.ts).
    for (const proposalId of newProposalIds) {
      await maybeAutoApprove(proposalId);
    }

    run(`UPDATE AIProcessingJob SET status = 'DONE', finishedAt = ? WHERE id = ?`, [nowIso(), jobId]);
    return { jobId };
  } catch (err) {
    run(`UPDATE AIProcessingJob SET status = 'FAILED', finishedAt = ?, errorText = ? WHERE id = ?`, [
      nowIso(),
      String(err instanceof Error ? err.message : err),
      jobId,
    ]);
    recordAudit({
      organizationId: ORG_ID,
      eventType: "integration_failure",
      summary: `AI processing failed for message ${messageId}: ${String(err)}`,
      actorType: "SYSTEM",
    });
    throw err;
  }
}

function persistFactWithSupersession(transactionId: string, fact: TaggedFact, modelVersion: string) {
  const singleValueTypes = ["CLOSING_DATE", "CLOSING_TIME", "CLOSING_LOCATION", "PROPERTY_ADDRESS"];
  let supersedesId: string | null = null;

  if (singleValueTypes.includes(fact.factType)) {
    const existing = get<ExtractedFactRow>(
      `SELECT * FROM ExtractedFact WHERE transactionId = ? AND factType = ? AND status = 'CURRENT' ORDER BY sourceTimestamp DESC LIMIT 1`,
      [transactionId, fact.factType]
    );
    if (existing) {
      const existingVal = JSON.stringify(JSON.parse(existing.structuredValue));
      const newVal = JSON.stringify(fact.value);
      if (existingVal !== newVal && new Date(fact.sourceTimestamp) >= new Date(existing.sourceTimestamp)) {
        run(`UPDATE ExtractedFact SET status = 'SUPERSEDED' WHERE id = ?`, [existing.id]);
        supersedesId = existing.id;
      } else if (existingVal === newVal) {
        return; // identical fact already current — skip duplicate insert
      } else {
        return; // incoming fact is older than current — ignore
      }
    }
  } else {
    // multi-value fact types (names, file/loan numbers): skip exact duplicates
    const dup = all<ExtractedFactRow>(
      `SELECT * FROM ExtractedFact WHERE transactionId = ? AND factType = ? AND status = 'CURRENT'`,
      [transactionId, fact.factType]
    ).some((f) => JSON.stringify(JSON.parse(f.structuredValue)) === JSON.stringify(fact.value));
    if (dup) return;
  }

  run(
    `INSERT INTO ExtractedFact (id, transactionId, factType, structuredValue, sourceEmailId, sourceThreadId, sourceTimestamp, sourceSender, evidenceSummary, confidence, status, supersedesId, extractedAt, modelVersion)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'CURRENT', ?, ?, ?)`,
    [
      randomUUID(),
      transactionId,
      fact.factType,
      JSON.stringify(fact.value),
      fact.sourceEmailId,
      fact.sourceThreadId,
      fact.sourceTimestamp,
      fact.sourceSender,
      fact.evidenceSummary,
      fact.confidence,
      supersedesId,
      nowIso(),
      modelVersion,
    ]
  );
}

function makeIdempotencyKey(parts: (string | undefined)[]): string {
  return parts.filter(Boolean).join("::");
}

function createProposalAndReview(params: {
  transactionId: string;
  proposalType: string;
  payload: unknown;
  confidence: number;
  fieldConfidence: Record<string, number>;
  idempotencyKey: string;
  sourceEmailIds: string[];
  reviewType: string;
  reason: string;
  duplicateCandidates?: string[];
}): string | null {
  const existing = get(`SELECT id FROM AIProposal WHERE idempotencyKey = ?`, [params.idempotencyKey]);
  if (existing) return null; // duplicate protection — reprocessing is a no-op

  const proposalId = randomUUID();
  run(
    `INSERT INTO AIProposal (id, transactionId, proposalType, payload, confidence, fieldConfidence, status, idempotencyKey, sourceEmailIds, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, 'PROPOSED', ?, ?, ?)`,
    [
      proposalId,
      params.transactionId,
      params.proposalType,
      JSON.stringify(params.payload),
      params.confidence,
      JSON.stringify(params.fieldConfidence),
      params.idempotencyKey,
      JSON.stringify(params.sourceEmailIds),
      nowIso(),
    ]
  );

  run(
    `INSERT INTO ReviewItem (id, transactionId, proposalId, reviewType, reason, conflictingEvidence, duplicateCandidates, status, createdAt)
     VALUES (?, ?, ?, ?, ?, NULL, ?, 'PENDING', ?)`,
    [
      randomUUID(),
      params.transactionId,
      proposalId,
      params.reviewType,
      params.reason,
      params.duplicateCandidates ? JSON.stringify(params.duplicateCandidates) : null,
      nowIso(),
    ]
  );

  recordAudit({
    organizationId: ORG_ID,
    eventType: "proposal_generated",
    entityType: "AIProposal",
    entityId: proposalId,
    summary: `Proposed ${params.proposalType} (confidence ${(params.confidence * 100).toFixed(0)}%): ${params.reason}`,
    actorType: "AI",
  });

  return proposalId;
}

function maybeProposeClosing(
  transactionId: string,
  currentFacts: ExtractedFactRow[],
  ambiguousDuplicateCandidateId: string | null,
  message: EmailMessageRow
): string[] {
  const byType = (t: string) => currentFacts.filter((f) => f.factType === t);
  const dateFact = byType("CLOSING_DATE").sort((a, b) => b.confidence - a.confidence)[0];
  const timeFact = byType("CLOSING_TIME").sort((a, b) => b.confidence - a.confidence)[0];
  const locationFact = byType("CLOSING_LOCATION")[0];
  const addressFact = byType("PROPERTY_ADDRESS")[0];

  const hasSchedulingSignal = Boolean(dateFact || timeFact);
  const hasPlaceSignal = Boolean(locationFact || addressFact);
  if (!hasSchedulingSignal || !hasPlaceSignal) return []; // not enough to propose a closing yet

  const fieldConfidence: Record<string, number> = {
    date: dateFact?.confidence ?? 0,
    time: timeFact?.confidence ?? 0,
    location: locationFact?.confidence ?? 0,
    propertyAddress: addressFact?.confidence ?? 0,
  };
  const overall =
    Object.values(fieldConfidence).filter((v) => v > 0).reduce((a, b) => a + b, 0) /
    Math.max(1, Object.values(fieldConfidence).filter((v) => v > 0).length);

  const existingClosing = get<{ id: string; status: string }>(
    `SELECT id, status FROM ClosingEvent WHERE transactionId = ? ORDER BY createdAt DESC LIMIT 1`,
    [transactionId]
  );
  const proposalType = existingClosing ? "CLOSING_RESCHEDULE" : "CLOSING_CREATE";

  const payload = {
    date: dateFact ? JSON.parse(dateFact.structuredValue) : null,
    time: timeFact ? JSON.parse(timeFact.structuredValue) : null,
    location: locationFact ? JSON.parse(locationFact.structuredValue) : null,
    propertyAddress: addressFact ? JSON.parse(addressFact.structuredValue) : null,
    locationTBD: !locationFact,
  };

  const sourceIds = Array.from(
    new Set(
      [dateFact, timeFact, locationFact, addressFact]
        .filter((f): f is ExtractedFactRow => Boolean(f))
        .map((f) => f.sourceEmailId)
    )
  );

  const reviewType = proposalType === "CLOSING_RESCHEDULE" ? "material_reschedule" : "closing_proposal";
  const reason = ambiguousDuplicateCandidateId
    ? "Closing details reconstructed from multiple emails; possible duplicate transaction requires review before confirming"
    : `Closing details reconstructed from ${sourceIds.length} source message(s); date/time/location require confirmation`;

  // If a pending (not yet decided) closing proposal of the same type already
  // exists for this transaction, update it in place as new facts arrive
  // instead of spawning a duplicate review item for every incoming email.
  const pending = get<{ proposalId: string; reviewId: string }>(
    `SELECT p.id as proposalId, ri.id as reviewId FROM AIProposal p
     JOIN ReviewItem ri ON ri.proposalId = p.id
     WHERE p.transactionId = ? AND p.proposalType = ? AND p.status = 'PROPOSED' AND ri.status = 'PENDING'
     ORDER BY p.createdAt DESC LIMIT 1`,
    [transactionId, proposalType]
  );

  if (pending) {
    run(
      `UPDATE AIProposal SET payload = ?, confidence = ?, fieldConfidence = ?, sourceEmailIds = ? WHERE id = ?`,
      [JSON.stringify(payload), overall || 0.5, JSON.stringify(fieldConfidence), JSON.stringify(sourceIds), pending.proposalId]
    );
    run(`UPDATE ReviewItem SET reason = ?, duplicateCandidates = ? WHERE id = ?`, [
      reason,
      ambiguousDuplicateCandidateId ? JSON.stringify([ambiguousDuplicateCandidateId]) : null,
      pending.reviewId,
    ]);
    recordAudit({
      organizationId: ORG_ID,
      eventType: "proposal_generated",
      entityType: "AIProposal",
      entityId: pending.proposalId,
      summary: `Updated pending ${proposalType} proposal with newly reconstructed facts (confidence ${((overall || 0.5) * 100).toFixed(0)}%)`,
      actorType: "AI",
    });
    return [pending.proposalId];
  }

  const newId = createProposalAndReview({
    transactionId,
    proposalType,
    payload,
    confidence: overall || 0.5,
    fieldConfidence,
    idempotencyKey: makeIdempotencyKey([proposalType, transactionId, message.id, JSON.stringify(payload)]),
    sourceEmailIds: sourceIds,
    reviewType,
    reason,
    duplicateCandidates: ambiguousDuplicateCandidateId ? [ambiguousDuplicateCandidateId] : undefined,
  });
  return newId ? [newId] : [];
}

async function proposeTasksFromRequests(
  transactionId: string,
  message: EmailMessageRow,
  aiProvider: AIProvider
): Promise<string[]> {
  const requests = await aiProvider.detectRequests(message);
  const ids: string[] = [];
  for (const req of requests) {
    const { due, isInferred, label } = inferTaskDueDate(
      req.category,
      req.priority,
      req.deadlineHint?.kind === "explicit" && DAY_RE.test(req.deadlineHint.text)
        ? req.deadlineHint.text.replace(/^by\s+/i, "")
        : undefined
    );

    const payload = {
      title: req.taskTitle,
      category: req.category,
      priority: req.priority,
      requester: message.fromAddress,
      dueAt: due.toISOString(),
      dueIsInferred: isInferred,
      dueLabel: label,
      waitingCondition: req.waitingCondition ?? null,
      sourceEmailId: message.id,
    };

    const id = createProposalAndReview({
      transactionId,
      proposalType: "TASK_CREATE",
      payload,
      confidence: req.confidence,
      fieldConfidence: {
        taskType: req.confidence,
        dueDate: isInferred ? 0.55 : 0.9,
        priority: req.confidence,
      },
      idempotencyKey: makeIdempotencyKey(["TASK_CREATE", transactionId, message.id, req.taskTitle]),
      sourceEmailIds: [message.id],
      reviewType: req.confidence < 0.75 ? "low_confidence_task" : "task_proposal",
      reason: req.evidenceSummary,
    });
    if (id) ids.push(id);
  }
  return ids;
}

const DAY_RE = /friday|monday|tuesday|wednesday|thursday|saturday|sunday/i;

async function proposeCompletionsFromMessage(
  transactionId: string,
  message: EmailMessageRow,
  aiProvider: AIProvider
): Promise<string[]> {
  const signal = await aiProvider.detectCompletionSignal(message);
  if (!signal) return [];

  const candidateTask = get<{ id: string; title: string }>(
    `SELECT id, title FROM Task WHERE transactionId = ? AND category = ? AND status IN ('OPEN','IN_PROGRESS','WAITING_INTERNALLY','WAITING_EXTERNALLY') ORDER BY createdAt DESC LIMIT 1`,
    [transactionId, signal.taskHint]
  );
  if (!candidateTask) return [];

  const id = createProposalAndReview({
    transactionId,
    proposalType: "TASK_COMPLETE",
    payload: { taskId: candidateTask.id, evidenceEmailId: message.id, summary: signal.evidenceSummary },
    confidence: 0.8,
    fieldConfidence: { completionEvidence: 0.8 },
    idempotencyKey: makeIdempotencyKey(["TASK_COMPLETE", candidateTask.id, message.id]),
    sourceEmailIds: [message.id],
    reviewType: "completion_uncertainty",
    reason: `${signal.evidenceSummary} — matched to open task "${candidateTask.title}"`,
  });
  return id ? [id] : [];
}
