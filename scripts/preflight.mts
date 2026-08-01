/**
 * PREFLIGHT — checks the Microsoft connection settings before you use them.
 *
 *   npm run preflight
 *
 * Run this the moment you have the four values from the Entra app
 * registration. It checks everything that can be checked without a browser,
 * and when something is wrong it says WHICH thing is wrong rather than
 * "Graph returned 401".
 *
 * What it can prove on its own:
 *   - the four values are present and are the right shape
 *   - the tenant exists
 *   - the client ID exists inside that tenant
 *   - the client secret is accepted, and hasn't expired
 *
 * What genuinely needs a browser (and is checked at that moment instead):
 *   - admin consent
 *   - offline_access — see the callback route; a sign-in that returns no
 *     refresh token is rejected loudly there rather than dying an hour later
 */
import fs from "node:fs";
import path from "node:path";
import {
  diagnoseAadResponse,
  diagnoseGraphResponse,
  formatDiagnosis,
  Diagnosis,
} from "@/lib/email/microsoft-diagnostics";
import { parseEnvFile, looksLikeGuid, looksLikeEmail, maskSecret } from "./env-file.mts";
import { exitCleanly } from "./exit-cleanly.mts";

const ROOT = process.cwd();
const ENV_PATH = path.join(ROOT, ".env.local");
const EXPECTED_CALLBACK_PATH = "/api/v1/integrations/microsoft/callback";

// Read .env.local directly rather than trusting the ambient environment: the
// point of this script is to check the file the app will actually read.
const env = fs.existsSync(ENV_PATH)
  ? parseEnvFile(fs.readFileSync(ENV_PATH, "utf-8"))
  : new Map<string, string>();

const value = (key: string) => (env.get(key) ?? process.env[key] ?? "").trim();

let failures = 0;
let warnings = 0;

function pass(label: string, detail = "") {
  console.log(`  OK    ${label}${detail ? `  ${detail}` : ""}`);
}
function warn(label: string, detail: string) {
  warnings++;
  console.log(`  WARN  ${label}`);
  console.log(`        ${detail}`);
}
function fail(label: string, diagnosis: Diagnosis | string) {
  failures++;
  console.log(`  FAIL  ${label}`);
  console.log("");
  console.log(typeof diagnosis === "string" ? `  ${diagnosis}` : formatDiagnosis(diagnosis));
  console.log("");
}

console.log("");
console.log("  Outlook connection preflight");
console.log("  " + "=".repeat(58));
console.log("");

// --- 1. Are the values there, and do they look like themselves? --------------

console.log("  Settings in .env.local");
console.log("  " + "-".repeat(58));

if (!fs.existsSync(ENV_PATH)) {
  fail(".env.local exists", "There is no .env.local file. Run `npm run setup` first.");
  // No network yet at this point, so a plain exit is safe here.
  process.exit(1);
}

const clientId = value("MICROSOFT_CLIENT_ID");
const tenantId = value("MICROSOFT_TENANT_ID");
const clientSecret = value("MICROSOFT_CLIENT_SECRET");
const mailbox = value("MICROSOFT_MAILBOX");
const encryptionKey = value("APP_ENCRYPTION_KEY");
const baseUrl = value("APP_BASE_URL") || "http://localhost:3000";
const redirectUri = value("MICROSOFT_REDIRECT_URI") || `${baseUrl.replace(/\/$/, "")}${EXPECTED_CALLBACK_PATH}`;

if (!clientId) fail("Client ID present", "MICROSOFT_CLIENT_ID is empty. Run `npm run setup`.");
else if (!looksLikeGuid(clientId))
  fail(
    "Client ID looks right",
    "MICROSOFT_CLIENT_ID is not in the right form. It should be 36 characters with dashes, copied from Entra → your app → Overview → Application (client) ID."
  );
else pass("Client ID", clientId);

if (!tenantId) fail("Tenant ID present", "MICROSOFT_TENANT_ID is empty. Run `npm run setup`.");
else if (tenantId.toLowerCase() === "common")
  warn(
    "Tenant ID",
    "Set to 'common'. This works, but it makes every failure vaguer — Microsoft can no longer tell you the app is missing from your directory. Use the real Directory (tenant) ID from Entra → your app → Overview."
  );
