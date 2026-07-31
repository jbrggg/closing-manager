import { NextResponse } from "next/server";
import { all } from "@/lib/db";
import { officeDefaults } from "@/lib/services/office-rules";
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
    timezone: officeDefaults.timezone,
    officeDefaults,
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

  // Prototype note: settings are held in-memory (officeDefaults) and are not
  // yet persisted across restarts. A production build would write through
  // to Organization/Office/AutomationRule tables.
  const body = await req.json().catch(() => ({}));
  Object.assign(officeDefaults, body.officeDefaults ?? {});
  return NextResponse.json({ ok: true, officeDefaults });
}
