import { NextResponse } from "next/server";
import { all } from "@/lib/db";
import { ensureSeeded } from "@/lib/ensure-seeded";
import { requireApiSession } from "@/lib/auth/guard";

export async function GET(req: Request) {
  const auth = await requireApiSession();
  if (auth.failed) return auth.response;

  await ensureSeeded();
  const { searchParams } = new URL(req.url);
  const limit = Number(searchParams.get("limit") ?? 100);
  const events = all<any>(`SELECT * FROM AuditEvent ORDER BY createdAt DESC LIMIT ?`, [limit]);
  return NextResponse.json({ auditEvents: events });
}