else if (!looksLikeGuid(tenantId))
  fail(
    "Tenant ID looks right",
    "MICROSOFT_TENANT_ID is not in the right form. Copy Directory (tenant) ID from Entra → your app → Overview — it sits directly below the client ID on the same page."
  );
else pass("Tenant ID", tenantId);

if (clientId && tenantId && clientId.toLowerCase() === tenantId.toLowerCase()) {
  fail(
    "Client ID and Tenant ID are different",
    "MICROSOFT_CLIENT_ID and MICROSOFT_TENANT_ID are the same value. They sit next to each other on the Entra Overview page and one has been pasted twice."
  );
}

if (!clientSecret) fail("Client secret present", "MICROSOFT_CLIENT_SECRET is empty. Run `npm run setup`.");
else if (looksLikeGuid(clientSecret))
  fail(
    "Client secret is the secret, not the ID",
    "MICROSOFT_CLIENT_SECRET is in GUID form, which means it is the Secret ID column and not the Value column. Entra shows the Value only once, immediately after you create the secret. If you have navigated away, create a new secret and copy the VALUE column."
  );
else pass("Client secret", maskSecret(clientSecret));

if (!mailbox) warn("Mailbox address", "MICROSOFT_MAILBOX is not set. It is only used for labelling, so this is not fatal.");
else if (!looksLikeEmail(mailbox)) warn("Mailbox address", `MICROSOFT_MAILBOX ("${mailbox}") does not look like an email address.`);
else pass("Mailbox address", mailbox);

if (!encryptionKey)
  fail(
    "Token encryption key present",
    "APP_ENCRYPTION_KEY is empty. Mailbox tokens have nowhere safe to be stored and the app will refuse to start the connection. Run `npm run setup` — it generates one for you."
  );
else if (Buffer.from(encryptionKey, "base64").length < 32)
  warn(
    "Token encryption key",
    "APP_ENCRYPTION_KEY is shorter than 32 bytes. It still works (it gets hashed to the right length) but a key generated by `npm run setup` is stronger."
  );
else pass("Token encryption key", "set");

// --- 2. The redirect URI, which must match Entra character for character -----

if (!redirectUri.endsWith(EXPECTED_CALLBACK_PATH)) {
  fail(
    "Redirect URI points at this app's callback",
    `MICROSOFT_REDIRECT_URI is "${redirectUri}" but it must end with ${EXPECTED_CALLBACK_PATH}. Anything else and Microsoft will send the sign-in result somewhere this app isn't listening.`
  );
} else if (/\/$/.test(redirectUri)) {
  fail(
    "Redirect URI has no trailing slash",
    `MICROSOFT_REDIRECT_URI ends with a slash. Microsoft compares this exactly, and "...callback/" does not equal "...callback".`
  );
} else {
  pass("Redirect URI", redirectUri);
  console.log("");
  console.log("        This must appear EXACTLY as written above in");
  console.log("        Entra → your app → Authentication → Web → Redirect URIs.");
}

console.log("");

if (failures > 0) {
  console.log("  " + "=".repeat(58));
  console.log(`  ${failures} problem(s) found in the settings. Fix those first —`);
  console.log("  there is no point asking Microsoft until they are right.");
  console.log("");
  await exitCleanly(1);
  process.exit(1);
}

// --- 3. Ask Microsoft ---------------------------------------------------------

console.log("  Checking with Microsoft");
console.log("  " + "-".repeat(58));

const authority = `https://login.microsoftonline.com/${tenantId}`;

// 3a. Does the tenant exist? This needs no secret, so when it fails we know
//     the tenant ID is wrong and nothing else is implicated.
try {
  const discovery = await fetch(`${authority}/v2.0/.well-known/openid-configuration`);
  if (!discovery.ok) {
    const body = await discovery.text().catch(() => "");
    fail("Tenant exists", diagnoseAadResponse(discovery.status, body));
  } else {
    pass("Tenant exists", tenantId);
  }
} catch (err) {
  fail(
    "Reached Microsoft",
    `Could not reach login.microsoftonline.com — ${String(err)}. Check the internet connection, or a firewall/proxy blocking it.`
  );
}

