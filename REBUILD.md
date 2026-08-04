# Rebuilding this application from nothing

**Purpose:** everything needed to reconstruct this app, from an empty folder to
exactly where it stands today, in order, with the reasoning behind each
decision.

**Written:** 2026-08-03 · **Reconstructs:** the state at commit tagged in
`ROADMAP.md`, 293 passing tests.

**Vendor-neutral by design.** No AI company, assistant, or model is named
anywhere in this document. The application talks to a *hosted model provider*
through a swappable interface; which one is a configuration value. Anyone
following this guide can point it at any provider with a chat-completions or
tool-use API.

---

## Who this is for

Three readers, and it's written to serve all three:

1. **A person rebuilding this from scratch** because the folder was lost, or
   they want it on another machine.
2. **An AI assistant asked to recreate or extend it** — every constraint that
   would otherwise have to be rediscovered by breaking something is written
   down here.
3. **The owner**, who is not a developer, checking that what exists matches what
   was intended.

Where those needs conflict, the third wins. Nothing here assumes you can read
code to check the claims.

---

# Part 1 — What this application is

An AI-assisted closing manager and task manager for a small title agency
operating in Pennsylvania and New Jersey.

It reads email, extracts facts about real-estate closings, proposes closings and
tasks, and routes **every** proposal to a human review queue.

## The one architectural claim that matters

**This application is the system of record.** Not a calendar service, not a
title-production platform. External calendars are an optional future adapter,
never the primary write target.

Everything else in this document follows from that. If closings live somewhere
else, this is a notification tool. If they live here, it's the place the office
works from.

## What it is not

- Not a chatbot with a database attached. The AI has no free database access; it
  calls controlled backend functions that validate everything.
- Not automated. Every AI proposal waits for a human. This is deliberate and
  load-bearing — see Invariant 1.
- Not production-ready. It has never run against a live mailbox.

---

# Part 2 — Prerequisites

| Requirement | Version | Why exactly this |
|---|---|---|
| **Node.js** | **22.5 or newer** | Uses the built-in `node:sqlite` module, which does not exist before 22.5. Verified on 24.18.0. |
| npm | ships with Node | — |
| Git | any recent | — |
| A code editor | any | Optional for the owner |

**No database server to install.** No Docker. No cloud account. The whole thing
runs from one folder.

Check your version:

```bash
node --version      # must print v22.5.0 or higher
```

---

# Part 3 — The technology, and why each piece

Substitutions are possible, but each of these was chosen for a reason worth
knowing before you swap it.

| Layer | Choice | Why |
|---|---|---|
| Framework | **Next.js 16** (App Router) | Server and browser code in one project. Pages read the database directly — no separate API server to run, deploy or keep in sync. |
| Language | **TypeScript** | The AI returns loosely-shaped data. Types are what stop a malformed field reaching the database. |
| Database | **SQLite** via `node:sqlite` | Built into Node. Nothing to install, one file to back up. A real database, not a toy. PostgreSQL is a later migration, not a correction. |
| Database access | **Hand-written SQL** | No ORM. ~20 tables and queries you can read aloud. An ORM would add a large dependency and hide the queries. |
| Styling | **Tailwind CSS 4** | Design tokens live in one CSS file; every size derives from a single `font-size`. |
| Validation | **Zod** | Runtime checking at the boundary where AI output enters the system. |
| Tests | **Vitest** | Fast, no configuration. |
| Scripts | **tsx** | Runs TypeScript directly. |

## Deliberately absent

- **No ORM.** See above.
- **No Redis, no job queue.** Background work is in-process. A queue matters at
  volume this app does not have.
- **No component library.** The interface is dense and operational; generic
  components fought it.
- **No Prisma.** A schema file is kept as documentation (`prisma/schema.prisma`)
  and describes every table in PostgreSQL terms. Prisma itself was **removed**:
  182 MB of an 874 MB install, and nothing imported it. Reinstall when starting
  the PostgreSQL migration. **Do not `import` from that file before then.**

---

# Part 4 — Build order

