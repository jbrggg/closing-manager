import { get, run, nowIso } from "@/lib/db";
import { encryptSecret, decryptSecret } from "@/lib/auth/crypto";

// -----------------------------------------------------------------------------
// Microsoft identity platform OAuth 2.0 (authorization code flow).
//
// Implemented with plain fetch rather than MSAL to keep the dependency
// surface small — the flow is three HTTP calls and the token response is
// well documented.
//
// Entra (Azure AD) app registration checklist:
//   1. Azure Portal → Microsoft Entra ID → App registrations → New
//   2. Redirect URI (Web):  {APP_BASE_URL}/api/v1/integrations/microsoft/callback
//   3. API permissions → Microsoft Graph → Delegated:
//        Mail.Read          (read the mailbox)
//        offline_access     (receive a refresh token — without this the
//                            connection dies after ~1 hour)
//        User.Read          (identify which mailbox was connected)
//   4. Certificates & secrets → New client secret → copy the VALUE
//   5. Put client ID / secret / tenant ID in .env.local
// -----------------------------------------------------------------------------

export const MICROSOFT_SCOPES = [
  "offline_access",
  "https://graph.microsoft.com/Mail.Read",
  "https://graph.microsoft.com/User.Read",
];

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
}

function tenant(): string {
  return process.env.MICROSOFT_TENANT_ID ?? "common";
}

function authority(): string {
  return `https://login.microsoftonline.com/${tenant()}/oauth2/v2.0`;
}

export function microsoftConfig() {
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
  const redirectUri =
    process.env.MICROSOFT_REDIRECT_URI ??
    `${process.env.APP_BASE_URL ?? "http://localhost:3000"}/api/v1/integrations/microsoft/callback`;
  return { clientId, clientSecret, redirectUri };
}

export function isMicrosoftConfigured(): boolean {
  const { clientId, clientSecret } = microsoftConfig();
  return Boolean(clientId && clientSecret);
}

export function buildAuthorizeUrl(state: string): string {
  const { clientId, redirectUri } = microsoftConfig();
  const params = new URLSearchParams({
    client_id: clientId ?? "",
    response_type: "code",
    redirect_uri: redirectUri,
    response_mode: "query",
    scope: MICROSOFT_SCOPES.join(" "),
    state,
  });
  return `${authority()}/authorize?${params.toString()}`;
}

async function requestToken(body: Record<string, string>): Promise<TokenResponse> {
  const response = await fetch(`${authority()}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Microsoft token request failed (${response.status}): ${text.slice(0, 400)}`);
  }
  return (await response.json()) as TokenResponse;
}

export async function exchangeCodeForTokens(code: string): Promise<TokenResponse> {
  const { clientId, clientSecret, redirectUri } = microsoftConfig();
  return requestToken({
    client_id: clientId ?? "",
    client_secret: clientSecret ?? "",
    code,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
    scope: MICROSOFT_SCOPES.join(" "),
  });
}

export async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const { clientId, clientSecret } = microsoftConfig();
  return requestToken({
    client_id: clientId ?? "",
    client_secret: clientSecret ?? "",
    refresh_token: refreshToken,
    grant_type: "refresh_token",
    scope: MICROSOFT_SCOPES.join(" "),
  });
}

export function storeTokens(
  emailAccountId: string,
  tokens: TokenResponse,
  opts: { emailAddress?: string; providerAccountId?: string } = {}
) {
  const expiresAt = new Date(Date.now() + (tokens.expires_in - 60) * 1000).toISOString();
  run(
    `UPDATE EmailAccount
     SET accessTokenEnc = ?,
         refreshTokenEnc = COALESCE(?, refreshTokenEnc),
         tokenExpiresAt = ?,
         connected = 1,
         lastSyncError = NULL,
         emailAddress = COALESCE(?, emailAddress),
         providerAccountId = COALESCE(?, providerAccountId)
     WHERE id = ?`,
    [
      encryptSecret(tokens.access_token),
      tokens.refresh_token ? encryptSecret(tokens.refresh_token) : null,
      expiresAt,
      opts.emailAddress ?? null,
      opts.providerAccountId ?? null,
      emailAccountId,
    ]
  );
}

/**
 * Returns a usable access token, refreshing if it is expired or about to be.
 * Throws with an actionable message when the mailbox needs reconnecting —
 * a refresh token can be revoked by the user, an admin, or a password
 * change, and that must surface rather than silently return no mail.
 */
export async function getValidAccessToken(emailAccountId: string): Promise<string> {
  const account = get<{
    accessTokenEnc: string | null;
    refreshTokenEnc: string | null;
    tokenExpiresAt: string | null;
  }>(`SELECT accessTokenEnc, refreshTokenEnc, tokenExpiresAt FROM EmailAccount WHERE id = ?`, [
    emailAccountId,
  ]);

  if (!account) throw new Error(`Email account ${emailAccountId} not found`);

  const notExpired =
    account.tokenExpiresAt && new Date(account.tokenExpiresAt).getTime() > Date.now();
  if (notExpired) {
    const token = decryptSecret(account.accessTokenEnc);
    if (token) return token;
  }

  const refreshToken = decryptSecret(account.refreshTokenEnc);
  if (!refreshToken) {
    markSyncError(emailAccountId, "No usable refresh token — mailbox must be reconnected.");
    throw new Error(
      "This mailbox needs to be reconnected (no valid refresh token). Visit /api/v1/integrations/microsoft/start"
    );
  }

  try {
    const tokens = await refreshAccessToken(refreshToken);
    storeTokens(emailAccountId, tokens);
    return tokens.access_token;
  } catch (err) {
    markSyncError(emailAccountId, String(err instanceof Error ? err.message : err));
    throw err;
  }
}

export function markSyncError(emailAccountId: string, message: string) {
  run(`UPDATE EmailAccount SET lastSyncError = ?, connected = 0 WHERE id = ?`, [
    message.slice(0, 500),
    emailAccountId,
  ]);
}

export function markSynced(emailAccountId: string, deltaLink?: string | null) {
  run(
    `UPDATE EmailAccount SET lastSyncedAt = ?, lastSyncError = NULL, connected = 1, deltaLink = COALESCE(?, deltaLink) WHERE id = ?`,
    [nowIso(), deltaLink ?? null, emailAccountId]
  );
}
