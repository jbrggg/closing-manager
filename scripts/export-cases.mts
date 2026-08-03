/**
 * EXPORT THE EVAL CASES AS A TEST PACK FOR ANOTHER AI CHAT
 *
 *   npm run export-cases                  one file, paste into an ongoing chat
 *   npm run export-cases -- --max 8       fewer emails, for a tight context window
 *   npm run export-cases -- --public-only only the four made-up cases
 *   npm run export-cases -- --blind       split into test paper + held-back key
 *
 * DEFAULT MODE (one file) is for a chat where an email intake agent is being
 * BUILT. There, the expectations are not an answer key to hide — they are the
 * specification. A builder needs to know what "correct" means.
 *
 * --blind is for the other job: pointing a finished agent at the corpus to
 * measure it. Then the expectations must be held back, because a case file
 * with its `expect` block inline hands the test-taker the marking scheme.
 */
import fs from "node:fs";
import path from "node:path";
import type { EvalCase } from "./eval-types.mts";

const ROOT = path.resolve(import.meta.dirname, "..");
const CASES_DIR = path.join(ROOT, "evals", "cases");
const OUT_DIR = path.join(ROOT, "evals", "export");

const flag = (n: string) => process.argv.includes(`--${n}`);
const option = (n: string, d: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};

const publicOnly = flag("public-only");
const blind = flag("blind");
const max = Number(option("max", "0")) || 0;

function findCaseFiles(dir: string): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (publicOnly && entry.name === "private") return [];
        return findCaseFiles(full);
      }
      return entry.name.endsWith(".json") ? [full] : [];
    });
}

let cases: EvalCase[] = findCaseFiles(CASES_DIR).flatMap((file) => {
  const text = fs.readFileSync(file, "utf-8");
  if (!text.trim()) return [];
  const raw = JSON.parse(text);
  return Array.isArray(raw) ? raw : [raw];
});

if (cases.length === 0) {
  console.error("No cases found.");
  process.exit(2);
}

// Trim from the end, but never orphan a grouped case from the one that opened
// its file — a lone second-email-of-a-deal is untestable for filing.
if (max > 0 && cases.length > max) {
  const kept = cases.slice(0, max);
  const groups = new Set(kept.map((c) => c.group).filter(Boolean));
  cases = cases.filter((c, i) => i < max || (c.group && groups.has(c.group)));
}

fs.mkdirSync(OUT_DIR, { recursive: true });

// --- the shared pieces -------------------------------------------------------

const N = cases.length;

const CONTEXT = `## Part 2 — What you are reading, and what makes it hard

A title agency sits in the middle of a real estate closing. Lenders, mortgage
brokers, attorneys, realtors, underwriters and the agency's own staff all email
about the same handful of properties, often on the same day. The agency has to
know, for every property: **when is it closing, where, who is on it, what has
been asked of us, and what are we still waiting for.**

Getting it wrong has physical consequences — a closer driven to the wrong
address, a closing sitting on the board that does not exist, a lender's request
nobody answers until it holds up funding.

These ${N} emails are real, anonymised, from that mailbox. Every rule below comes
from an actual failure on this corpus, not from theory.

### The nine fact types that matter

\`PROPERTY_ADDRESS\` · \`BUYER_NAME\` · \`SELLER_NAME\` · \`CLOSING_DATE\` ·
\`CLOSING_TIME\` · \`CLOSING_LOCATION\` · \`FILE_NUMBER\` · \`LOAN_NUMBER\` ·
\`MILESTONE\`

Lender names, attorney names and deadlines are recognisable but are **not**
stored downstream — extracting them is noise, not signal.

### The eight rules, each earned the hard way

**1. Never invent a value.** If an email says "Thursday at 10", the closing
time is "Thursday at 10" — not "10:00 AM". Adding the AM is fabricating
evidence. A model did exactly this on one run in three.

**2. Most clock times here are NOT the closing time.** They are \`Sent:\`
timestamps on quoted replies, a sender's advertised office hours ("I can be
reached 9 a.m. to 5 p.m."), a lender's funding cutoff ("received after 3:30 PM
CST"), or a corrections deadline. In this corpus that single mistake accounts
for more failures than anything else. Assume a time is not the closing time
unless the email says so.

**3. Most addresses here are NOT the property.** Signature blocks, a lender's
document mailing address, a shipping address, the home address of a judgment
debtor with no connection to the deal.

**4. Many dates are deadlines, not settlements.** Lien filing dates, tax sale
dates, a corrections due date, a searcher's estimated completion date, the
date a wire moved.

**5. Do not propose a closing unless one is genuinely confirmed.** Several of
these emails discuss a closing that explicitly is not scheduled — *"this loan
is not yet in closing"*, *"signing date and time — we currently do not have
this set"*. A phantom closing on a settlement board is among the worst
outcomes possible.

**6. One checklist is one task.** When one party sends a list of requirements
for a single purpose — a lender's eight-bullet closing checklist — that is ONE
task naming the list, not eight. Genuinely separate asks ("send the CPL" *and*
"confirm the payoff was ordered") still split into two. This is a standing
office rule, not a preference.

**7. Our own outgoing mail raises no tasks.** When direction is OUTGOING the
agency sent it: look for evidence something was completed, not for requests to
answer. Task count is zero.

**8. Filing is the highest-stakes decision.** Attach to an existing deal only
when a strong identifier agrees — file number, loan number, or property
address. A shared surname or shared town is never enough; the same property
legitimately carries different transactions over the years. Two emails about
one deal landing on two files is bad; one email landing on someone else's
property is worse.

### About forwarded mail

Many of these are forwards, and a forward lies about who sent it. The envelope
sender is whoever pressed Forward. The real sender, recipients and date are in
the header block inside the body, and **the quoted portion IS the message** —
the one line on top is just a covering note. Direction is stated for you on
each email below; use it rather than inferring it from the envelope.

## Part 3 — The output to produce

For each email, in order, exactly this and nothing else:

\`\`\`
EMAIL <n> — <id>

FACTS
  <TYPE>: <value>              one per line, or "none"

TASKS
  <short title of each thing the agency must now do>, or "none"

FILING
  NEW FILE   |   EXISTING FILE (<which earlier email's deal>)

CLOSING
  PROPOSE <date / time / place>   |   DO NOT PROPOSE

UNSURE
  <anything you could not decide, and why> — or "nothing"
\`\`\`

The UNSURE line is scored. An honest *"I could not tell whether 3:30 PM was the
closing or the funding cutoff"* is worth more than a confident wrong answer,
and an agent whose uncertainty lands on its actual errors is far more useful
than one that is confidently wrong at the same accuracy.
`;

