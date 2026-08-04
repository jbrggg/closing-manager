# Continuing from here

**Companion to `REBUILD.md`.** That document says how the app got to where it
is. This one says what to do next, in what order, and why that order.

**Written:** 2026-08-03. **Vendor-neutral:** no AI company, assistant or model
is named. The app talks to a *hosted model provider* through a swappable
interface.

---

# READ THIS FIRST — the deployment plan, agreed 2026-08-03

The owner has decided to deploy. The step order below (Steps 1–5) is still
correct about *what* the work is, but the agreed sequence is now the stage list
in this section. **Stage 0 is Step 1 under a different name** — the owner agreed
to do the real-email validation first, before spending anything.

## Decisions the owner has made. Do not re-ask these.

| Decision | Answer |
|---|---|
| Database | **Supabase PostgreSQL.** Settled twice — the SQLite-on-a-disk alternative was costed in full on 2026-08-04 and rejected. Do not raise it again. Prisma's connector would not connect; that path is closed. |
| Supabase tier | **Start on the free tier.** Move to Pro ($25/mo) only when one of the triggers below fires. |
| Protection tooling | **Build it anyway**, on Supabase. Backup/restore page, disk & health panel, spreadsheet export. The owner wants to be able to act without waiting for someone technical. |
| Mail validation | **Connect the real mailbox. Do not do the forwarding/.eml export exercise.** Entra admin access became available 2026-08-05. Reasoning below. |
| Connection style | **Supabase's connection pooler** (port 6543) for the app; direct (5432) only for migrations and scripts. |
| Host | **Render.** ~$7/mo always-on web service + ~$1/mo cron job. Chosen over Vercel because it runs a normal long-lived server — no function time limit on a mail sync that reads fifty messages through an AI — and over Railway for more predictable billing. |
| Supabase tier | Free tier through the migration and testing. **Pro ($25/mo) from the day it goes live**, because the free tier pauses after seven days idle and its backups are not good enough for a system of record. Both problems arrive on the same day. |
| Total hosting | **~$33/month**, plus usage-based AI spend (to be measured in Stage 0). |
| Domain | **Free `*.onrender.com` address first**, to confirm the site works. Then point `aglobaltitleagency.com` at it — about ten minutes, and it disturbs nothing. |
| Sequencing | Validate the AI on real email **first**. See below. |

`prisma.compute.json` **is already gone** — deleted in commit `bb53dfa`. If a
future session is told to delete it, the job is done; say so and move on.

## When the free Supabase tier stops being enough

The owner asked to start free and upgrade only when needed. "Needed" means any
one of these, and a session that spots one should say so plainly:

- **The database passes about 400 MB** (the free ceiling is 500 MB). Real email
  bodies plus text extracted from PDFs are what fill it. Check it before Stage 5.
- **The project pauses and somebody can't work.** Free projects pause after
  seven days idle. Daily mail sync should prevent that — but a quiet week over
  a holiday would not.
- **The day it becomes the live system of record.** Free-tier backups are not
  adequate for closings data. This is Stage 5, and it is the trigger that will
  almost certainly fire first.

Nothing before Stage 5 needs the paid tier. The migration and all testing run
free.

## What an agent can and cannot do with Supabase

**There is no Supabase connector available in this environment.** I checked.
That means:

- **Can do:** everything that runs over a connection string. Once the owner puts
  the pooler URL in `.env.local`, an agent can create tables, run the migration,
  copy the data across, verify row counts, and query it. That covers all of
  Stages 3 and 4.
- **Cannot do:** anything that is a click in the Supabase dashboard — restoring
  the paused project, changing the tier, creating a storage bucket, reading the
  connection string. Those need the owner, and they should be described as exact
  clicks, never as "go and configure it".

## Why the mailbox is being connected instead of exporting .eml files

Recorded so it isn't re-argued. The two approaches test **different things**:

- Exporting `.eml` files tests **whether the AI reads mail correctly**. It does
  not touch the Outlook adapter at all.
- Connecting the mailbox tests **the adapter — the single largest untested thing
  in this project — and gives real mail for the AI at the same time.**

With admin access available, the second is strictly better: one exercise instead
of two, correct incoming/outgoing direction natively (no forwarding wrapper to
unwrap), a far larger sample, and 45 minutes of manual exporting saved.

