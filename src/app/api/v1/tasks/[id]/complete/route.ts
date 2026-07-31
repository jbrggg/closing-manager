import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { run, get, nowIso } from "@/lib/db";
import { recordAudit } from "@/lib/services/audit";
import { requireApiSession } from "@/lib/auth/guard";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiSession("MANAGE_TASKS");
  if (auth.failed) return auth.response;

  const { id } = await params;
  const task = get<any>(`SELECT * FROM Task WHERE id = ?`, [id]);
  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });

  let summary = "Marked complete manually by user";
  try {
    const body = await req.json();
    if (body?.summary) summary = body.summary;
  } catch {
    // no body — use default summary
  }

  run(`UPDATE Task SET status = 'COMPLETED' WHERE id = ?`, [id]);
  run(
    `INSERT INTO TaskCompletionEvidence (id, taskId, evidenceEmailId, summary, createdAt) VALUES (?, ?, NULL, ?, ?)`,
    [randomUUID(), id, summary, nowIso()]
  );
  recordAudit({
    organizationId: "org-demo",
    eventType: "human_decision",
    entityType: "Task",
    entityId: id,
    summary: `Task "${task.title}" marked complete by ${auth.user.name}`,
    actorType: "HUMAN",
    actorId: auth.user.id,
  });

  return NextResponse.json({ ok: true });
}
