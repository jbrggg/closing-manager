// -----------------------------------------------------------------------------
// Turning Microsoft's errors into a sentence that names the wrong thing.
//
// This adapter has never run against a live tenant, and the first connection
// attempt is where an afternoon goes. Microsoft's own surfacing is a 401 with
// "AADSTS7000215: Invalid client secret provided" buried in a JSON blob, or —
// worse — a plain Graph 401 that looks identical whether the secret is wrong,
// the tenant is wrong, or nobody consented.
//
// Every mapping below names ONE thing to change and where to change it. The
// codes come from Microsoft's published AADSTS error reference; where the code
// is missing or unrecognised we say so rather than guessing, because a
// confident wrong diagnosis costs more than an honest "unknown".
// -----------------------------------------------------------------------------

export type DiagnosisKind =
  | "ok"
  | "client-secret"
  | "secret-expired"
  | "tenant"
  | "client-id"
  | "app-not-in-tenant"
  | "redirect-uri"
  | "consent"
  | "offline-access"
  | "mail-permission"
  | "mailbox-missing"
  | "network"
  | "unknown";

export interface Diagnosis {
  kind: DiagnosisKind;
  /** One line naming what is wrong. */
  problem: string;
  /** What to do about it, in the place where it is done. */
  fix: string;
  /** Microsoft's own code, kept so it can be searched for. */
  code?: string;
}

/** Pulls the AADSTS code out of any of the shapes Microsoft returns it in. */
export function extractAadstsCode(text: string): string | null {
  const match = text.match(/AADSTS(\d+)/);
  return match ? `AADSTS${match[1]}` : null;
}