The `.eml` import path stays as the fallback if the connection can't be made,
and as the way to build scorecard cases later. It is not wasted.

**The guardrail that makes this safe:** first contact is
`npm run sync -- --dry-run`, which fetches and stores mail but runs no AI and
costs nothing. Then `npm run process -- --limit 10` reads a small batch so the
first real bill is ten messages, not four hundred. See `CONNECT-MAILBOX.md`.

## The sequencing argument, recorded so it isn't re-litigated

The owner asked whether deploying before validating was a mistake. The answer
given, and accepted:

Deployment is **not** a prerequisite for connecting a real mailbox. Microsoft
allows `http://localhost` redirect URIs — this repo's own README already tells
you to register one — so a live mailbox can be connected and read from the
owner's laptop today. Scheduled sync without the laptop does need a server, but
Windows Task Scheduler covers the evaluation period.

The real argument for validating first is that it gives a **clean** answer. With
348 green tests on an unchanged database, a bad result means the AI is wrong.
After the database engine has been swapped, the files moved to the cloud, and
the app put on a server, a bad result is ambiguous. Half a day now buys an
unambiguous number.

## The honest estimate the earlier version of this document got wrong

Step 5a below says the PostgreSQL migration is "half a day, most of it verifying
nothing broke." **That is wrong and a session that believes it will run out of
room mid-change.** The seam claim is right — `getDb()` is used nowhere outside
`src/lib/db.ts` — but:

- SQLite in Node is **synchronous**; every Postgres driver is **asynchronous**.
  Roughly 200 call sites across 47 files have to learn to wait, and so does
  everything calling them. Forgetting to `await` a *write* is not a type error;
  it is a silent ordering bug. Mitigate with type-aware
  `no-floating-promises` linting, not care.
- Postgres folds unquoted identifiers to lowercase, so `organizationId` becomes
  `organizationid` and every screen reading `organizationId` gets nothing. The
  fix belongs inside the seam file (map row keys back on the way out); it does
  not require touching ~200 queries.
- The 348 tests currently run with **zero setup**. Naive migration means every
  test needs a database server on Windows and in CI. Use an embedded Postgres
  that runs in-process instead, so that property survives.

Budget **three or four working sessions for the database alone**, split into two
separate commits: async-with-SQLite first (provable — tests must stay green with
nothing else changed), then swap the engine.

## Stage list and status

| Stage | What | Status |
|---|---|---|
| **0** | **Connect the real mailbox** and judge the AI on what it pulls in | **Next — owner has Entra admin access. Follow `CONNECT-MAILBOX.md`.** |
| 1 | Housekeeping; stale docs; Postgres test harness (PGlite) | Not started |
| 2 | Make the data layer async, **keeping SQLite** | Not started |
| 3 | Swap SQLite for Supabase Postgres behind the same seam | Not started |
| 4 | Move documents to Supabase Storage | Not started |
| 4b | **Protection tooling** — backup/restore page, health panel, spreadsheet export | Not started |
| 5 | Deploy to Render over HTTPS — **money starts here; Supabase goes Pro here** | Not started |
| 6 | Harden: rotate demo password, real accounts, scheduled sync, backups **with a restore watched working** | Not started |
| 7 | Re-point the mailbox connection at the deployed address | Not started |

Stage 0 moved from "export files" to "connect the mailbox" on 2026-08-04.
Stage 7 shrank accordingly — the Entra registration happens in Stage 0, so all
that remains at the end is re-running the consent flow against the deployed URL.
**That works without another admin visit only if all the redirect URIs were
registered up front** — which is why `CONNECT-MAILBOX.md` insists on it.

Every stage ends with `npm run verify:full` + `npm run contrast`, then a commit.
Nothing proceeds on a red build.

## Stage 0 — what was built, and what is outstanding

**Done (commit `b07a8ed`), verified on Windows:**

- `/inbox/*` is now **gitignored**. This was a real exposure: every commit
  auto-pushes to GitHub via `.githooks/post-commit`, so a folder of exported
  client mail would have been published by the next commit anyone made. Verified
  with `git check-ignore` — a `.eml` is ignored, `inbox/README.md` is not.
- `npm run setup` now **asks for `ORG_EMAIL_DOMAINS`**. It was documented in
  three places and asked for in none. Unset, every message files as INCOMING and
  the app hunts its own sent mail for requests — which looks like an AI accuracy
  problem rather than a one-line setting.
