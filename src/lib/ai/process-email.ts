import { randomUUID } from "node:crypto";
import { all, get, run, nowIso } from "@/lib/db";
import { getActiveEmailProvider } from "@/lib/email";
import { recordAudit } from "@/lib/services/audit";
import { getActiveAIProvider } from "./index";
import { AIProvider, ExtractedFactCandidate } from "./provider";
import { findBestTransactionMatch, STRONG_MATCH_THRESHOLD, type MatchResult } from "./match";
import { inferTaskDueDate } from "@/lib/services/office-rules";
import { maybeAutoApprove } from "@/lib/services/automation";
import { EmailMessageRow, ExtractedFactRow } from "@/types/models";
import { withAttachmentText, withAttachmentTextOne } from "@/lib/documents/augment";

const ORG_ID = "org-demo"; // single-tenant demo; organizationId is threaded everywhere for future multi-tenant use

/**
 * The fact types `src/lib/ai/match.ts` actually scores on.
 *
 * Declared here rather than in match.ts because that file is covered by
 * invariant 4 and is not edited without asking. It exists so the filing
 * diagnostic can report what an email offered up to be matched on.
 * `tests/eval-diagnostics.test.ts` asserts this list still equals the set of
 * types match.ts scores, so adding a signal there and forgetting this fails a
 * test rather than silently producing a misleading diagnosis.
 */
export const MATCHED_FACT_TYPES = [
  "PROPERTY_ADDRESS",
  "FILE_NUMBER",
  "LOAN_NUMBER",
  "BUYER_NAME",
  "SELLER_NAME",
  "CLOSING_LOCATION",
] as const;

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

/**
 * May this email be filed on an existing file on the strength of the property
 * address alone?
 *
 * Address agreement is 45 of the 60 needed for a strong match, so this is
 * deliberately not one — it always produces a warning a human has to answer.
 * The guards are what make it safe enough to do at all:
 *
 * - the address must be the ONLY thing that agreed. If anything else matched
 *   too, the ordinary scoring already had its say.
 * - exactly one existing file may agree on the address. Two is the
 *   sale-then-refinance case: the same property, genuinely different deals,
 *   and picking one automatically is the false-merge bug invariant 4 was
 *   written after.
 * - the candidate must still be a live file. Filing new mail onto something
 *   already merged away just moves the problem.
 */
