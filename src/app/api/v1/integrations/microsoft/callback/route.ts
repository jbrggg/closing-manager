import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { get, run, nowIso } from "@/lib/db";
import { requireApiSession } from "@/lib/auth/guard";
import { exchangeCodeForTokens, storeTokens } from "@/lib/email/microsoft-oauth";
import { recordAudit } from "@/lib/services/audit";

export async function GET(req: Request) {
  const auth = await requireApiSession("MANAGE_SETTINGS");
  if (auth.failed) return auth.response;

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    return NextResponse.json(
      { error: `Microsoft returned an error: ${error} — ${url.searchParams.get("error_description") ?? ""}` },
      { status: 400 }
    );
  }

  const jar = await cookies();
  const expectedState = jar.get("ms_oauth_state")?.value;
  jar.delete("ms_oauth_state");

  if (!code || !state || !expectedState || state !== expectedState) {
    return NextResponse.json(
      { error: "Invalid OAuth state — the consent flow may have expired. Start again." },
      { status: 400 }
    );
  }

  try {
    const tokens = await exchangeCodeForTokens(code);

    // Identify which mailbox was actually connected.
    const meResponse = await fetch("https://graph.microsoft.com/v1.0/me", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const me = meResponse.ok ? await meResponse.json() : {};
    const emailAddress: string =
      me.mail ?? me.userPrincipalName ?? "unknown@microsoft-account";

    let account = get<{ id: string }>(
      `SELECT id FROM EmailAccount WHERE providerType = 'MICROSOFT_365' AND lower(emailAddress) = lower(?)`,
      [emailAddress]
    );

    if (!account) {
      const id = randomUUID();
      run(
        `INSERT INTO EmailAccount (id, organizationId, providerType, emailAddress, connected, lastSyncedAt)
         VALUES (?, ?, 'MICROSOFT_365', ?, 1, ?)`,
        [id, auth.user.organizationId, emailAddress, nowIso()]
      );
      account = { id };
    }

    storeTokens(account.id, tokens, { emailAddress, providerAccountId: me.id });

    recordAudit({
      organizationId: auth.user.organizationId,
      eventType: "action_executed",
      entityType: "EmailAccount",
      entityId: account.id,
      summary: `Connected Microsoft 365 mailbox ${emailAddress}`,
      actorType: "HUMAN",
      actorId: auth.user.id,
    });

    return NextResponse.redirect(new URL("/settings?connected=microsoft", req.url));
  } catch (err) {
    return NextResponse.json(
      { error: String(err instanceof Error ? err.message : err) },
      { status: 500 }
    );
  }
}
