import { get, run } from "@/lib/db";
import { approveReviewItem } from "./approval";
import { recordAudit } from "./audit";

// -----------------------------------------------------------------------------
// PHASE 2/3 AUTOMATION ENGINE.
//
// This is real, working code — not a stub — but every AutomationRule ships
// disabled (see db/schema.sql AutomationRule.enabled default 0 and
// src/lib/seed.ts, which seeds none), so it is a documented no-op at launch.
// That satisfies the spec's Phase 1 requirement ("the AI must not
// automatically perform high-impact actions during the initial launch")
// while proving the Phase 2/3 mechanism actually functions end to end.
//
// How it works:
//   1. Every proposal process-email.ts creates is passed through
//      maybeAutoApprove() right after creation.
//   2. maybeAutoApprove() looks up an AutomationRule row for that proposal's
//      action type. If none exists, or it's disabled, or the proposal's
//      confidence is below the rule's minConfidence, it's a no-op — the
//      proposal stays PENDING in the review queue exactly like every other
//      Phase 1 proposal.
//   3. If a rule is enabled and confidence clears the bar, it calls the
//      *same* approveReviewItem() a human clicking "Approve" would call —
//      there is no separate "auto" code path that skips validation, so
//      turning on automation can't accidentally bypass the checks a human
//      approval goes through.
//   4. The resulting AIProposal.status is AUTO_APPROVED (not
//      HUMAN_APPROVED), and an audit event names the rule that triggered
//      it, so the audit trail always shows whether a human or a rule made
//      the call.
//
// To actually enable Phase 2 for, say, task creation above 90% confidence:
//   UPDATE AutomationRule SET enabled = 1, minConfidence = 0.9
//   WHERE actionType = 'TASK_CREATE';
// (A Settings UI toggle for this is a natural next step — the schema and
// this evaluator are ready for it; only the toggle UI is not built.)
// -----------------------------------------------------------------------------

const ORG_ID = "org-demo";

export async function maybeAutoApprove(proposalId: string): Promise<void> {
  const proposal = get<{ id: string; proposalType: string; confidence: number; status: string }>(
    `SELECT id, proposalType, confidence, status FROM AIProposal WHERE id = ?`,
    [proposalId]
  );
  if (!proposal || proposal.status !== "PROPOSED") return;

  const rule = get<{ id: string; enabled: number; minConfidence: number }>(
    `SELECT id, enabled, minConfidence FROM AutomationRule WHERE actionType = ?`,
    [proposal.proposalType]
  );
  if (!rule || !rule.enabled) return; // Phase 1 default: no rule, or disabled — stays in review queue
  if (proposal.confidence < rule.minConfidence) return; // not confident enough to skip review

  const review = get<{ id: string }>(`SELECT id FROM ReviewItem WHERE proposalId = ?`, [proposalId]);
  if (!review) return;

  recordAudit({
    organizationId: ORG_ID,
    eventType: "action_executed",
    entityType: "AIProposal",
    entityId: proposalId,
    summary: `Auto-approved ${proposal.proposalType} (confidence ${(proposal.confidence * 100).toFixed(0)}% >= rule threshold ${(rule.minConfidence * 100).toFixed(0)}%) — Phase 2/3 automation rule, no human in the loop for this action`,
    actorType: "SYSTEM",
  });

  // Goes through the exact same path a human "Approve" click uses.
  approveReviewItem(review.id, undefined);

  // Distinguish rule-triggered approval from a human decision in the audit
  // trail / proposal status, per the AIProposal status model in the spec.
  run(`UPDATE AIProposal SET status = 'AUTO_APPROVED' WHERE id = ?`, [proposalId]);
}