const AADSTS: Record<string, Omit<Diagnosis, "code">> = {
  // --- the secret -----------------------------------------------------------
  AADSTS7000215: {
    kind: "client-secret",
    problem: "The client secret is wrong.",
    fix:
      "In Entra → your app → Certificates & secrets, copy the column headed " +
      "VALUE (not the one headed Secret ID — that one is a GUID and is the " +
      "single most common mix-up). The value is only shown right after you " +
      "create the secret; if you navigated away, create a new one. Then run " +
      "`npm run setup` again.",
  },
  AADSTS7000222: {
    kind: "secret-expired",
    problem: "The client secret has expired.",
    fix:
      "In Entra → your app → Certificates & secrets, click New client secret, " +
      "copy the VALUE column, and run `npm run setup` again. Note the new " +
      "expiry date — secrets expire in 6, 12 or 24 months and the mailbox " +
      "stops syncing the day they do.",
  },
  AADSTS7000216: {
    kind: "client-secret",
    problem: "The app registration is not set up to use a client secret.",
    fix:
      "The app was probably registered as a public/mobile client. In Entra → " +
      "your app → Authentication, make sure the platform is Web (not " +
      "Single-page application or Mobile), then add the redirect URI there.",
  },

  // --- the tenant and the client ID ------------------------------------------
  AADSTS90002: {
    kind: "tenant",
    problem: "That tenant ID does not exist.",
    fix:
      "In Entra → your app → Overview, copy Directory (tenant) ID. It is a " +
      "different value from Application (client) ID on the same page — they " +
      "are easy to swap. Then run `npm run setup` again.",
  },
  AADSTS900023: {
    kind: "tenant",
    problem: "That tenant ID does not exist.",
    fix: "Copy Directory (tenant) ID from Entra → your app → Overview, then run `npm run setup` again.",
  },
  AADSTS700016: {
    kind: "app-not-in-tenant",
    problem: "The app registration was not found in that tenant.",
    fix:
      "The client ID and the tenant ID do not belong together — usually one " +
      "of them was copied from a different app registration or a different " +
      "Microsoft account. Open Entra → App registrations → your app → " +
      "Overview and copy BOTH IDs from that one page, then run `npm run setup`.",
  },
  AADSTS700027: {
    kind: "app-not-in-tenant",
    problem: "The app registration was not found in that tenant.",
    fix: "Copy both the client ID and the tenant ID from the same Overview page in Entra, then run `npm run setup`.",
  },
  AADSTS500011: {
    kind: "app-not-in-tenant",
    problem: "Microsoft Graph is not available to this app in that tenant.",
    fix:
      "In Entra → your app → API permissions, add Microsoft Graph → Delegated " +
      "permissions → Mail.Read, offline_access and User.Read, then click " +
      "Grant admin consent.",
  },
  AADSTS700009: {
    kind: "client-id",
    problem: "That client ID does not exist.",
    fix: "Copy Application (client) ID from Entra → your app → Overview, then run `npm run setup` again.",
  },

  // --- the redirect URI -------------------------------------------------------
  AADSTS50011: {
    kind: "redirect-uri",
    problem: "The redirect address does not match the app registration.",
    fix:
      "It must match character for character. In Entra → your app → " +
      "Authentication → Web → Redirect URIs, the entry must be exactly:\n" +
      "    http://localhost:3000/api/v1/integrations/microsoft/callback\n" +
      "No trailing slash, http not https, and lowercase.",
  },

  // --- consent ----------------------------------------------------------------
  AADSTS65001: {
    kind: "consent",
    problem: "Nobody has consented to this app reading the mailbox.",
    fix:
      "In Entra → your app → API permissions, click 'Grant admin consent for " +
      "<your organisation>'. If that button is greyed out you are not a " +
      "Global Administrator and will need someone who is.",
  },
  AADSTS90094: {
    kind: "consent",
    problem: "This needs an administrator's consent, and you are not one.",
    fix:
      "Ask a Global Administrator to open Entra → App registrations → your " +
      "app → API permissions and click 'Grant admin consent'. Until that is " +
      "done, no sign-in to this app can succeed.",
  },
  AADSTS65004: {
    kind: "consent",
    problem: "Consent was declined on the Microsoft sign-in screen.",
    fix: "Run the connect step again and click Accept rather than Cancel.",
  },
  AADSTS650056: {
    kind: "consent",
    problem: "The permissions requested don't match what the app registration asks for.",
    fix:
      "In Entra → your app → API permissions, the Microsoft Graph DELEGATED " +
      "permissions must include Mail.Read, offline_access and User.Read. " +
      "Delete any Application permissions — this app only ever reads as you.",
  },
  // --- tenant policy, not a mistake in the settings --------------------------
  AADSTS53003: {
    kind: "consent",
    problem: "A Conditional Access policy in the tenant is blocking this app.",
    fix:
      "Nothing in .env.local is wrong. An administrator has a rule that blocks " +
      "sign-ins from apps like this one — commonly 'require a compliant " +
      "device' or 'block legacy authentication'. A Global Administrator needs " +
      "to add an exclusion for this app in Entra → Protection → Conditional " +
      "Access.",
  },
  AADSTS50105: {
    kind: "consent",
    problem: "The signed-in account is not assigned to this app.",
    fix:
      "The app registration has 'Assignment required' switched on. In Entra → " +
      "Enterprise applications → your app → Users and groups, add the account " +
      "that owns the mailbox — or switch assignment off in Properties.",
  },
  AADSTS50076: {
    kind: "consent",
    problem: "Multi-factor authentication is required and wasn't completed.",
    fix:
      "Connect the mailbox again in a browser and complete the second factor " +
      "(the phone prompt or authenticator code) when Microsoft asks for it.",
  },
  AADSTS50020: {
    kind: "tenant",
    problem: "The account that signed in belongs to a different organisation.",
    fix:
      "The mailbox account and the app registration are in different Microsoft " +
      "tenants. Sign in with the account in the same organisation as the app, " +
      "or register the app in the organisation that owns the mailbox.",
  },
  AADSTS70011: {
    kind: "consent",
    problem: "One of the requested permissions is not valid for this app.",
    fix:
      "In Entra → your app → API permissions, remove everything and re-add " +
      "exactly: Microsoft Graph → Delegated → Mail.Read, offline_access, " +
      "User.Read. Then Grant admin consent.",
  },
};

/**
 * Diagnoses a failed OAuth token request or a consent-screen redirect.
 * `body` is the raw response text or the error_description query parameter.
 */
export function diagnoseAadResponse(status: number, body: string): Diagnosis {
  const code = extractAadstsCode(body);
  if (code && AADSTS[code]) return { ...AADSTS[code], code };

  // Some errors arrive as an OAuth error name without an AADSTS number. These
  // fallbacks only apply when there was NO code: if Microsoft gave us a code
  // and we don't know it, saying "probably the secret" is a guess, and a
  // confident wrong diagnosis sends someone to re-copy a value that was fine.
  if (code === null && /invalid_client/i.test(body)) {
    return {
      kind: "client-secret",
      problem: "Microsoft rejected the client ID or the client secret.",
      fix:
        "Re-copy both from Entra → your app: Application (client) ID from the " +
        "Overview page, and the secret from Certificates & secrets (the VALUE " +
        "column, not Secret ID). Then run `npm run setup` again.",
      code: code ?? "invalid_client",
    };
  }
  if (code === null && /unauthorized_client/i.test(body)) {
    return {
      kind: "app-not-in-tenant",
      problem: "This app is not allowed to use this sign-in method.",
      fix:
        "In Entra → your app → Authentication, make sure a Web platform " +
        "exists with the callback redirect URI, and that 'Allow public client " +
        "flows' is set to No.",
      code: code ?? "unauthorized_client",
    };
  }
  if (code === null && /consent_required|interaction_required/i.test(body)) {
    return { ...AADSTS.AADSTS65001, code: code ?? "consent_required" };
  }

  return {
    kind: "unknown",
    problem: `Microsoft returned ${status}${code ? ` (${code})` : ""} and this check doesn't recognise it.`,
    fix:
      "Search Microsoft's error reference for the code above, or send the " +
      "whole message on. Guessing here would waste more time than asking.",
    code: code ?? undefined,
  };
}

