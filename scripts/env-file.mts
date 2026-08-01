/**
 * Reading and rewriting `.env.local` without losing anything already in it.
 *
 * Kept separate from setup.mts and tested directly, because the failure mode
 * here is silent and expensive: a setup script that clobbers the file wipes
 * the API key, and the app then falls back to the free word-matcher and looks
 * merely worse rather than broken.
 *
 * Rules:
 *   - An existing key is edited in place, keeping its position and any comment
 *     above it.
 *   - A new key is appended under a labelled section.
 *   - Comments, blank lines and unrecognised lines are preserved verbatim.
 *   - A value containing spaces or '#' is quoted, because the app's own
 *     .env reader (and Next's) would otherwise truncate it.
 */

const ASSIGNMENT = /^(\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*=\s*)(.*)$/;

export interface EnvEntry {
  key: string;
  value: string;
}

/** Every KEY=VALUE in the file, last occurrence winning, quotes stripped. */
export function parseEnvFile(text: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*#/.test(line)) continue;
    const match = line.match(ASSIGNMENT);
    if (!match) continue;
    found.set(match[2], stripQuotes(match[4].trim()));
  }
  return found;
}

export function stripQuotes(value: string): string {
  const match = value.match(/^(["'])(.*)\1$/);
  return match ? match[2] : value;
}

/** Quote only when leaving it bare would change how it reads back. */
export function quoteIfNeeded(value: string): string {
  if (value === "") return "";
  if (/^["'].*["']$/.test(value)) return value;
  if (/[\s#]/.test(value)) return `"${value.replace(/"/g, '\\"')}"`;
  return value;
}

/**
 * Returns the file text with `updates` applied. Keys already present are
 * edited where they sit; the rest are appended under `sectionHeading`.
 */
export function upsertEnvValues(
  originalText: string,
  updates: EnvEntry[],
  sectionHeading = "Added by npm run setup"
): string {
  const pending = new Map(updates.map((u) => [u.key, u.value]));
  const hadTrailingNewline = originalText === "" || /\r?\n$/.test(originalText);
  const newline = originalText.includes("\r\n") ? "\r\n" : "\n";

  const rewritten = originalText.split(/\r?\n/).map((line) => {
    if (/^\s*#/.test(line)) return line;
    const match = line.match(ASSIGNMENT);
    if (!match) return line;

    const [, indent, key, separator] = match;
    if (!pending.has(key)) return line;

    const value = pending.get(key)!;
    pending.delete(key);
    return `${indent}${key}${separator}${quoteIfNeeded(value)}`;
  });

  // Drop a single trailing empty element so we don't accumulate blank lines
  // every time setup is re-run.
  if (rewritten.length > 0 && rewritten[rewritten.length - 1] === "") rewritten.pop();

  if (pending.size > 0) {
    if (rewritten.length > 0) rewritten.push("");
    rewritten.push(`# --- ${sectionHeading} ---`);
    for (const [key, value] of pending) {
      rewritten.push(`${key}=${quoteIfNeeded(value)}`);
    }
  }

  const joined = rewritten.join(newline);
  return hadTrailingNewline || joined !== "" ? joined + newline : joined;
}

/** Shows enough of a secret to recognise it, never enough to use it. */
export function maskSecret(value: string | undefined): string {
  if (!value) return "(not set)";
  if (value.length <= 8) return "(set)";
  return `${value.slice(0, 4)}…${value.slice(-2)} (${value.length} chars)`;
}

/**
 * A tenant ID or client ID must be a GUID. Catching this at setup time is the
 * difference between a clear message now and a Graph error in a browser later.
 */
export function looksLikeGuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim());
}

export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}
