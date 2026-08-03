/**
 * EXPORT THE EVAL CASES FOR TESTING AN AI AGENT BY HAND
 *
 *   npm run export-cases
 *
 * Produces three files in evals/export/:
 *
 *   1-prompt.md        paste this into the agent FIRST
 *   2-emails.md        paste this second — the emails, with NO answers
 *   3-answer-key.md    keep this back; paste it into a SECOND chat to grade
 *
 * WHY THE ANSWERS ARE IN A SEPARATE FILE
 *
 * Every case JSON carries an `expect` block, which is the answer key. Paste a
 * case file into a chat model and you have handed the test-taker the marking
 * scheme — it will score beautifully and you will have learned nothing. The
 * split is the entire point of this script.
 *
 * `npm run eval` does this properly and automatically against the real
 * pipeline. This export exists for the other job: pointing a DIFFERENT agent —
 * a chat model, a competitor's product, a prototype — at the same corpus and
 * comparing.
 */
import fs from "node:fs";
import path from "node:path";
import type { EvalCase } from "./eval-types.mts";

const ROOT = path.resolve(import.meta.dirname, "..");
const CASES_DIR = path.join(ROOT, "evals", "cases");
const OUT_DIR = path.join(ROOT, "evals", "export");

const flag = (name: string) => process.argv.includes(`--${name}`);
const publicOnly = flag("public-only");

function findCaseFiles(dir: string): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // --public-only skips the private folder, which holds real client mail.
        if (publicOnly && entry.name === "private") return [];
        return findCaseFiles(full);
      }
      return entry.name.endsWith(".json") ? [full] : [];
    });
}

const cases: EvalCase[] = findCaseFiles(CASES_DIR).flatMap((file) => {
  const text = fs.readFileSync(file, "utf-8");
  if (!text.trim()) return [];
  const raw = JSON.parse(text);
  return Array.isArray(raw) ? raw : [raw];
});

if (cases.length === 0) {
  console.error("No cases found.");
  process.exit(2);
}

fs.mkdirSync(OUT_DIR, { recursive: true });

// --- 2-emails.md : the test paper, with no answers on it ---------------------

const emails: string[] = [
  "# Test emails",
  "",
  `${cases.length} real (anonymised) emails from a title agency's mailbox.`,
  "",
  "Process them **in the order given**. Emails sharing a `Deal group` belong to",
  "the same transaction and must be judged together — a later email in a group",
  "is testing whether you file it onto the file an earlier one opened.",
  "",
  "---",
  "",
];

cases.forEach((c, i) => {
  emails.push(`## Email ${i + 1} of ${cases.length} — \`${c.id}\``);
  emails.push("");
  emails.push(`- **Direction:** ${c.direction ?? "INCOMING"}  ${
    (c.direction ?? "INCOMING") === "INCOMING"
      ? "(someone sent this to the agency)"
      : "(the agency sent this out)"
  }`);
  emails.push(`- **From:** ${c.from}`);
  emails.push(`- **Subject:** ${c.subject}`);
  if (c.group) emails.push(`- **Deal group:** ${c.group}`);
  emails.push("");
  emails.push("```");
  emails.push(c.body);
  emails.push("```");
  emails.push("");
  emails.push("---");
  emails.push("");
});

fs.writeFileSync(path.join(OUT_DIR, "2-emails.md"), emails.join("\n"));

// --- 3-answer-key.md : held back until grading -------------------------------

const key: string[] = [
  "# Answer key",
  "",
  "**Do not paste this into the agent being tested.** It is the marking scheme.",
  "Paste it into a separate chat together with the agent's answers.",
  "",
  "Every line below is a judgement a human made about a real email. Where a",
  "case says a value must NOT appear, that is guarding against a mistake the",
  "system actually made at least once.",
  "",
  "---",
  "",
];

