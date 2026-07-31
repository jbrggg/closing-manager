import { randomUUID } from "node:crypto";
import { get, run, nowIso } from "@/lib/db";
import { recordAudit } from "./audit";
import { AIProposalRow, ReviewItemRow } from "@/types/models";

const ORG_ID = "org-demo";

export function approveReviewItem(reviewItemId: string, decidedByUserId?: string, editedPayload?: unknown) {
  const review = get<ReviewItemRow>(`SELECT * FROM ReviewItem WHERE id = ?`, [reviewItemId]);
  if (!review) throw new Error("Review item not found");
  if (review.status !== "PENDING") throw new Error("Review item already decided");

  const proposal = get<AIProposalRow>(`SELECT * FROM AIProposal WHERE id = ?`, [review.proposalId]);
  if (!proposal) throw new Error("Proposal not found");

  const payload = editedPayload ?? JSON.parse(proposal.payload);
  const wasEdited = Boolean(editedPayload);

  applyProposal(proposal, payload);

  run(`UPDATE AIProposal SET status = 'HUMAN_APPROVED' WHERE id = ?`, [proposal.id]);
  run(
    `UPDATE ReviewItem SET status = 'APPROVED', decidedAt = ?, decidedByUserId = ? WHERE id = ?`,
    [nowIso(), decidedByUserId ?? null, reviewItemId]
  );

  recordAudit({
    organizationId: ORG_ID,
    eventType: "human_decision",
    entityType: "ReviewItem",
    entityId: reviewItemId,
    summary: `Approved ${proposal.proposalType}${wasEdited ? " (edited before approval)" : ""}`,
    actorType: "HUMAN",
    actorId: decidedByUserId,
  });
  recordAudit({
    organizationId: ORG_ID,
    eventType: "action_executed",
    entityType: "AIProposal",
    entityId: proposal.id,
    summary: `Applied ${proposal.proposalType} to live records`,
    actorType: "SYSTEM",
  });
}

export function rejectReviewItem(reviewItemId: string, decidedByUserId?: string, explanation?: string) {
  const review = get<ReviewItemRow>(`SELECT * FROM ReviewItem WHERE id = ?`, [reviewItemId]);
  if (!review) throw new Error("Review item not found");
  if (review.status !== "PENDING") throw new Error("Review item already decided");

  run(`UPDATE AIProposal SET status = 'HUMAN_REJECTED' WHERE id = ?`, [review.proposalId]);
  run(
    `UPDATE ReviewItem SET status = 'REJECTED', decidedAt = ?, decidedByUserId = ? WHERE id = ?`,
    [nowIso(), decidedByUserId ?? null, reviewItemId]
  );

  recordAudit({
    organizationId: ORG_ID,
    eventType: "human_decision",
    entityType: "ReviewItem",
    entityId: reviewItemId,
    summary: `Rejected proposal${explanation ? `: ${explanation}` : ""}`,
    actorType: "HUMAN",
    actorId: decidedByUserId,
  });
}

function applyProposal(proposal: AIProposalRow, payload: any) {
  switch (proposal.proposalType) {
    case "CLOSING_CREATE": {
      const closingId = randomUUID();
      const status = payload.date && payload.time ? "TENTATIVE" : "PROPOSED";
      run(
        `INSERT INTO ClosingEvent (id, transactionId, status, date, time, timezone, location, locationTBD, createdAt)
         VALUES (?, ?, ?, ?, ?, 'America/New_York', ?, ?, ?)`,
        [
          closingId,
          proposal.transactionId,
          status,
          payload.date ? JSON.stringify(payload.date) : null,
          payload.time ?? null,
          payload.location ?? null,
          payload.locationTBD ? 1 : 0,
          nowIso(),
        ]
      );
      run(`UPDATE TransactionRecord SET status = ?, updatedAt = ? WHERE id = ?`, [
        status === "TENTATIVE" ? "TENTATIVE" : "SCHEDULING",
        nowIso(),
        proposal.transactionId,
      ]);
      break;
    }
    case "CLOSING_RESCHEDULE": {
      const existing = get<{ id: string }>(
        `SELECT id FROM ClosingEvent WHERE transactionId = ? ORDER BY createdAt DESC LIMIT 1`,
        [proposal.transactionId]
      );
      if (existing) {
        run(
          `UPDATE ClosingEvent SET status = 'RESCHEDULED', date = ?, time = ?, location = ?, locationTBD = ? WHERE id = ?`,
          [
            payload.date ? JSON.stringify(payload.date) : null,
            payload.time ?? null,
            payload.location ?? null,
            payload.locationTBD ? 1 : 0,
            existing.id,
          ]
        );
        run(
          `INSERT INTO ClosingEventRevision (id, closingEventId, changedFields, reason, createdAt)
           VALUES (?, ?, ?, ?, ?)`,
          [randomUUID(), existing.id, JSON.stringify(payload), "Human-approved reschedule proposal", nowIso()]
        );
      }
      run(`UPDATE TransactionRecord SET status = 'RESCHEDULED', updatedAt = ? WHERE id = ?`, [
        nowIso(),
        proposal.transactionId,
      ]);
      break;
    }
    case "TASK_CREATE": {
      run(
        `INSERT INTO Task (id, transactionId, title, category, priority, status, assignedUserId, requester, dueAt, dueIsInferred, waitingCondition, sourceEmailId, confidence, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`,
        [
          randomUUID(),
          proposal.transactionId,
          payload.title,
          payload.category,
          payload.priority,
          payload.waitingCondition ? "WAITING_EXTERNALLY" : "OPEN",
          payload.requester,
          payload.dueAt,
          payload.dueIsInferred ? 1 : 0,
          payload.waitingCondition,
          payload.sourceEmailId,
          proposal.confidence,
          nowIso(),
        ]
      );
      break;
    }
    case "TASK_COMPLETE": {
      run(`UPDATE Task SET status = 'COMPLETED' WHERE id = ?`, [payload.taskId]);
      run(
        `INSERT INTO TaskCompletionEvidence (id, taskId, evidenceEmailId, summary, createdAt)
         VALUES (?, ?, ?, ?, ?)`,
        [randomUUID(), payload.taskId, payload.evidenceEmailId, payload.summary, nowIso()]
      );
      break;
    }
    default:
      throw new Error(`Unknown proposal type: ${proposal.proposalType}`);
  }
}