interface GraphErrorBody {
  error?: { code?: string; message?: string };
}

/**
 * Diagnoses a failed Microsoft Graph call made with a token we already hold.
 * A Graph 401 and a Graph 403 mean very different things and this is where
 * that distinction gets made instead of being flattened into "Graph failed".
 */
export function diagnoseGraphResponse(status: number, body: string): Diagnosis {
  let parsed: GraphErrorBody = {};
  try {
    parsed = JSON.parse(body) as GraphErrorBody;
  } catch {
    // Non-JSON error body; fall through to the status-based cases.
  }
  const graphCode = parsed.error?.code ?? "";
  const message = parsed.error?.message ?? body;

  if (status === 401) {
    // Almost always the token, not the permissions — Graph returns 403 when a
    // valid token simply lacks a scope.
    return {
      kind: "consent",
      problem: "Microsoft rejected the access token.",
      fix:
        "The mailbox needs reconnecting: open http://localhost:3000/settings " +
        "and click Connect Outlook. If it fails again immediately, the client " +
        "secret has probably been rotated or expired — run `npm run preflight`.",
      code: graphCode || "401",
    };
  }

  if (status === 403) {
    if (/Mail|Access is denied|ErrorAccessDenied/i.test(`${graphCode} ${message}`)) {
      return {
        kind: "mail-permission",
        problem: "The connection is valid but is not allowed to read mail.",
        fix:
          "Mail.Read is missing or was never consented. In Entra → your app → " +
          "API permissions, add Microsoft Graph → Delegated → Mail.Read, click " +
          "'Grant admin consent', then reconnect the mailbox at " +
          "http://localhost:3000/settings.",
        code: graphCode || "403",
      };
    }
    return {
      kind: "mail-permission",
      problem: "Microsoft refused the request as not permitted.",
      fix:
        "Check Entra → your app → API permissions holds Microsoft Graph → " +
        "Delegated → Mail.Read, offline_access and User.Read, all showing " +
        "'Granted' in the Status column.",
      code: graphCode || "403",
    };
  }

  if (status === 404 && /MailboxNotEnabled|ResourceNotFound|MailboxNotFound/i.test(`${graphCode} ${message}`)) {
    return {
      kind: "mailbox-missing",
      problem: "That account has no Exchange Online mailbox.",
      fix:
        "The account signed in during consent has no mailbox — this happens " +
        "with accounts that have no Microsoft 365 licence assigned. Sign in " +
        "as the account that actually receives the closing email.",
      code: graphCode || "404",
    };
  }

  if (status === 429) {
    return {
      kind: "network",
      problem: "Microsoft is rate limiting this mailbox right now.",
      fix: "Nothing is wrong. Wait a few minutes and run it again — sync resumes where it stopped.",
      code: "429",
    };
  }

  return {
    kind: "unknown",
    problem: `Microsoft Graph returned ${status}${graphCode ? ` (${graphCode})` : ""}.`,
    fix: `Message from Microsoft: ${message.slice(0, 300)}`,
    code: graphCode || String(status),
  };
}

/**
 * The one thing no error code will tell you: whether `offline_access` was
 * actually granted. Microsoft does not fail the sign-in when it is missing —
 * it succeeds, returns an access token with no refresh token, and the
 * connection silently dies about an hour later. Checking for the refresh
 * token at connect time is the only way to catch it while the human is still
 * sitting there.
 */
export function diagnoseMissingRefreshToken(grantedScope?: string): Diagnosis {
  return {
    kind: "offline-access",
    problem:
      "Microsoft signed in successfully but did not issue a refresh token, " +
      "which means `offline_access` was not granted.",
    fix:
      "Without it the connection stops working in about an hour and cannot " +
      "renew itself. In Entra → your app → API permissions, add Microsoft " +
      "Graph → Delegated → offline_access, click 'Grant admin consent', then " +
      "connect the mailbox again." +
      (grantedScope ? `\n\nMicrosoft granted: ${grantedScope}` : ""),
    code: "no_refresh_token",
  };
}

/** Formats a diagnosis for a terminal. */
export function formatDiagnosis(d: Diagnosis): string {
  const lines = [`  ${d.problem}`, ""];
  for (const line of d.fix.split("\n")) lines.push(`  ${line}`);
  if (d.code) lines.push("", `  (Microsoft's code for this: ${d.code})`);
  return lines.join("\n");
}