cases.forEach((c, i) => {
  const e = c.expect ?? {};
  key.push(`## Email ${i + 1} — \`${c.id}\``);
  key.push("");
  if (c.note) key.push(`_${c.note}_`, "");

  if (e.facts?.length) {
    key.push("**Must extract:**");
    for (const f of e.facts) key.push(`- ${f.type} containing \`${f.contains}\`${f.why ? ` — ${f.why}` : ""}`);
    key.push("");
  }
  if (e.mustNotSay?.length) {
    key.push("**Must NOT say (these are traps):**");
    for (const g of e.mustNotSay) key.push(`- ${g.type} must not contain \`${g.text}\` — ${g.why ?? ""}`);
    key.push("");
  }
  if (e.tasks?.length) {
    key.push("**Must raise a task about:**");
    for (const t of e.tasks) key.push(`- \`${t.contains}\`${t.why ? ` — ${t.why}` : ""}`);
    key.push("");
  }
  if (typeof e.taskCount === "number") {
    key.push(`**Exact task count:** ${e.taskCount}`);
    if (e.taskCount === 0) key.push("(this email asks for nothing, or is our own outgoing mail)");
    key.push("");
  }
  if (e.filing) {
    key.push(`**Filing:** ${e.filing === "new" ? "start a NEW file" : "attach to the EXISTING file"}`);
    key.push("");
  }
  if (e.proposesClosing !== undefined) {
    key.push(`**Propose a closing?** ${e.proposesClosing ? "YES" : "NO — a phantom closing here is a serious error"}`);
    key.push("");
  }
  if (e.duplicateFlagged !== undefined) {
    key.push(`**Flag as possible duplicate?** ${e.duplicateFlagged ? "YES" : "no"}`);
    key.push("");
  }
  if (e.addressOnlyLink !== undefined) {
    key.push(`**Address-only link with a missing-file-number warning?** ${e.addressOnlyLink ? "YES" : "no"}`);
    key.push("");
  }
  key.push("---", "");
});

fs.writeFileSync(path.join(OUT_DIR, "3-answer-key.md"), key.join("\n"));

// --- 1-prompt.md : what to paste first ---------------------------------------

const prompt = `# Paste this FIRST, then paste 2-emails.md

---

You are being tested as an **email intake agent for a title insurance agency**
in Pennsylvania and New Jersey. I am going to give you ${cases.length} real emails from the
agency's mailbox, anonymised. Read this whole brief before you answer anything.

## What the agency does, in one paragraph

A title agency sits in the middle of a real estate closing. Lenders, mortgage
brokers, attorneys, realtors and underwriters all email it about the same
handful of properties, often on the same day, often in long forwarded chains
where the useful sentence is one line at the top and the rest is quoted
history. The agency's job is to know, for every property: when is it closing,
where, who is on it, what has been asked of us, and what are we still waiting
for. Getting that wrong has consequences — a closer sent to the wrong address,
a closing on the board that does not exist, a lender's request nobody answers.

## Your job

For each email, in the order given, produce exactly this:

\`\`\`
EMAIL <n> — <id>

FACTS
  <TYPE>: <value>          one line per fact, or "none"

TASKS
  <a short title for each thing the agency must now do>, or "none"

FILING
  NEW FILE  |  EXISTING FILE (<which earlier email's deal>)

CLOSING
  PROPOSE  <date/time/place>   |   DO NOT PROPOSE

NOTES
  <anything you were unsure about and why>
\`\`\`

### The only fact types that count

\`PROPERTY_ADDRESS\`, \`BUYER_NAME\`, \`SELLER_NAME\`, \`CLOSING_DATE\`,
\`CLOSING_TIME\`, \`CLOSING_LOCATION\`, \`FILE_NUMBER\`, \`LOAN_NUMBER\`,
\`MILESTONE\`.

Do not invent other types. Do not report a lender's name, an attorney's name or
a deadline as a fact — the system that consumes your output does not store
them, so they are noise.

## The rules you are being judged against

**1. Never invent a value.** Record only what the email actually says. If an
email says "Thursday at 10", the closing time is "Thursday at 10" — not
"10:00 AM". Adding the AM is inventing evidence.

**2. Most clock times in these emails are not closing times.** They will be
\`Sent:\` timestamps on quoted replies, a sender's advertised office hours
("I can be reached 9 a.m. to 5 p.m."), a lender's funding cutoff ("received
after 3:30 PM CST"), or a corrections deadline. Assume a time is NOT the
closing time unless the email says it is.

**3. Most addresses in these emails are not the property.** They will be
signature blocks, a lender's mailing address for documents, a shipping address,
or the address of a judgment debtor who has nothing to do with the deal.

**4. A date is often a deadline, not a settlement.** Lien filing dates, tax
sale dates, corrections deadlines, a searcher's estimated completion date.

**5. Do not propose a closing unless one is genuinely confirmed.** Several of
these emails discuss a closing that is explicitly not scheduled — "this loan is
not yet in closing", "signing date and time — we currently do not have this
set". A closing on the board that does not exist is one of the worst errors
possible here.

**6. One checklist is one task.** When one party sends a list of requirements,
conditions or documents for a single purpose — a lender's eight-bullet closing
checklist — that is ONE task naming the list, not eight tasks. Genuinely
separate asks ("send the CPL" *and* "confirm the payoff was ordered") still
split into two.

**7. Our own outgoing mail raises no tasks.** If \`Direction: OUTGOING\`, the
agency sent it. Look for evidence that something was completed, not for
requests to answer. Task count is zero.

**8. Filing is the highest-stakes decision.** Attach an email to an existing
deal only when a strong identifier agrees — a file number, a loan number, or
the property address. A shared surname or a shared town is not enough; the
same property legitimately has different transactions over the years. When you
are unsure, say so in NOTES rather than guessing.

## How to behave

- Work through them in order. Later emails may belong to files earlier ones opened.
- Where you are uncertain, **say so in NOTES**. An honest "I could not tell
  whether this time was the closing or the sender's office hours" is worth more
  than a confident wrong answer, and is scored as such.
- Do not ask me questions before starting. Produce the output for all ${cases.length} emails.
- Do not summarise or editorialise. The blocks above, nothing else.

When you are ready, I will paste the emails.
`;