// 3b. Is the client ID known in that tenant, and is the secret accepted?
//     The client-credentials grant answers both without any human interaction.
//     It does not prove the DELEGATED permissions are granted — that is what
//     the browser step is for — but it isolates the three things that go wrong
//     most often.
if (failures === 0) {
  try {
    const tokenResponse = await fetch(`${authority}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "client_credentials",
        scope: "https://graph.microsoft.com/.default",
      }).toString(),
    });

    const body = await tokenResponse.text().catch(() => "");

    if (tokenResponse.ok) {
      pass("Client ID and secret accepted");

      // The token's `tid` claim is the tenant Microsoft actually authenticated
      // against. If it differs from what is configured, something resolved
      // elsewhere and every later error would have been misleading.
      try {
        const accessToken = (JSON.parse(body) as { access_token?: string }).access_token ?? "";
        const claims = JSON.parse(Buffer.from(accessToken.split(".")[1], "base64").toString("utf-8"));
        if (claims.tid && tenantId.toLowerCase() !== "common" && claims.tid.toLowerCase() !== tenantId.toLowerCase()) {
          warn("Tenant matches", `Signed in against tenant ${claims.tid}, but .env.local says ${tenantId}.`);
        } else if (claims.tid) {
          pass("Tenant confirmed by Microsoft", claims.tid);
        }
      } catch {
        // Token shape is Microsoft's business, not ours. Not being able to
        // read it proves nothing either way, so say nothing.
      }
    } else {
      const diagnosis = diagnoseAadResponse(tokenResponse.status, body);
      // A tenant with no APPLICATION permissions granted rejects the
      // client-credentials grant on those grounds alone. That is not a
      // problem for us — this app only ever uses delegated permissions —
      // so it must not be reported as a credential failure.
      if (/AADSTS500011|AADSTS7000229|no permissions|not have permission/i.test(body) && !/AADSTS7000215|AADSTS700016|AADSTS7000222/.test(body)) {
        pass("Client ID and secret accepted", "(app has no application-level permissions, which is correct here)");
      } else {
        fail("Client ID and secret accepted", diagnosis);
      }
    }
  } catch (err) {
    fail("Reached Microsoft's token endpoint", `Could not reach it — ${String(err)}.`);
  }
}

// --- 4. If a mailbox is already connected, prove it can still read mail ------

if (failures === 0) {
  const { get } = await import("@/lib/db");
  const account = get<{ id: string; emailAddress: string; lastSyncError: string | null }>(
    `SELECT id, emailAddress, lastSyncError FROM EmailAccount WHERE providerType = 'MICROSOFT_365' LIMIT 1`
  );

  if (!account) {
    console.log("");
    console.log("  No mailbox connected yet — that is the next step, below.");
  } else {
    console.log("");
    console.log("  Checking the connected mailbox");
    console.log("  " + "-".repeat(58));

    try {
      const { getValidAccessToken } = await import("@/lib/email/microsoft-oauth");
      const token = await getValidAccessToken(account.id);

      const probe = await fetch("https://graph.microsoft.com/v1.0/me/mailFolders/inbox?$select=id,totalItemCount", {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      });
      const probeBody = await probe.text().catch(() => "");

      if (probe.ok) {
        const inbox = JSON.parse(probeBody) as { totalItemCount?: number };
        pass("Can read the inbox", `${account.emailAddress} — ${inbox.totalItemCount ?? "?"} messages`);
      } else {
        fail("Can read the inbox", diagnoseGraphResponse(probe.status, probeBody));
      }
    } catch (err) {
      fail("Can read the inbox", `${String(err instanceof Error ? err.message : err)}`);
    }
  }
}

// --- verdict ------------------------------------------------------------------

console.log("");
console.log("  " + "=".repeat(58));

if (failures > 0) {
  console.log(`  ${failures} problem(s) found. Fix the FAIL above and run this again.`);
  console.log("");
} else {
  console.log(`  Settings check passed${warnings > 0 ? ` (${warnings} warning(s) above)` : ""}.`);
  console.log("");
  console.log("  Two things this cannot check without a browser — admin consent,");
  console.log("  and offline_access. Both are checked the moment you connect,");
  console.log("  and both fail loudly rather than quietly. To connect:");
  console.log("");
  console.log("    1.  npm run dev");
  console.log("    2.  open http://localhost:3000 and sign in");
  console.log("    3.  go to Settings and click Connect Outlook");
  console.log("    4.  approve the Microsoft consent screen");
  console.log("");
  console.log("  Then:  npm run sync");
  console.log("");
}

await exitCleanly(failures > 0 ? 1 : 0);
