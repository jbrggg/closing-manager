import { randomBytes, createHash, randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { all, get, run, nowIso } from "@/lib/db";

export const SESSION_COOKIE = "kt_session";
const SESSION_TTL_HOURS = 12; // a work shift; re-auth next day

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "CLOSER" | "PROCESSOR" | "ATTORNEY" | "STAFF";
  organizationId: string;
}

/** The cookie carries the raw token; only this hash is ever stored. */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: string, userAgent?: string): Promise<void> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000);

  run(
    `INSERT INTO Session (id, userId, tokenHash, expiresAt, createdAt, userAgent) VALUES (?, ?, ?, ?, ?, ?)`,
    [randomUUID(), userId, hashToken(token), expiresAt.toISOString(), nowIso(), userAgent ?? null]
  );
  run(`UPDATE AppUser SET lastLoginAt = ? WHERE id = ?`, [nowIso(), userId]);

  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax", // blocks cross-site form posts while keeping normal navigation working
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

/** Returns the signed-in user, or null. Also lazily prunes expired rows. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = get<{ id: string; userId: string; expiresAt: string }>(
    `SELECT id, userId, expiresAt FROM Session WHERE tokenHash = ?`,
    [hashToken(token)]
  );
  if (!session) return null;

  if (new Date(session.expiresAt).getTime() < Date.now()) {
    run(`DELETE FROM Session WHERE id = ?`, [session.id]);
    return null;
  }

  const user = get<SessionUser & { isActive: number }>(
    `SELECT id, name, email, role, organizationId, isActive FROM AppUser WHERE id = ?`,
    [session.userId]
  );
  if (!user || !user.isActive) return null;

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    organizationId: user.organizationId,
  };
}

export async function destroyCurrentSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    run(`DELETE FROM Session WHERE tokenHash = ?`, [hashToken(token)]);
  }
  jar.delete(SESSION_COOKIE);
}

/** Revokes every session for a user — e.g. after a password change. */
export function revokeAllSessionsForUser(userId: string): void {
  run(`DELETE FROM Session WHERE userId = ?`, [userId]);
}

export function purgeExpiredSessions(): number {
  const expired = all<{ id: string }>(`SELECT id FROM Session WHERE expiresAt < ?`, [nowIso()]);
  run(`DELETE FROM Session WHERE expiresAt < ?`, [nowIso()]);
  return expired.length;
}
