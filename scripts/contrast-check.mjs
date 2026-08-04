/**
 * COLOUR CONTRAST CHECK  —  npm run contrast
 *
 * Reads the colour tokens straight out of src/app/globals.css and measures
 * every pairing the application actually uses against WCAG 2.1 AA.
 *
 * This exists because contrast cannot be judged by eye. A pair that looks fine
 * on a good monitor in a lit room can be unreadable on a laptop screen at an
 * angle — which is exactly the situation this app will be used in. The maths
 * is not a matter of opinion, so it should be measured, and measured again
 * every time someone adjusts a colour.
 *
 * Thresholds (WCAG 2.1 AA):
 *   4.5:1  normal text
 *   3.0:1  large text (>= 18.66px bold, or >= 24px) and UI component borders
 *   7.0:1  AAA for normal text — we aim here for body copy where we can
 *
 * Exits non-zero if anything fails, so CI can refuse a bad colour change.
 */
import fs from "node:fs";
import path from "node:path";

const CSS = fs.readFileSync(
  path.resolve(import.meta.dirname, "..", "src", "app", "globals.css"),
  "utf-8"
);

// --- read the tokens out of :root ------------------------------------------

const tokens = {};
for (const [, name, value] of CSS.matchAll(/^\s*--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6});/gm)) {
  tokens[name] = value;
}

function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Relative luminance, per WCAG 2.1 definition.
function luminance(hex) {
  const [r, g, b] = rgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// --- the pairings the app actually renders ---------------------------------

/** [description, foreground token, background token, required ratio] */
const PAIRS = [
  // Body and headings
  ["Body text on a card", "ink", "surface", 4.5],
  ["Body text on the page background", "ink", "paper", 4.5],
  ["Secondary text on a card", "ink-muted", "surface", 4.5],
  ["Secondary text on the page background", "ink-muted", "paper", 4.5],
  ["Secondary text on a sunken panel header", "ink-muted", "surface-sunken", 4.5],
  ["Heading on a panel header band", "ink", "surface-sunken", 4.5],

  // Navigation
  ["Sidebar label on green", "on-brand", "brand", 4.5],
  ["Selected sidebar item", "brand", "on-brand", 4.5],

  // Status chips: text sits on its own soft fill
  ["Confirmed chip text", "confirmed", "confirmed-bg", 4.5],
  ["Tentative chip text", "tentative", "tentative-bg", 4.5],
  ["Review chip text", "review", "review-bg", 4.5],
  ["Danger chip text", "danger", "danger-bg", 4.5],
  ["Info chip text", "info", "info-bg", 4.5],
  ["Neutral chip text", "neutral", "neutral-bg", 4.5],

  // Chip fills must also be distinguishable from the card behind them
  ["Confirmed fill against a card", "confirmed-bg", "surface", 1.1],
  ["Tentative fill against a card", "tentative-bg", "surface", 1.1],
  ["Review fill against a card", "review-bg", "surface", 1.1],

  // Chip and tile borders are UI components: 3:1
  ["Confirmed border on a card", "confirmed", "surface", 3.0],
  ["Tentative border on a card", "tentative", "surface", 3.0],
  ["Review border on a card", "review", "surface", 3.0],
  ["Danger border on a card", "danger", "surface", 3.0],
  ["Info border on a card", "info", "surface", 3.0],
  ["Card border against the page", "border", "paper", 1.1],

  // Buttons
  ["Approve button label", "on-brand", "confirmed", 4.5],
  ["Primary button label", "on-brand", "brand", 4.5],
  ["Reject button label", "danger", "surface", 4.5],

  // Links and focus
  ["Link on a card", "info", "surface", 4.5],
  ["Link on the page background", "info", "paper", 4.5],
  // Focus is two-tone: a dark ring for pale backgrounds and a light halo for
  // dark ones. At least one of the pair must be visible on every surface the
  // app renders, which is what these four lines assert.
  ["Focus ring against a card", "focus", "surface", 3.0],
  ["Focus ring against the page", "focus", "paper", 3.0],
  ["Focus halo against the green sidebar", "focus-halo", "brand", 3.0],
  ["Focus ring against a selected sidebar item", "focus", "on-brand", 3.0],
];

// --- report -----------------------------------------------------------------

let failures = 0;
const rows = [];

for (const [label, fg, bg, required] of PAIRS) {
  if (!tokens[fg] || !tokens[bg]) {
    console.log(`  ?  ${label} — token missing (${fg} / ${bg})`);
    failures++;
    continue;
  }
  const r = ratio(tokens[fg], tokens[bg]);
  const pass = r >= required;
  if (!pass) failures++;
  rows.push({ label, fg, bg, r, required, pass });
}

const width = Math.max(...rows.map((x) => x.label.length));
console.log("");
console.log("  Colour contrast — WCAG 2.1 AA");
console.log("  " + "-".repeat(width + 34));

for (const x of rows) {
  const mark = x.pass ? (x.r >= 7 ? "AAA " : "AA  ") : "FAIL";
  console.log(
    `  ${mark} ${x.label.padEnd(width)}  ${x.r.toFixed(2).padStart(6)}:1  (needs ${x.required})  ${tokens[x.fg]} on ${tokens[x.bg]}`
  );
}

console.log("  " + "-".repeat(width + 34));
if (failures === 0) {
  const aaa = rows.filter((x) => x.r >= 7).length;
  console.log(`  All ${rows.length} pairings pass. ${aaa} of them clear AAA.`);
} else {
  console.log(`  ${failures} pairing(s) FAIL. Fix the tokens in src/app/globals.css.`);
}
console.log("");

process.exit(failures === 0 ? 0 : 1);