function isProvisionalAddressMatch(m: MatchResult): boolean {
  return (
    m.addressOnly &&
    m.addressCandidateCount === 1 &&
    m.transaction !== null &&
    m.transaction.status !== "MERGED"
  );
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
    const storedMessage = get<EmailMessageRow>(`SELECT * FROM EmailMessage WHERE id = ?`, [messageId]);
    if (!storedMessage) throw new Error(`Message ${messageId} not found`);

    // Attach the text of any documents that came with these messages, so the
    // AI can read a closing date that exists only inside the settlement
    // statement. 16 of 21 real test emails reference an attachment; without
    // this the AI is marked wrong for not knowing what it was never shown.
    const message = withAttachmentTextOne(storedMessage);
    const threadMessages = withAttachmentText(
      await emailProvider.getMessagesForThread(storedMessage.threadId)
    );
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

      const perResultFacts = await mapConcurrent(
        withAttachmentText(searchResults),
        MAX_PARALLEL_AI_CALLS,
        (m) => aiProvider.extractFacts(m, [])
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
    /** Set when this email was filed on an existing file on the address alone. */
    let provisionalMatchOnto: string | null = null;

    // Structured evidence for *why* this email landed where it did. The summary
    // line below already says the score in prose; this records the same decision
    // in a machine-readable form so `npm run diagnose` can explain a wrong-file
    // result without anyone having to re-read the code. Recording it changes no
    // behaviour — nothing reads this back during processing — and deliberately
    // does not touch `match.ts` (invariant 4).
    const matchDetail = {
      score: matchResult.score,
      isStrongMatch: matchResult.isStrongMatch,
      reasons: matchResult.reasons,
      bestCandidateTransactionId: matchResult.transaction?.id ?? null,
      transactionsConsidered:
        get<{ n: number }>(`SELECT COUNT(*) as n FROM TransactionRecord WHERE organizationId = ?`, [ORG_ID])?.n ?? 0,
      // The identifying facts this email offered up for matching. A score of 0
      // means one of two very different things — nothing to compare against, or
      // nothing extracted to compare with — and only this tells them apart.
      // Deduped by type+value the same way match.ts dedupes before scoring, so
      // the diagnostic shows one address rather than the same one three times
      // over because the thread and the mailbox search both turned it up.
      identifiersExtracted: Object.values(
        Object.fromEntries(
          taggedFacts
            .filter((f) => (MATCHED_FACT_TYPES as readonly string[]).includes(f.factType))
            .map((f) => [`${f.factType}::${String(f.value)}`, { type: f.factType, value: String(f.value) }])
        )
      ),
    };

    if (matchResult.isStrongMatch && matchResult.transaction) {
      transactionId = matchResult.transaction.id;
      recordAudit({
        organizationId: ORG_ID,
        eventType: "transaction_matched",
        entityType: "TransactionRecord",
        entityId: transactionId,
        summary: `Matched existing transaction (score ${matchResult.score}): ${matchResult.reasons.join("; ")}`,
        detail: matchDetail,
        actorType: "AI",
      });
    } else if (isProvisionalAddressMatch(matchResult)) {
      // Address agrees and nothing else does. Office rule, decided 2026-07-31:
      // put the email on the file rather than start a second one, and warn that
      // the file number is missing.
      //
      // This is NOT a strong match and is not treated as one. The threshold and
      // weights in match.ts are untouched (invariant 4); this is a separate,
      // weaker tier that always ends in a human decision. It is guarded to a
      // single candidate file that is still live — two files sharing an address
      // is the sale-then-refinance case and stays ambiguous.
      transactionId = matchResult.transaction!.id;
      provisionalMatchOnto = transactionId;
      recordAudit({
        organizationId: ORG_ID,
        eventType: "transaction_matched",
        entityType: "TransactionRecord",
        entityId: transactionId,
        summary:
          `Matched on the property address alone (score ${matchResult.score} of ${STRONG_MATCH_THRESHOLD}) — ` +
          `filed here provisionally and raised a missing-file-number warning`,
        detail: matchDetail,
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
        detail: matchDetail,
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
      // What the AI read out of THIS message specifically, before dedup and
      // supersession decide what is worth storing.
      //
      // These two are not the same thing, and the difference used to look like
      // an AI failure. `persistFactWithSupersession` deliberately does not
      // re-insert a fact the transaction already holds, so a file number
      // correctly read from the second email of a thread is never written with
      // that email's sourceEmailId — and the scorecard, which reads facts back
      // by sourceEmailId, called it missed. Three of the seven failing cases on
      // 2026-07-31 were this and not the model.
      detail: {
        messageId: message.id,
        extractedFromThisMessage: relevantFacts
          .filter((f) => f.sourceEmailId === message.id)
          .map((f) => ({ type: f.factType, value: f.value, confidence: f.confidence })),
      },
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

    // 5b. Warn about an address-only link ------------------------------------
    // Raised last, so it records everything the email wrote onto the file it
    // joined. Deliberately NOT added to newProposalIds: an address-only link is
    // the one thing that must never be auto-approved, whatever confidence any
    // future automation rule is set to.
    if (provisionalMatchOnto) {
      recordProvisionalMatch(provisionalMatchOnto, message, matchResult);
    }

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

/**
 * Write down an address-only link and raise the warning it requires.
 *
 * Records the exact rows this email put on the file, so the link can be undone
 * by moving them back out — the same "write down what you did" approach that
 * makes a merge reversible (invariant 9). Without this list, undoing would mean
 * guessing which facts came from where.
 */
function recordProvisionalMatch(transactionId: string, message: EmailMessageRow, matchResult: MatchResult) {
  const factIds = all<{ id: string }>(
    `SELECT id FROM ExtractedFact WHERE sourceEmailId = ? AND transactionId = ?`,
    [message.id, transactionId]
  ).map((r) => r.id);
  const proposalIds = all<{ id: string }>(
    `SELECT id FROM AIProposal WHERE transactionId = ? AND sourceEmailIds LIKE ?`,
    [transactionId, `%${message.id}%`]
  ).map((r) => r.id);

  const address = matchResult.reasons[0] ?? "the property address";
  const reason =
    `This email was filed here because the property address matches, and nothing else did — ` +
    `no file number, no loan number. Confirm it belongs on this file, and add the file number ` +
    `so the next email links on its own. If it is a different deal on the same property, reject ` +
    `this and it will be moved to a file of its own.`;

  const proposalId = randomUUID();
  run(
    `INSERT INTO AIProposal (id, transactionId, proposalType, payload, confidence, fieldConfidence, status, idempotencyKey, sourceEmailIds, createdAt)
     VALUES (?, ?, 'TRANSACTION_LINK', ?, ?, ?, 'PROPOSED', ?, ?, ?)`,
    [
      proposalId,
      transactionId,
      JSON.stringify({
        linkedOnAddressAlone: true,
        evidence: address,
        score: matchResult.score,
        threshold: STRONG_MATCH_THRESHOLD,
        missing: ["FILE_NUMBER"],
        sourceEmailId: message.id,
      }),
      // Confidence is the score as a fraction of what a strong match needs.
      // Stating it honestly matters: this is the weakest link the app makes.
      matchResult.score / STRONG_MATCH_THRESHOLD,
      JSON.stringify({ propertyAddress: 1, fileNumber: 0 }),
      makeIdempotencyKey(["TRANSACTION_LINK", transactionId, message.id]),
      JSON.stringify([message.id]),
      nowIso(),
    ]
  );

  run(
    `INSERT INTO ReviewItem (id, transactionId, proposalId, reviewType, reason, conflictingEvidence, duplicateCandidates, status, createdAt)
     VALUES (?, ?, ?, 'address_only_link', ?, NULL, NULL, 'PENDING', ?)`,
    [randomUUID(), transactionId, proposalId, reason, nowIso()]
  );

  run(
    `INSERT INTO ProvisionalMatch (id, transactionId, sourceEmailId, reason, movedFactIds, movedProposalIds, status, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?)`,
    [
      randomUUID(),
      transactionId,
      message.id,
      reason,
      JSON.stringify(factIds),
      JSON.stringify([...proposalIds, proposalId]),
      nowIso(),
    ]
  );

  recordAudit({
    organizationId: ORG_ID,
    eventType: "proposal_generated",
    entityType: "AIProposal",
    entityId: proposalId,
    summary:
      `Filed on the property address alone and raised a missing-file-number warning ` +
      `(${factIds.length} fact(s) written onto this file, reversible)`,
    actorType: "AI",
  });
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
