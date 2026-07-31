import { NextResponse } from "next/server";
import { z } from "zod";
import { all, run } from "@/lib/db";
import { recordAudit } from "@/lib/services/audit";
import { requireApiSession } from "@/lib/auth/guard";

// Read and toggle Phase 2/3 automation rules.
//
// GET  -> list all rules and their current state
// PATCH { actionType, enabled?, minConfidence? } -> update one rule
//
// Phase 1 ships every rule disabled. Enabling one here makes
// src/lib/services/automation.ts auto-approve future proposals of that type
// above the confidence threshold, without a human in the loop — so this
// endpoint is deliberately explicit about what it's turning on, and every
// change is written to the audit trail.
export async function GET() {
  const auth = await requireApiSession();
  if (auth.failed) return auth.response;

  const rules = all<any>(`SELECT * FROM AutomationRule ORDER BY actionType`);
  return NextResponse.json({
    automationPhase: rules.some((r) => r.enabled)
      ? "PHASE_2_SELECTIVE_AUTOMATION"
      : "PHASE_1_APPROVAL_ONLY",
    rules,
  });
}

const patchSchema = z.object({
  actionType: z.string(),
  enabled: z.boolean().optional(),
  minConfidence: z.number().min(0).max(1).optional(),
});

export async function PATCH(req: Request) {
  const patchAuth = await requireApiSession("MANAGE_AUTOMATION");
  if (patchAuth.failed) return patchAuth.response;

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", details: parsed.error.flatten() }, { status: 400 });
  }

  const { actionType, enabled, minConfidence } = parsed.data;
  const existing = all<any>(`SELECT * FROM AutomationRule WHERE actionType = ?`, [actionType])[0];
  if (!existing) {
    return NextResponse.json({ error: `No automation rule for action type "${actionType}"` }, { status: 404 });
  }

  if (enabled !== undefined) {
    run(`UPDATE AutomationRule SET enabled = ? WHERE actionType = ?`, [enabled ? 1 : 0, actionType]);
  }
  if (minConfidence !== undefined) {
    run(`UPDATE AutomationRule SET minConfidence = ? WHERE actionType = ?`, [minConfidence, actionType]);
  }

  const updated = all<any>(`SELECT * FROM AutomationRule WHERE actionType = ?`, [actionType])[0];

  recordAudit({
    organizationId: "org-demo",
    eventType: "action_executed",
    entityType: "AutomationRule",
    entityId: updated.id,
    summary: `Automation rule for ${actionType} set to enabled=${updated.enabled}, minConfidence=${updated.minConfidence}`,
    actorType: "HUMAN",
  });

  return NextResponse.json({ ok: true, rule: updated });
}
