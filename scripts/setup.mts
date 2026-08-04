/**
 * SETUP — writes .env.local for you.
 *
 *   npm run setup
 *
 * or double-click `setup.cmd` in this folder.
 *
 * Asks for the handful of values the app needs, generates the token
 * encryption key itself, and writes the file. Existing values are shown and
 * kept if you press Enter, so re-running it is safe and is the normal way to
 * change one setting.
 *
 * Why this exists: hand-editing a file whose name begins with a dot, in
 * Notepad, on Windows, is where this project lost an afternoon once already.
 */
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline/promises";
import {
  parseEnvFile,
  upsertEnvValues,
  maskSecret,
  looksLikeGuid,
  looksLikeEmail,
  looksLikeDomainList,
  normalizeDomainList,
  EnvEntry,
} from "./env-file.mts";

const ROOT = process.cwd();
const ENV_PATH = path.join(ROOT, ".env.local");

const rl = createInterface({ input: process.stdin, output: process.stdout });

const existingText = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, "utf-8") : "";
const existing = parseEnvFile(existingText);

console.log("");
console.log("  Closing Manager — setup");
console.log("  " + "=".repeat(50));
console.log("");
if (existingText) {
  console.log("  Found an existing .env.local. Press Enter at any question to");
  console.log("  keep what is already there. Nothing is deleted.");
} else {
  console.log("  This will create .env.local, which holds your settings and keys.");
  console.log("  It is excluded from GitHub and never leaves this computer.");
}
console.log("");

const updates: EnvEntry[] = [];

/** Asks one question, keeping the current value on an empty answer. */
async function ask(opts: {
  key: string;
  label: string;
  help?: string;
  secret?: boolean;
  validate?: (value: string) => string | null;
  /** Tidy the answer before it is checked and stored (trimming, lowercasing). */
  normalize?: (value: string) => string;
  fallback?: string;
  optional?: boolean;
}): Promise<string> {
  const current = existing.get(opts.key) ?? "";
  const shown = opts.secret ? maskSecret(current) : current || "(not set)";

  for (;;) {
    if (opts.help) console.log(`  ${opts.help}`);
    console.log(`  Current: ${shown}`);
    const answer = (await rl.question(`  ${opts.label}: `)).trim();
    console.log("");

    const raw = answer === "" ? current || opts.fallback || "" : answer;
    const value = raw && opts.normalize ? opts.normalize(raw) : raw;

    if (value === "" && !opts.optional) {
      console.log("  That one is required. Try again.\n");
      continue;
    }
    if (value !== "" && opts.validate) {
      const problem = opts.validate(value);
      if (problem) {
        console.log(`  ${problem}\n`);
        continue;
      }
    }

    if (value !== current) updates.push({ key: opts.key, value });
    return value;
  }
}

// --- 1. Do you want to connect a real mailbox at all? ------------------------

console.log("  1. Mailbox");
console.log("  " + "-".repeat(50));

/** Used to suggest the agency's own domain in section 2. */
let mailboxAddress = existing.get("MICROSOFT_MAILBOX") ?? "";
const connectOutlook = (
  await rl.question("  Connect a real Outlook / Microsoft 365 mailbox? [Y/n]: ")
)
  .trim()
  .toLowerCase();
console.log("");

const wantsOutlook = connectOutlook !== "n" && connectOutlook !== "no";

if (wantsOutlook) {
  console.log("  You need four things from the Entra app registration.");
  console.log("  If you don't have them yet, press Ctrl+C and come back.");
  console.log("");

  await ask({
    key: "MICROSOFT_CLIENT_ID",
    label: "Application (client) ID",
    help: "Entra admin center → App registrations → Overview → Application (client) ID",
    validate: (v) =>
      looksLikeGuid(v)
        ? null
        : "That doesn't look like an ID. It should be 36 characters with dashes, e.g. 11111111-2222-3333-4444-555555555555.",
  });

  await ask({
    key: "MICROSOFT_TENANT_ID",
    label: "Directory (tenant) ID",
    help: "Same Overview page → Directory (tenant) ID. NOT the same as the client ID.",
    validate: (v) =>
      looksLikeGuid(v)
        ? null
        : "That doesn't look like an ID. It should be 36 characters with dashes. If you pasted 'common', use the real tenant ID instead — it makes the error messages far clearer if something is wrong.",
  });

  await ask({
    key: "MICROSOFT_CLIENT_SECRET",
    label: "Client secret VALUE",
    help:
      "Certificates & secrets → the column headed Value, not the one headed\n  Secret ID. Microsoft only shows it once, right after you create it.",
    secret: true,
    validate: (v) =>
      looksLikeGuid(v)
        ? "That's the Secret ID, not the secret. The Value column is longer and is not in GUID form. If you've navigated away, create a new secret."
        : v.length < 20
          ? "That looks too short to be a client secret."
          : null,
  });

  mailboxAddress = await ask({
    key: "MICROSOFT_MAILBOX",
    label: "Mailbox address to read",
    help: "The address whose inbox this app should watch, e.g. closings@yourfirm.com",
    validate: (v) => (looksLikeEmail(v) ? null : "That doesn't look like an email address."),
  });

  const baseUrl = await ask({
    key: "APP_BASE_URL",
    label: "App address",
    help: "Leave as-is unless you're running somewhere other than your own machine.",
    fallback: "http://localhost:3000",
  });

  await ask({
    key: "MICROSOFT_REDIRECT_URI",
    label: "Redirect URI",
    help:
      "Must match the redirect URI in the Entra app registration EXACTLY —\n  character for character, including http vs https and the trailing path.",
    fallback: `${baseUrl.replace(/\/$/, "")}/api/v1/integrations/microsoft/callback`,
  });

  if ((existing.get("EMAIL_PROVIDER") ?? "") !== "microsoft") {
    updates.push({ key: "EMAIL_PROVIDER", value: "microsoft" });
  }
} else {
  console.log("  Staying on the built-in demo mailbox. You can re-run this later.\n");
  if (!existing.has("EMAIL_PROVIDER")) updates.push({ key: "EMAIL_PROVIDER", value: "mock" });
}

