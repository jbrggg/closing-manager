import { NextResponse } from "next/server";
import { all } from "@/lib/db";
import { getOfficeDefaults, saveOfficeDefaults } from "@/lib/services/office-rules";
import { ensureSeeded } from "@/lib/ensure-seeded";
import { requireApiSession } from "@/lib/auth/guard";

export async function GET() {
  const auth = await requireApiSession();
  if (auth.failed) return auth.response;

  await ensureSeeded();
  const offices = all<any>(`SELECT * FROM Office`);
  const users = all<any>(`SELECT id, name, email, role FROM AppUser`);
  const emailAccounts = all<any>(`SELECT * FROM EmailAccount`);
  const automationRules = all<any>(`SELECT * FROM AutomationRule`);

  return NextResponse.json({
    organizationName: "Keystone Title & Settlement",
    timezone: getOfficeDefaults().timezone,
    officeDefaults: getOfficeDefaults(),
    offices,
    users,
    emailAccounts,
    automationRules,
    automationPhase: "PHASE_1_APPROVAL_ONLY",
  });
}

export async function PATCH(req: Request) {
  const patchAuth = await requireApiSession("MANAGE_SETTINGS");
  if (patchAuth.failed) return patchAuth.response;

  // Written through to the OfficeSetting table, so a change survives a
  // restart (roadmap D2). Every value is validated on the way in — an out of
  // range number falls back to the shipped default rather than producing a
  // nonsensical due date.
  const body = await req.json().catch(() => ({}));
  const officeDefaults = saveOfficeDefaults(body.officeDefaults ?? {});
  return NextResponse.json({ ok: true, officeDefaults });
}
