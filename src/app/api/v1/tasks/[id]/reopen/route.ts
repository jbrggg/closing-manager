import { NextResponse } from "next/server";
import { run, get } from "@/lib/db";
import { recordAudit } from "@/lib/services/audit";
import { requireApiSession } from "@/lib/auth/guard";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiSession("MANAGE_TASKS");
  if (auth.failed) return auth.response;

  const { id } = await params;
  const task = get<any>(`SELECT * FROM Task WHERE id = ?`, [id]);
  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });

  run(`UPDATE Task SET status = 'OPEN' WHERE id = ?`, [id]);
  recordAudit({
    organizationId: "org-demo",
    eventType: "action_executed",
    entityType: "Task",
    entityId: id,
    summary: `Task "${task.title}" reopened by ${auth.user.name}`,
    actorType: "HUMAN",
    actorId: auth.user.id,
  });

  return NextResponse.json({ ok: true });
}