- `import.cmd` and `start-app.cmd` — the no-terminal route. `import.cmd` stops
  with instructions when the inbox is empty instead of a stack trace.
- `inbox/README.md` — how to export from Outlook on the web, new Outlook and
  Gmail; what mix of messages to collect; which surprising outputs are not bugs.
- Import smoke-tested end to end on a throwaway database with the offline
  matcher: one message in, facts extracted, two proposals correctly parked in
  the review queue. **No pipeline, prompt, matching or automation change.**

**Also done (commit pending), for the mailbox route:**

- `CONNECT-MAILBOX.md` — the whole Entra registration as exact clicks, the four
  redirect URIs to register while admin access is available, the read-only
  permission set, the safe first-contact sequence, and the failure table.
- `npm run process` (`scripts/process-mail.mts`) — reads stored mail through the
  AI **in a batch you choose**, default 10. This is the missing half of
  `sync --dry-run`: fetch for free, then read a small batch so the first real
  bill is ten messages rather than four hundred. `--dry-run`, `--limit N`,
  `--all`, `--retry-failed`. Verified on a throwaway database: dry-run lists
  without spending, a real run processes, and re-running is a clean no-op.

**Outstanding — the owner's part. The next session should ask about this first:**

1. Work through `CONNECT-MAILBOX.md` — Entra registration, `setup.cmd`,
   `npm run preflight`, connect from the Settings page.
2. `npm run sync -- --dry-run` — proves the adapter against a live tenant for
   the first time ever, costs nothing.
3. `npm run process -- --limit 10` — then read the review queue and judge it.
   **The formal bar is 15 of 20 fully correct.**
4. **Record what ten messages cost** from the model provider's usage page.
   Multiply by daily volume. Nobody has been able to estimate the monthly AI
   bill yet, and this is the step that produces the number.

Also watch the `scanned/no text` count — see Step 1 below for why that number is
the only evidence that will ever exist about whether OCR is worth building.

If the connection cannot be made, fall back to the `.eml` import path
(`inbox/README.md` + `import.cmd`), which is built and smoke-tested.

## What is NOT being done, and must not start

Enabling any automation rule. Requesting send permission from any mail provider.
Touching the weights in `match.ts`. Rewording the extraction prompt. Redacting
structured fact values. Rebuilding the UI, the pipeline or the AI provider.
Building the Gmail adapter, transaction split, or disbursements. Creating
accounts, clicking OAuth consent, or making payments on the owner's behalf.

---

## Where things actually stand

**Working and verified:**

- All nine screens, plus the Email Test Lab
- Authentication: hashed passwords, server-side sessions, role-based access
- The full pipeline: extraction → mailbox search → weighted matching →
  proposals → review queue → approval → live records → audit trail
- Model-backed AI provider, run successfully against a live API
- **293 automated tests**, passing on Windows
- Accuracy scorecard — runs the real pipeline headless, no server, no browser
- Transaction merge, with preview and reverse
- Document storage, content-addressed
- Real-email import from exported `.eml` / `.mbox` files
- WCAG 2.1 AA audit — 6 issues found, 6 fixed (`ACCESSIBILITY.md`)
- Automation engine for later phases — **built, every rule disabled**

**Built but never run against anything real:**

- The Outlook / enterprise-mail adapter. Implemented in full. **It has never
  touched a live mailbox.** Say so every time it comes up.

**Not built:**

- Consumer-mail adapter (scaffold only; the import path covers it for testing)
- PostgreSQL migration (runs on SQLite)
- Transaction *split* (merge is built, and reversing a merge covers the common
  case)
- Outgoing requests raise no task to chase
- Disbursements / wire matching
- Hosting

---

# The order, and why it is this order

The temptation is to build features. **Resist it.** The next two steps are not
construction, and everything downstream is wasted effort if they fail.

---

## Step 1 — Prove the AI reads your email correctly

**This is where you are. Nothing else should start before it.** (This is
"Stage 0" in the deployment plan above. The tooling described below now exists
as `import.cmd`; steps 4 and 5 are handled by `setup.cmd` and that script.)

**Why first:** everything after this costs money, time, or both. Find out
whether the core works before paying to run it. If the AI misreads your mail,
no amount of hosting fixes that.