// --- 2. Which addresses are OURS ---------------------------------------------
// Small question, large consequences. This is what tells our own mail apart
// from everyone else's, and therefore which messages are requests made OF us
// rather than BY us. Unset, everything files as INCOMING and the app starts
// raising tasks from our own sent mail — which reads as an AI accuracy
// problem rather than a missing setting. It was previously only documented,
// never asked for.

console.log("  2. Your agency's own email");
console.log("  " + "-".repeat(50));

await ask({
  key: "ORG_EMAIL_DOMAINS",
  label: "Your email domain(s)",
  help:
    "Just the part after the @, e.g. aglobaltitleagency.com — not a whole\n" +
    "  address. Separate several with commas. Mail from these counts as sent\n" +
    "  BY you; everything else counts as sent TO you.",
  normalize: normalizeDomainList,
  fallback: mailboxAddress.includes("@") ? mailboxAddress.split("@").pop() : undefined,
  validate: (v) =>
    looksLikeDomainList(v)
      ? null
      : "That should be a domain like aglobaltitleagency.com, not a full address or a name.",
});

await ask({
  key: "ORG_EMAIL_ADDRESSES",
  label: "Any staff on a different domain (optional)",
  help: "Full addresses, comma separated. Press Enter to skip — most offices do.",
  optional: true,
});

// --- 3. The AI ---------------------------------------------------------------

console.log("  3. AI");
console.log("  " + "-".repeat(50));

await ask({
  key: "AI_API_KEY",
  label: "AI provider API key",
  help: "From your model provider's console. Leave blank to use the free\n  built-in word-matcher instead (much less accurate).",
  secret: true,
  optional: true,
});

// The older vendor-specific name is still honoured, so an existing .env.local
// is not invalidated by having run an older version of this script.
const hasKey = (k: string) => existing.get(k) || updates.some((u) => u.key === k && u.value);
if (hasKey("AI_API_KEY") || hasKey("ANTHROPIC_API_KEY")) {
  if ((existing.get("AI_PROVIDER") ?? "") !== "llm") {
    updates.push({ key: "AI_PROVIDER", value: "llm" });
  }
}

// --- 3. The token encryption key --------------------------------------------
// Generated, never asked for. It protects the mailbox tokens stored in the
// database, and a human-chosen value would be a worse one.

const hadKey = Boolean(existing.get("APP_ENCRYPTION_KEY"));
if (!hadKey) {
  updates.push({ key: "APP_ENCRYPTION_KEY", value: randomBytes(32).toString("base64") });
}

// --- write -------------------------------------------------------------------

rl.close();

if (updates.length === 0) {
  console.log("  Nothing changed. .env.local is already set up.\n");
  process.exit(0);
}

// Copy, don't rename: renaming over a file another process has open throws
// EBUSY on Windows. See the warning at the top of CLAUDE.md.
if (existingText) {
  fs.copyFileSync(ENV_PATH, `${ENV_PATH}.bak`);
}

fs.writeFileSync(ENV_PATH, upsertEnvValues(existingText, updates), "utf-8");

console.log("  " + "=".repeat(50));
console.log(`  Saved ${updates.length} setting(s) to .env.local`);
if (existingText) console.log("  (previous version kept as .env.local.bak)");
console.log("");

if (!hadKey) {
  console.log("  A new token encryption key was generated.");
  console.log("  It scrambles the mailbox passwords stored in the database.");
  console.log("  If you ever lose .env.local you will have to reconnect the");
  console.log("  mailbox — so keep a copy of that file wherever you keep");
  console.log("  other business passwords.");
  console.log("");
}

console.log("  Next step:");
console.log("");
if (wantsOutlook) {
  console.log("    npm run preflight     checks the four Microsoft values are right");
} else {
  console.log("    npm run dev           start the app");
}
console.log("");
console.log("  To try it on real email without connecting a mailbox, put");
console.log("  exported messages in the inbox folder and double-click");
console.log("  import.cmd. See inbox/README.md for how to export them.");
console.log("");
