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

    const value = answer === "" ? current || opts.fallback || "" : answer;

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

  await ask({
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

// --- 2. The AI ---------------------------------------------------------------

console.log("  2. AI");
console.log("  " + "-".repeat(50));

await ask({
  key: "ANTHROPIC_API_KEY",
  label: "Anthropic API key",
  help: "From platform.claude.com/settings/keys. Leave blank to use the free\n  built-in word-matcher instead (much less accurate).",
  secret: true,
  optional: true,
});

if (existing.get("ANTHROPIC_API_KEY") || updates.some((u) => u.key === "ANTHROPIC_API_KEY" && u.value)) {
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