**What to do:**

1. Forward 15–25 real work emails to a test mailbox. Mix them: closings,
   reschedules, document requests, an ambiguous one, one with an attachment.
2. Export them (`.eml` per message, or one `.mbox` for the lot).
3. Drop them in `inbox/`.
4. Set `ORG_EMAIL_DOMAINS=youragency.com` in `.env.local` — without it every
   message looks incoming.
5. Run `npm run import`.
6. Open the review queue and read what it proposed.

**Attachments are now read.** 16 of the 21 real test emails reference one, so
this had to exist before the evaluation could be fair — otherwise the AI gets
marked wrong for not knowing a closing date that only ever existed inside the
attached settlement statement, and no prompt change can fix that.

The import log now reports `[3 file(s) kept, 2 read, 1 scanned/no text]`.
**Watch the "scanned/no text" number.** That is the count of documents with no
text layer, and it is the only evidence that will ever exist for whether OCR is
worth building. If it stays near zero across your real mail, OCR is a solved
problem you never had. If it is a third of everything, that changes the answer.
Nobody can make that call today.

**One trap, already handled but worth understanding.** Forwarding mail to a test
account would normally break two things: every message would look INCOMING
(because the envelope sender becomes you), and the real content would sit in the
quoted section the AI never reads. The importer unwraps forwards, recovers the
original sender, and decides direction from that. Verified end to end.

**Done when:** you've looked at 20 emails' worth of output and believe it. The
formal bar is 15 of 20 fully correct.

**Time:** about 30 minutes of your attention.

---

## Step 2 — Connect the real mailbox

**Why second:** until this happens, someone has to feed the app by hand. This is
the step that turns a demo into a tool.

**What:** register an application with your mail provider's identity service so
the software can read the mailbox, then connect it.

**Who does what:** you do the portal work — it needs an administrator and a
browser. Everything around it exists:

```
setup.cmd          double-click, paste four values, done
npm run preflight  says exactly what is wrong if it fails
npm run sync       pulls mail with no browser open
```

`preflight` matters. This adapter has never touched a live tenant and the first
connection usually fails. Instead of a bare "401 Unauthorized" it tells you
*which* thing is wrong: bad secret, wrong tenant, missing permission, or consent
not granted.

**Permissions: read-only. Never request send access.** The app does not send,
delete, or modify mail, and the permission it never asks for is the one it can
never misuse.

**Time:** ~15 minutes of portal work, then budget an afternoon for the first
connection to misbehave.

---

## Step 3 — Run for two weeks and change nothing

**Why:** you now have a system reading real mail and proposing real work. The
only thing worth doing is watching it.

**What to watch:**

- Which proposals you approve without thinking (the AI is right)
- Which you edit before approving (nearly right — worth a prompt change)
- Which you reject (wrong — worth understanding why)
- What it **missed entirely** (the expensive category, and the one you will only
  notice by knowing your own mail)

**Turn every rejection into a test case.** There's a workflow for converting a
real email into an anonymised scorecard case. A rejection you record becomes a
regression test; a rejection you only remember becomes a repeat.

**Resist:** turning on automation, adding features, changing prompts on a hunch.

---

## Step 4 — Then, and only then, the three known gaps

These came out of real emails. Each is real, none is blocking, and each needs a
decision from you before it's built.

**Outgoing requests raise nothing to chase.** When you email an underwriter
asking for a corrected document, the app records the facts and creates no task.
The obligation is invisible until they reply. Four of 22 real emails hit this.
**Needs your decision** because "our sent mail raises no tasks" is currently a
deliberate safety property — loosening it means your own outbox starts creating
work.

**Wire notifications have nowhere to go.** They ask for nothing, so no task is
raised and the notification vanishes. They need a Disbursements section, matched
to a file by the memo field.

**Incoming vs outgoing is decided per mailbox, not per person.** The same
internal email is outgoing for the sender and incoming for the recipient.
Already flagged by you; deferred until real mailbox data shows how much internal
mail actually flows.

---

## Step 5 — Hosting, and what it drags with it

> **Superseded on 2026-08-03.** The owner has decided to deploy now rather than
> waiting for a second person. Read the agreed plan at the top of this file —
> particularly the corrected estimate for 5a, which this section understates.
> The rest of this section is still accurate about *what* the work is.

