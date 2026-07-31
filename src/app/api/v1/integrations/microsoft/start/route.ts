import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { requireApiSession } from "@/lib/auth/guard";
import { buildAuthorizeUrl, isMicrosoftConfigured } from "@/lib/email/microsoft-oauth";
import { isEncryptionConfigured } from "@/lib/auth/crypto";

// Kicks off the Microsoft OAuth consent flow. Admin-only: connecting a
// mailbox grants this application ongoing read access to agency email.
export async function GET() {
  const auth = await requireApiSession("MANAGE_SETTINGS");
  if (auth.failed) return auth.response;

  if (!isMicrosoftConfigured()) {
    return NextResponse.json(
      {
        error:
          "Microsoft integration is not configured. Set MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET, and MICROSOFT_TENANT_ID in .env.local. See README → Connecting Outlook.",
      },
      { status: 400 }
    );
  }
  if (!isEncryptionConfigured()) {
    return NextResponse.json(
      {
        error:
          "APP_ENCRYPTION_KEY is not set — refusing to start OAuth because there would be nowhere safe to store the tokens. Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"",
      },
      { status: 400 }
    );
  }

  // CSRF protection for the OAuth round trip: the state we send must come
  // back unchanged, and only this browser holds the matching cookie.
  const state = randomBytes(24).toString("hex");
  const jar = await cookies();
  jar.set("ms_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  });

  return NextResponse.redirect(buildAuthorizeUrl(state));
}
