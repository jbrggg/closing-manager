import { NextResponse } from "next/server";
import { getSessionUser, destroyCurrentSession } from "@/lib/auth/session";
import { recordAudit } from "@/lib/services/audit";

export async function POST() {
  const user = await getSessionUser();
  if (user) {
    recordAudit({
      organizationId: user.organizationId,
      eventType: "auth_logout",
      entityType: "AppUser",
      entityId: user.id,
      summary: `${user.name} signed out`,
      actorType: "HUMAN",
      actorId: user.id,
    });
  }
  await destroyCurrentSession();
  return NextResponse.json({ ok: true });
}
