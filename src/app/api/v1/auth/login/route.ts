import { NextResponse } from "next/server";
import { z } from "zod";
import { get } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { recordAudit } from "@/lib/services/audit";
import { ensureSeeded } from "@/lib/ensure-seeded";

const bodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(req: Request) {
  // The demo database seeds the demo users, so a first-ever visit to /login
  // has accounts to sign in with.
  await ensureSeeded();

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
  }

  const { email, password } = parsed.data;
  const user = get<{ id: string; passwordHash: string | null; isActive: number; organizationId: string; name: string }>(
    `SELECT id, passwordHash, isActive, organizationId, name FROM AppUser WHERE lower(email) = lower(?)`,
    [email]
  );

  // Always run a verification so a nonexistent email and a wrong password
  // take a similar amount of time — otherwise response timing reveals which
  // addresses have accounts.
  const passwordOk = await verifyPassword(password, user?.passwordHash ?? null);

  if (!user || !user.isActive || !passwordOk) {
    if (user) {
      recordAudit({
        organizationId: user.organizationId,
        eventType: "auth_login_failed",
        entityType: "AppUser",
        entityId: user.id,
        summary: `Failed sign-in attempt for ${email}`,
        actorType: "SYSTEM",
      });
    }
    // Deliberately identical message for every failure mode.
    return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
  }

  await createSession(user.id, req.headers.get("user-agent") ?? undefined);

  recordAudit({
    organizationId: user.organizationId,
    eventType: "auth_login",
    entityType: "AppUser",
    entityId: user.id,
    summary: `${user.name} signed in`,
    actorType: "HUMAN",
    actorId: user.id,
  });

  return NextResponse.json({ ok: true });
}