Build in this order. Each stage runs and can be verified before the next.

## Stage 1 — Project skeleton

```bash
npx create-next-app@latest closing-manager --typescript --tailwind --app --eslint
cd closing-manager
npm install zod
npm install -D vitest tsx @vitejs/plugin-react
```

Create `.npmrc` in the project root with:

```
include=dev
```

**Why this file is not optional.** If `NODE_ENV=production` is set anywhere on
the machine, `npm ci` silently installs only runtime packages — no test runner,
no type checker, no linter. This actually happened: 26 packages installed
instead of 406, and the failure looked like a broken project rather than a
config leak. `.npmrc` pins the behaviour into the repository so it cannot depend
on one machine's environment.

## Stage 2 — The database

Create `db/schema.sql`. Around 20 tables. The core group:

**Organisation and people:** `Organization`, `User`, `Office`, `Session`

**Email:** `EmailAccount`, `EmailThread`, `EmailMessage`, `EmailAttachment`

**The work:** `Property`, `TransactionRecord`, `TransactionParticipant`,
`ClosingEvent`, `Task`

**Evidence and AI:** `ExtractedFact`, `AIProposal`, `ReviewItem`, `AuditEvent`

**Configuration:** `AutomationRule`, `OfficeSetting`, `TransactionMerge`

Then `src/lib/db.ts` — the only file that talks to SQLite. It must provide:

- `get<T>(sql, params)` — one row or undefined
- `all<T>(sql, params)` — every row
- `run(sql, params)` — writes
- `closeDb()`, `clearAllTables()`, `resetDb()`

**Three details that will otherwise cost you a day each:**

1. **`node:sqlite` returns null-prototype row objects.** They must be spread
   into plain objects (`{...row}`) before crossing from server to browser code,
   or the framework throws. `db.ts` already does this. Don't undo it.

2. **`resetDb()` must close the database before deleting the file.** Deleting an
   open file succeeds on Linux and throws `EBUSY` on Windows. This bug hid
   behind a bare `catch` for weeks while reporting all tests green on Linux and
   failing on Windows. Order: `closeDb()` → unlink → fall back to
   `clearAllTables()` if the unlink fails. Distinguish "file not there"
   (`ENOENT`, fine) from "file is locked" (a real problem).

3. **Additive migrations.** Keep an `ADDITIVE_COLUMNS` list applied at startup,
   so adding a column doesn't require rebuilding anyone's database.

## Stage 3 — Authentication

- Passwords hashed with **scrypt**. At N=32768 Node throws a memory error unless
  you pass an explicit `maxmem`. Not optional.
- Sessions are **opaque tokens stored server-side**, not signed cookies. A
  session can then be revoked instantly.
- Role-based access control, checked in a route guard, not in each page.

**Attribution rule:** the identity of whoever approves something comes **from
the session**, never from a request body. A client that can name its own
approver has no audit trail. There is a test asserting this.

## Stage 4 — The AI provider interface

This is the pattern the whole codebase leans on, used three times (AI, email,
document storage).

Define an interface first — `src/lib/ai/provider.ts`:

```ts
export interface AIProvider {
  extractFacts(message, context): Promise<ExtractedFactCandidate[]>;
  detectRequests(message, context): Promise<RequestCandidate[]>;
  detectCompletionSignal(message, context): Promise<CompletionSignal | null>;
}
```

Then **two** implementations:

- `engine.ts` — a rule-based word matcher. Free, deterministic, offline. Not a
  toy: it makes the app demonstrable and every test runnable with no network and
  no spend.
- `llm-provider.ts` — real network calls to a hosted model provider.

And a factory, `index.ts`, reading configuration:

```
AI_PROVIDER=simulated     # the free word matcher (default)
AI_PROVIDER=llm           # the hosted model
AI_API_KEY=...            # required when AI_PROVIDER=llm
AI_MODEL=...              # optional; model names get retired
```

**Four rules for the model-backed provider:**

1. **Force structured output** using the provider's tool-use / function-calling
   mechanism. Do not ask the model to "reply only in JSON" — that fails the day
   it adds a polite sentence in front.
