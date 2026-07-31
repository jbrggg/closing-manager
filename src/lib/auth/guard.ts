import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { getSessionUser, SessionUser } from "./session";

export type Role = SessionUser["role"];

/**
 * Which roles may take which actions. Kept as data rather than scattered
 * `if (role === ...)` checks so the policy is auditable in one place.
 *
 * Note this is intentionally coarse for the prototype. A production build
 * would likely add per-office scoping (a closer in Cherry Hill shouldn't
 * necessarily approve Doylestown items) — the Office table and
 * Transaction.officeId already exist to support that.
 */
const PERMISSIONS = {
  /** Approve or reject an AI proposal — the core trust boundary. */
  DECIDE_REVIEW_ITEM: ["ADMIN", "CLOSER", "PROCESSOR", "ATTORNEY"] as Role[],
  /** Turn Phase 2/3 automation on or off. Deliberately admin-only. */
  MANAGE_AUTOMATION: ["ADMIN"] as Role[],
  /** Edit org/office/user settings. */
  MANAGE_SETTINGS: ["ADMIN"] as Role[],
  /** Complete or reopen tasks. */
  MANAGE_TASKS: ["ADMIN", "CLOSER", "PROCESSOR", "ATTORNEY", "STAFF"] as Role[],
  /** Reset/seed demo data. */
  MANAGE_DEMO_DATA: ["ADMIN"] as Role[],
} as const;

export type Permission = keyof typeof PERMISSIONS;

export function roleHasPermission(role: Role, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}

/** For server components/pages: redirects to /login when signed out. */
export async function requirePageSession(returnTo?: string): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) {
    redirect(returnTo ? `/login?next=${encodeURIComponent(returnTo)}` : "/login");
  }
  return user;
}

export interface ApiAuthFailure {
  failed: true;
  response: NextResponse;
}
export interface ApiAuthSuccess {
  failed: false;
  user: SessionUser;
}

/**
 * For API routes. Returns either the user or a ready-to-return error
 * response, so handlers stay flat:
 *
 *   const auth = await requireApiSession("DECIDE_REVIEW_ITEM");
 *   if (auth.failed) return auth.response;
 *   // auth.user is available here
 */
export async function requireApiSession(
  permission?: Permission
): Promise<ApiAuthSuccess | ApiAuthFailure> {
  const user = await getSessionUser();
  if (!user) {
    return {
      failed: true,
      response: NextResponse.json({ error: "Authentication required" }, { status: 401 }),
    };
  }
  if (permission && !roleHasPermission(user.role, permission)) {
    return {
      failed: true,
      response: NextResponse.json(
        { error: `Your role (${user.role}) is not permitted to perform this action.` },
        { status: 403 }
      ),
    };
  }
  return { failed: false, user };
}
