import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { get, run, nowIso } from "@/lib/db";
import { requireApiSession } from "@/lib/auth/guard";
import { exchangeCodeForTokens, storeTokens } from "@/lib/email/microsoft-oauth";
import {
  diagnoseAadResponse,
  diagnoseGraphResponse,
  diagnoseMissingRefreshToken,
} from "@/lib/email/microsoft-diagnostics";
import { recordAudit } from "@/lib/services/audit";

export async function GET(req: Request) {
  const auth = await requireApiSession("MANAGE_SETTINGS");
  if (auth.failed) return auth.response;

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    // Microsoft's consent screen sends failures back here as query parameters,
    // and the AADSTS code inside error_description is the only thing that says
    // WHICH setting is wrong. Translate it rather than passing the blob on.
    const description = url.searchParams.get("error_description") ?? "";
    const diagnosis = diagnoseAadResponse(400, `${error} ${description}`);
    return NextResponse.json(
      {
        error: diagnosis.problem,
        whatToDo: diagnosis.fix,
        microsoftCode: diagnosis.code,
        microsoftSaid: description.slice(0, 500),
      },
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

    // No refresh token means offline_access was not granted. Microsoft does
    // not treat that as an error — it returns a perfectly good access token
    // and the connection dies about an hour later, long after the human has
    // walked away. Refuse it now, while they are still here to fix it.
    if (!tokens.refresh_token) {
      const diagnosis = diagnoseMissingRefreshToken(tokens.scope);
      return NextResponse.json(
        { error: diagnosis.problem, whatToDo: diagnosis.fix, microsoftCode: diagnosis.code },
        { status: 400 }
      );
    }

    // Identify which mailbox was actually connected.
    const meResponse = await fetch("https://graph.microsoft.com/v1.0/me", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (!meResponse.ok) {
      const body = await meResponse.text().catch(() => "");
      const diagnosis = diagnoseGraphResponse(meResponse.status, body);
      return NextResponse.json(
        { error: diagnosis.problem, whatToDo: diagnosis.fix, microsoftCode: diagnosis.code },
        { status: 400 }
      );
    }
    const me = await meResponse.json();
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
    // exchangeCodeForTokens throws with Microsoft's response body attached,
    // which is where the AADSTS code lives. Read it rather than showing a 500.
    const raw = String(err instanceof Error ? err.message : err);
    const diagnosis = diagnoseAadResponse(500, raw);
    return NextResponse.json(
      {
        error: diagnosis.problem,
        whatToDo: diagnosis.fix,
        microsoftCode: diagnosis.code,
        microsoftSaid: raw.slice(0, 500),
      },
      { status: diagnosis.kind === "unknown" ? 500 : 400 }
    );
  }
}