2. **One API call per message, not one per question.** The interface asks three
   questions; asking them separately sends the same email three times and pays
   three times. Make one call, cache the result, have all three methods read the
   cache. **If you add a fourth question, add it to that same call.**
3. **Validate every returned field** against the same enums the rule-based
   engine uses. Invalid entries are dropped with a warning, not thrown — one bad
   extraction must not take down the pipeline.
4. **Never let tests reach the network.** Tests stub `fetch`. Verified by
   running the suite in a no-network sandbox with a real key present.

## Stage 5 — Matching (the delicate part)

`src/lib/ai/match.ts` decides whether an email belongs to an existing file.

Weighted points:

| Evidence | Points |
|---|---|
| File or loan number | +50 |
| Property address | +45 |
| Full party name | +15 |
| Shared office location | +10 |

**Threshold: 60 points.** Below 15, create a new file. Between 15 and 59,
create a new file **and flag a possible duplicate** for a human.

**These numbers were tuned against a real false-merge bug.** A shared surname or
a shared office must never be enough to link two transactions — the same
property genuinely can have a sale and a later refinance. Two files wrongly
merged is far more expensive than two files a human merges by hand.

There are regression tests. If you change the weights, they must still pass.

## Stage 6 — The pipeline

`src/lib/ai/process-email.ts` orchestrates everything. Read this file first if
you're trying to understand the system.

```
email arrives
  → extract facts
  → search the whole mailbox for related messages
  → score candidate transactions
  → match, or create with a duplicate flag
  → persist facts with supersession
  → detect requests → propose tasks
  → create AIProposal + ReviewItem
  → record audit events
```

**Three invariants enforced here:**

- **Never delete a fact.** When information changes, mark the old row
  `SUPERSEDED` and insert a new one. History is evidence.
- **Every fact and proposal links to a source email.** No orphans. Tested.
- **Idempotency.** Re-processing the same message must not create duplicate
  transactions, tasks, closings, review items, or notifications.

## Stage 7 — Approval

`src/lib/services/approval.ts`. Turns an approved proposal into live records,
inside one database transaction, writing an audit event.

**Phase 1 is approval-only.** Automation rules ship with `enabled = 0`. The
engine for later automation is built; every rule is switched off.

## Stage 8 — The interface

Nine screens: dashboard, closing calendar, files list, file detail, tasks,
review queue, email evidence viewer, AI activity log, settings, plus an Email
Test Lab.

**Design rules, all enforced in `globals.css`:**

- **One `font-size` on `<html>` controls the whole app.** 17px. Every other size
  is a multiple. Raise that number and everything grows in proportion.
- **Colour carries meaning, never decoration.** Green confirmed, amber
  unsettled, orange needs-a-decision, red problem.
- **Colour is never the only signal.** Every status chip carries a border and a
  word too.
- **Nothing important is small.** 15px floor.
- **Focus indicators are two-tone** — a dark ring with a light halo — because a
  single ring is invisible on either a white card or a dark sidebar, depending
  which you pick. This was measured at 1.04:1 before it was fixed.
- **Plain English.** The database says `SETTLEMENT_BOARD`; the screen says
  "Closing Calendar".

## Stage 9 — Document storage

Same interface pattern. `DocumentStore` with a local-disk implementation.

- **Files are named by the hash of their contents** (SHA-256). The same
  commitment forwarded five times is stored once, and "is this the same
  document?" becomes a comparison instead of an opinion.
- **Files are not in the database.** They sit in `storage/`. PDFs inside SQLite
  bloat every backup.
- **Write to a temporary name, then rename.** A crash must never leave a
  truncated file sitting at a hash that promises completeness.
- **Reject any key that isn't a 64-character hash**, so a crafted key can't
  escape the storage folder.

## Stage 10 — Testing and verification

```bash
npm run verify        # types + tests + linter, in parallel (~12s)
npm run verify:full   # the above plus a production build
npm run contrast      # colour contrast; exits non-zero on failure
npm run eval          # score the AI against real emails
```

