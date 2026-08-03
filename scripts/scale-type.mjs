/**
 * ONE-TIME TYPE SCALE CODEMOD  —  npm run scale-type
 *
 * The screens were built with hard-coded pixel sizes: text-[11px], text-[13px]
 * and so on. That is fine until you learn the app is unreadable for the person
 * actually using it, at which point 139 numbers scattered across 13 files all
 * have to move together.
 *
 * This rewrites every `text-[Npx]` into a rem value, so from now on the whole
 * application's size is controlled by the single `font-size` on <html> in
 * globals.css. Raise that one number and everything grows in proportion.
 *
 * It is safe to run twice: after the first pass there are no `px` sizes left
 * to match, so the second run changes nothing.
 *
 * Anything not in the table is reported rather than guessed at.
 */
import fs from "node:fs";
import path from "node:path";

const SRC = path.resolve(import.meta.dirname, "..", "src");

// Old pixel size -> new rem value. Values below 16px get a large bump because
// they were the unreadable ones; larger headings grow more gently so the page
// keeps a sensible hierarchy instead of everything shouting at once.
const SCALE = {
  10: "0.875rem",   // ~15px  — was genuinely too small to read
  11: "0.9375rem",  // ~16px
  12: "1rem",       // 17px
  13: "1.0625rem",  // ~18px  — the old body size
  14: "1.125rem",   // ~19px
  15: "1.1875rem",  // ~20px
  16: "1.25rem",    // ~21px
  17: "1.3125rem",  // ~22px
  18: "1.375rem",   // ~23px
  20: "1.625rem",   // ~28px
  22: "1.75rem",    // ~30px
  24: "1.875rem",   // ~32px
  26: "2rem",       // ~34px  — the old dashboard stat number
  28: "2.25rem",
  30: "2.5rem",
  32: "2.75rem",
};

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.(tsx?|css)$/.test(entry.name)) out.push(full);
  }
  return out;
}

let filesChanged = 0;
let replacements = 0;
const unmapped = new Set();

for (const file of walk(SRC)) {
  const before = fs.readFileSync(file, "utf-8");
  const after = before.replace(/text-\[(\d+)px\]/g, (whole, px) => {
    const rem = SCALE[Number(px)];
    if (!rem) {
      unmapped.add(`${px}px`);
      return whole;
    }
    replacements++;
    return `text-[${rem}]`;
  });

  if (after !== before) {
    fs.writeFileSync(file, after, "utf-8");
    filesChanged++;
    console.log(`  updated  ${path.relative(SRC, file)}`);
  }
}

console.log("");
console.log(`  ${replacements} size(s) rewritten across ${filesChanged} file(s).`);
if (unmapped.size) {
  console.log(`  NOT CHANGED (no rule for these): ${[...unmapped].join(", ")}`);
  console.log(`  Add them to SCALE in scripts/scale-type.mjs and run again.`);
}
console.log("");
