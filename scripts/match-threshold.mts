/**
 * Reads the strong-match threshold out of `src/lib/ai/match.ts`.
 *
 * Why read the source rather than import the value: `match.ts` deliberately
 * does not export it, and invariant 4 says that file is not to be edited
 * without asking. Copying the number here instead would let the diagnostic
 * quietly start lying the day someone retunes the matcher — which is the exact
 * failure this whole diagnostic exists to prevent.
 *
 * Returns null rather than a guess if the constant can't be found, so callers
 * can say "threshold unknown" instead of printing a wrong one.
 */
import fs from "node:fs";
import path from "node:path";

export function readStrongMatchThreshold(root: string): number | null {
  try {
    const source = fs.readFileSync(path.join(root, "src", "lib", "ai", "match.ts"), "utf-8");
    const m = source.match(/STRONG_MATCH_THRESHOLD\s*=\s*(\d+)/);
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}