**Test rules learned painfully:**

- **Run on Windows before claiming the suite passes.** Most agent sandboxes are
  Linux. The `resetDb()` bug reported 132/132 green on Linux while failing on
  Windows. Any code that deletes, renames or locks a file is a candidate for the
  same trap.
- **Every test file shares one database.** If a test's expectations depend on an
  empty mailbox, clear the tables in `beforeEach`.
- **Tests never touch the network.**

---

# Part 5 — Configuration

Create `.env.local` in the project root. **It is gitignored and must stay that
way.**

```bash
# Which AI does the reading
AI_PROVIDER=simulated          # free word matcher; no key needed
# AI_PROVIDER=llm              # hosted model — needs the key below
# AI_API_KEY=...
# AI_MODEL=...

# Your own email domains. Anything from these is OUTGOING; everything else
# is INCOMING. Without this, every imported message looks incoming.
ORG_EMAIL_DOMAINS=youragency.com

APP_BASE_URL=http://localhost:3000
```

**A quirk worth knowing:** many remote file bridges and agent tools **refuse to
write files beginning with `.env`**. Someone has to create this by hand. Give
them a script to double-click, not a Save As dialog to navigate.

---

# Part 6 — The ten invariants

Do not break these without explicit human approval. Each cost something to
learn.

1. **Phase 1 is approval-only.** No AI proposal becomes a live record without a
   human decision. Automation rules ship disabled.
2. **Never delete a fact.** Supersede and keep the old row.
3. **Every fact and proposal links to a source email.** Tested.
4. **Matching is deliberately conservative.** A shared surname or office is
   never enough. The 60-point threshold was tuned against a real bug.
5. **Approval attribution comes from the session**, never a request body.
6. **The email adapter is read-only.** Never request send permission. The app
   does not send, delete, or modify mail.
7. **Never commit secrets.** Tokens encrypted at rest; `.env.local` gitignored.
8. **Don't reword the extraction prompt without re-running the scorecard.**
9. **Merging never deletes.** Colliding facts are superseded and moved; the
   losing transaction becomes `MERGED`, not removed, so evidence links still
   resolve. Every merge is reversible.
10. **One checklist is one task.** When one party sends a list of requirements
    for a single purpose, raise ONE task naming the list — not one per bullet.
    Genuinely separate asks still split. Office rule, decided by the owner.

---

# Part 7 — Things that are true and easy to get wrong

**The scorecard is not deterministic.** Three runs of the same two emails
produced three different sets of failures. A single before/after comparison
proves nothing about a prompt change. `npm run tune` runs the set repeatedly and
treats a case as signal only when every run agrees. **Never accept a prompt edit
on the strength of one run.**

**The scorecard grades what the AI *read*, not what got stored.** These differ:
fact persistence deliberately skips a fact the transaction already holds, so a
file number correctly read from the second email of a group is never written
with that email's id. Grading stored rows alone made three cases look like AI
failures when the model had read them perfectly.

**Re-running the same email looks like a failure and isn't.** The
deduplication system correctly skips facts it already knows. Reset between runs.

**Resetting demo data also wipes login sessions.** Any script that resets and
then keeps clicking must sign in again.

**Some sandboxes cannot build or bind a port at all**, and some block outbound
API calls. If the app "can't start" in an agent environment, verify with the
test suite and hand the browser check to a human rather than fighting it.

---

# Part 8 — Verifying your rebuild

```bash
npm install
npm run verify:full
```

Expect: type check clean, **293 tests passing**, linter clean, production build
succeeds.

```bash
npm run contrast
```

Expect: **all 32 pairings pass, 23 clearing AAA.**

```bash
npm run dev
```

Open `http://localhost:3000`, sign in, and walk every screen. Then the real
test — the full loop the whole system exists to perform:

1. Open the **Email Test Lab** and paste in an email.
2. Watch it create a proposal.
3. Open the **review queue** and approve it.
4. See the closing or task appear as a live record.
5. Open the **AI activity log** and find the complete sequence recorded.

If that loop works end to end, the rebuild is correct.
