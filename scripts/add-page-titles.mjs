/**
 * ONE-TIME CODEMOD — give every page its own browser title.
 *
 * WCAG 2.4.2 (Page Titled, Level A). Every page in this app carried the same
 * title, so a screen-reader user announcing the page, or anyone with six tabs
 * open, could not tell the review queue from the settings screen.
 *
 * Inserts `export const metadata` into each route's page.tsx, right after the
 * imports. Skips any file that already has one. Safe to run twice.
 */
import fs from "node:fs";
import path from "node:path";

const APP = path.resolve(import.meta.dirname, "..", "src", "app");

// Route folder -> the title a person would recognise. These match the words
// used in the sidebar, deliberately: the tab should say what the menu said.
const TITLES = {
  "board": "Closing Calendar",
  "transactions": "Files",
  "tasks": "Tasks",
  "review": "Needs Your Review",
  "lab": "Email Test Lab",
  "activity": "What The AI Did",
  "settings": "Settings",
  "login": "Sign in",
};

let changed = 0;
const skipped = [];

for (const [folder, title] of Object.entries(TITLES)) {
  const file = path.join(APP, folder, "page.tsx");
  if (!fs.existsSync(file)) {
    skipped.push(`${folder} (no page.tsx)`);
    continue;
  }

  const source = fs.readFileSync(file, "utf-8");
  if (/export const metadata/.test(source)) {
    skipped.push(`${folder} (already has a title)`);
    continue;
  }

  const lines = source.split(/\r?\n/);

  // Find the last import statement, and insert after it. Anything earlier
  // would land above an import, which is legal but reads badly.
  let insertAt = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/^import\s/.test(lines[i])) insertAt = i + 1;
  }

  const block = [
    "",
    'import type { Metadata } from "next";',
    "",
    "export const metadata: Metadata = {",
    `  title: ${JSON.stringify(title)},`,
    "};",
  ];

  lines.splice(insertAt, 0, ...block);
  fs.writeFileSync(file, lines.join("\n"), "utf-8");
  console.log(`  titled  ${folder}/page.tsx  ->  "${title}"`);
  changed++;
}

console.log("");
console.log(`  ${changed} page(s) given their own title.`);
for (const s of skipped) console.log(`  skipped ${s}`);
console.log("");