function emailsSection(): string {
  const out: string[] = [
    `## Part 4 — The ${N} emails`,
    "",
    "Process them in the order given. Emails sharing a **Deal group** belong to",
    "the same transaction: a later one is testing whether you file it onto the",
    "file an earlier one opened.",
    "",
    "---",
    "",
  ];

  cases.forEach((c, i) => {
    const dir = c.direction ?? "INCOMING";
    out.push(`### Email ${i + 1} of ${N} — \`${c.id}\``);
    out.push("");
    out.push(
      `**${dir}** ${dir === "INCOMING" ? "(sent TO the agency)" : "(sent BY the agency)"} · ` +
        `**From:** ${c.from}${c.group ? ` · **Deal group:** \`${c.group}\`` : ""}`
    );
    out.push(`**Subject:** ${c.subject}`);
    out.push("");
    out.push("```text");
    out.push(c.body);
    out.push("```");
    out.push("");
    out.push("---");
    out.push("");
  });

  return out.join("\n");
}

function criteriaSection(heading: string, preamble: string[]): string {
  const out: string[] = [heading, "", ...preamble, "", "---", ""];

  cases.forEach((c, i) => {
    const e = c.expect ?? {};
    out.push(`### Email ${i + 1} — \`${c.id}\``);
    out.push("");
    if (c.note) out.push(`_Why this one is here: ${c.note}_`, "");

    if (e.facts?.length) {
      out.push("**Must extract**");
      for (const f of e.facts) out.push(`- \`${f.type}\` containing "${f.contains}"${f.why ? ` — ${f.why}` : ""}`);
      out.push("");
    }
    if (e.mustNotSay?.length) {
      out.push("**Must NOT say — these are the traps**");
      for (const g of e.mustNotSay) out.push(`- \`${g.type}\` must not contain "${g.text}" — ${g.why ?? ""}`);
      out.push("");
    }
    if (e.tasks?.length) {
      out.push("**Must raise a task about**");
      for (const t of e.tasks) out.push(`- "${t.contains}"${t.why ? ` — ${t.why}` : ""}`);
      out.push("");
    }
    if (typeof e.taskCount === "number") {
      out.push(
        `**Exact task count:** ${e.taskCount}` +
          (e.taskCount === 0 ? " — this email asks for nothing, or the agency sent it" : "")
      );
      out.push("");
    }
    if (e.filing) {
      out.push(`**Filing:** ${e.filing === "new" ? "start a NEW file" : "attach to the EXISTING file"}`);
      out.push("");
    }
    if (e.proposesClosing !== undefined) {
      out.push(
        `**Propose a closing?** ${e.proposesClosing ? "YES" : "NO — proposing one here is a serious error"}`
      );
      out.push("");
    }
    if (e.duplicateFlagged !== undefined) {
      out.push(`**Flag as a possible duplicate?** ${e.duplicateFlagged ? "YES" : "no"}`);
      out.push("");
    }
    if (e.addressOnlyLink !== undefined) {
      out.push(
        `**Link on the address alone, with a "file number missing" warning?** ${e.addressOnlyLink ? "YES" : "no"}`
      );
      out.push("");
    }
    out.push("---", "");
  });

  return out.join("\n");
}