**Do this when a second person needs access, and not before.** For one person on
one machine, the current setup is genuinely fine.

Three things travel together, because a server cannot use files on your laptop:

**5a. PostgreSQL — this is Supabase.** Decided 2026-08-03. Supabase connected
cleanly; the Prisma connector would not connect at all, so that path is closed
and the leftover `prisma.compute.json` should be deleted.

The design file already describes every table in PostgreSQL terms — that work is
done. What remains: install the tooling, run the migration, swap the query
layer. **One file is the seam** (`src/lib/db.ts`). Half a day, most of it
verifying nothing broke.

Two things to get right when it happens:

- The project is on a tier that **pauses itself after inactivity.** Acceptable
  while migrating and testing; not acceptable for a system of record that has to
  answer at 9am on a closing day. Budget for the tier that stays awake.
- Use Supabase's **connection pooler**, not a direct connection. A serverless
  host opens and closes connections constantly and will exhaust a direct one.

**5b. Cloud document storage.** One new file implementing the same interface the
local store already implements, plus a line in the factory. 2–3 hours. It was
built for this swap.

**5c. Deployment.** In order:

1. **Somewhere to run it.** A platform host or a small always-on server.
2. **HTTPS.** Not optional in any sense — the sign-in cookies refuse to travel
   over an unencrypted connection in production.
3. **Rotate the demo password.** It is printed in the README. It must be
   replaced before the app holds one real client email.
4. **Real accounts for real people.** Deactivate the demo ones.
5. **Scheduled sync**, so mail arrives without anyone pressing anything.
6. **Backups — and test the restore.** This app is the system of record for
   closings. An untested backup is a rumour.

---

# What NOT to do

**Don't turn on automation** because the AI has been right a few times. It ships
disabled on purpose. Loosen it only with months of evidence, one action type at
a time, starting with the least destructive.

There is a security reason as well as a quality one, and it is worth stating
plainly. Email bodies are text written by whoever sent them, fed to an AI —
which makes them an attack surface. Someone could craft a message designed to
influence what your system believes about a closing, and title agencies are the
most-targeted category in the country for exactly that kind of fraud.

Three things currently prevent it: the AI can only emit validated fact types
and task categories, so it has no vocabulary for "send money"; it has no
database access, only controlled functions; and **every proposal stops at a
human.**

That third one is the strongest, and it is the one automation removes. So:
**hardening against crafted email is a precondition for Phase 2, not a
follow-up to it.** Treat it as a gate, not a task.

**Don't add a consumer-mail adapter.** Your real target is enterprise mail. The
import path covers the other case for testing.

**Don't build transaction split.** Merge is built and reversible, which covers
the real case. Build split when something actually demands it.

**Don't build a phone app.** The desktop layout works on a tablet. Build it when
someone asks.

**Don't accept a prompt change on one good run.** The scorecard is not
deterministic — three runs of the same two emails produced three different sets
of failures. Use the tuning script, which runs the set repeatedly and reverts
anything that isn't genuinely better.

---

# Working with an AI assistant on this

**Point it at the docs first.** `REBUILD.md` for how things got here,
`AGENTS.md` for the constraints, this file for what's next. Most bad changes
come from an assistant rediscovering a decision by breaking it.

**Require verification, not assurance.** `npm run verify:full` — types, 293
tests, linter, production build. "It should work" is not a result.

**Require Windows.** Most agent environments are Linux. A file-locking bug
reported all tests green on Linux for weeks while failing on Windows. Anything
touching file deletion, renaming or locking deserves suspicion.

**Ask what it did NOT verify.** The most useful sentence in any report is the
one admitting what wasn't checked. The mail adapter has never touched a live
tenant. That should be said every single time it comes up.

**Prefer a checked-in script over a manual procedure.** Every time. A procedure
gets done differently each time; a script gets fixed once.

---

# The shortest honest summary

You have a working application. It reads email, extracts facts, files them
against properties, proposes work, keeps evidence for everything, keeps the
documents, and now reads well for someone who doesn't want to squint.

**What stands between here and daily use is not construction. It's
connection** — one mailbox registration — **and confidence** — twenty emails
you have checked yourself.

Hosting, PostgreSQL and cloud storage matter when someone *else* needs to use
this. For you, on your machine, they are optional. Don't let them block you.