fs.writeFileSync(path.join(OUT_DIR, "1-prompt.md"), prompt);

// --- 4-grader-prompt.md : what to paste into the SECOND chat -----------------

const grader = `# Paste this into a SECOND, FRESH chat

Then paste the agent's answers, then paste 3-answer-key.md.

It must be a fresh chat. If you grade in the same conversation the agent
answered in, it is marking its own homework and will find itself agreeable.

---

You are grading an AI agent that was asked to read ${cases.length} emails from a title
insurance agency and extract structured facts, tasks and filing decisions.

I will give you two things: the agent's answers, and the answer key a human
wrote. Score the agent against the key.

## How to score

An email is **fully correct** only if every one of these holds:

- every fact the key requires was extracted (partial-text match is fine —
  "214 Delmar" satisfies "214 Delmar Ave., Jersey City NJ")
- nothing in the key's "must NOT say" list appears
- every required task is present
- the exact task count matches, where the key states one
- the filing decision matches
- the propose-a-closing decision matches

No partial credit per email. Partial credit hides real problems — an email
where the address is right and the closing date is invented is not "80% good",
it is an email that would put a wrong appointment on a settlement board.

## What to give me

**1. A table**, one row per email: id, PASS or FAIL, and if failed, the
shortest possible description of what went wrong.

**2. The score**: "N of ${cases.length} fully correct."

**3. Failures grouped by cause, not by email.** This is the most useful part.
If four emails failed because a \`Sent:\` timestamp was recorded as the closing
time, that is one problem with four symptoms, and saying so is far more
actionable than four separate bug reports. Rank the groups by how many emails
each affects.

**4. The dangerous ones, called out separately.** Two failure types matter more
than the rest and should never be buried in a list:
   - **Invented facts** — the agent stated something the email does not say.
   - **Wrong filing** — an email attached to the wrong property, or a deal
     split across two files.
   Missing something is recoverable. Inventing something, or filing it under
   someone else's property, is not.

**5. Where the agent said it was unsure** — did its uncertainty land on the
things it actually got wrong? An agent that flags its own errors is far more
useful than one that is confidently wrong at the same accuracy.

Do not be generous. This is a system that will be trusted with real closings.
`;

fs.writeFileSync(path.join(OUT_DIR, "4-grader-prompt.md"), grader);

// --- report ------------------------------------------------------------------

const withPrivate = cases.filter((c) => !publicOnly).length;
console.log("");
console.log(`  Exported ${cases.length} case(s) to evals/export/`);
console.log("");
console.log("    1-prompt.md       paste FIRST into the agent being tested");
console.log("    2-emails.md       paste SECOND — no answers in this file");
console.log("    3-answer-key.md   DO NOT paste into that agent; use a second chat");
console.log("");
if (!publicOnly && withPrivate > 0) {
  console.log("  NOTE: this includes your private cases — real (anonymised) client");
  console.log("  email. Run with --public-only to export just the four made-up ones.");
  console.log("");
}
console.log("  evals/export/ is gitignored, so none of this reaches GitHub.");
console.log("");
