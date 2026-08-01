import fs from "node:fs";
import path from "node:path";

/**
 * Read `.env.local` the way the app does.
 *
 * Next.js loads this file automatically, but a plain script run by Windows
 * Task Scheduler does not — so `npm run sync` and `npm run preflight` would
 * otherwise see no mailbox settings at all and report "nothing is connected"
 * on a machine that is perfectly well connected.
 *
 * Values already present in the real environment win, so a value passed on the
 * command line for one run is not silently overwritten by the file.
 */
export function loadEnvLocal(rootDir?: string): void {
  const root = rootDir ?? path.resolve(import.meta.dirname, "..");
  const envPath = path.join(root, ".env.local");
  if (!fs.existsSync(envPath)) return;

  // Windows editors (Notepad in particular) write CRLF and sometimes a BOM.
  // Both would end up inside the value and produce a Graph 401 that looks like
  // a bad secret — strip them here rather than debugging it later.
  const text = fs.readFileSync(envPath, "utf-8").replace(/^﻿/, "");

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;

    process.env[key] = rawValue.trim().replace(/^(["'])(.*)\1$/, "$2");
  }
}