const REPORT = `## Part 6 — What to report back

1. **One line per email:** \`<id> — PASS\` or \`<id> — FAIL: <shortest possible reason>\`
2. **The score:** "N of ${N} fully correct." An email counts as correct only if
   every criterion for it holds. No partial credit — an email where the address
   is right and the closing time is invented is not 80% good, it is an email
   that would put a wrong appointment on a settlement board.
3. **Failures grouped by cause, not by email.** If four emails failed because a
   \`Sent:\` timestamp became the closing time, that is one problem with four
   symptoms. Rank the groups by how many emails each affects. This is the most
   useful thing you can give me.
4. **Called out separately — invented facts and wrong filing.** Missing
   something is recoverable. Inventing something, or attaching an email to the
   wrong property, is not. Never bury these in a list.
5. **Then, and only then, what you would change** in the agent's prompt or
   logic to fix the largest group — one change, the highest-leverage one, not a
   list of ten.
`;

// --- write -------------------------------------------------------------------

const written: string[] = [];

if (!blind) {
  const pack = [
    "# Test pack — real title-agency email",
    "",
    `${N} real (anonymised) emails from a title insurance agency's mailbox, with`,
    "the acceptance criteria a human wrote for each one.",
    "",
    "## Part 1 — What I want you to do",
    "",
    "We have been building an email intake agent in this conversation. This is",
    "the first real material to test it against.",
    "",
    "In order:",
    "",
    "1. Read Part 2 so you know the domain and the failure modes.",
    "2. Run your agent's logic over the emails in Part 4, producing the output",
    "   format in Part 3 for each one.",
    "3. **Write your answers for all " + N + " before you read Part 5.** Part 5 is the",
    "   acceptance criteria. Reading it first turns this into a copying exercise",
    "   and tells us nothing about whether the agent works.",
    "4. Then read Part 5, score yourself, and report as Part 6 asks.",
    "",
    "If your answer would be too long, do them in batches of 8 and tell me you",
    "are pausing — do not skip any or summarise.",
    "",
    "---",
    "",
    CONTEXT,
    "",
    "---",
    "",
    emailsSection(),
    criteriaSection(
      "## Part 5 — Acceptance criteria",
      [
        "**Do not read this until your answers for all " + N + " emails are written.**",
        "",
        "Every line here is a judgement a human made about a real email. Where a",
        "case says a value must NOT appear, it is guarding against a mistake this",
        "system actually made at least once.",
      ]
    ),
    REPORT,
  ].join("\n");

  fs.writeFileSync(path.join(OUT_DIR, "agent-test-pack.md"), pack);
  written.push("agent-test-pack.md");
} else {
  fs.writeFileSync(
    path.join(OUT_DIR, "1-brief-and-emails.md"),
    ["# Test pack (blind)", "", "## Part 1 — What to do", "",
      `Read Part 2, then produce the Part 3 output for each of the ${N} emails in`,
      "Part 3. You will be scored against criteria you are not being shown.",
      "", "---", "", CONTEXT, "", "---", "", emailsSection()].join("\n")
  );
  fs.writeFileSync(
    path.join(OUT_DIR, "2-criteria-and-scoring.md"),
    [criteriaSection("# Acceptance criteria — held back", [
      "**Do not paste this into the agent being tested.** Use a separate, fresh",
      "chat: paste this, then the agent's answers, then ask it to score using the",
      "rules below.",
    ]), REPORT].join("\n")
  );
  written.push("1-brief-and-emails.md", "2-criteria-and-scoring.md");
}

// --- report ------------------------------------------------------------------

const bytes = written.reduce((n, f) => n + fs.statSync(path.join(OUT_DIR, f)).size, 0);

console.log("");
console.log(`  ${N} email(s) exported to evals/export/`);
console.log("");
for (const f of written) {
  const kb = (fs.statSync(path.join(OUT_DIR, f)).size / 1024).toFixed(0);
  console.log(`    ${f}  (${kb} KB)`);
}
console.log("");
if (!blind) {
  console.log("  Paste agent-test-pack.md into the chat where the agent is being built.");
  console.log("  If the box rejects it for size, attach it as a file instead.");
} else {
  console.log("  Blind mode: give the agent file 1 only. Score in a separate chat with file 2.");
}
console.log("");
console.log(`  Roughly ${Math.round(bytes / 4 / 1000)}k tokens. Use --max 8 for a smaller first pass.`);
if (!publicOnly) {
  console.log("  Includes your private cases — real anonymised client email.");
  console.log("  Use --public-only for just the four made-up ones.");
}
console.log("");
