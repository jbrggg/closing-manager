# Continuing from here

**Companion to `REBUILD.md`.** That document says how the app got to where it
is. This one says what to do next, in what order, and why that order.

**Written:** 2026-08-03. **Vendor-neutral:** no AI company, assistant or model
is named. The app talks to a *hosted model provider* through a swappable
interface.

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

**This is where you are. Nothing else should start before it.**

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

**Do this when a second person needs access, and not before.** For one person on
one machine, the current setup is genuinely fine.

Three things travel together, because a server cannot use files on your laptop:

**5a. PostgreSQL.** The design file already describes every table in PostgreSQL
terms — that work is done. What remains: install the tooling, run the migration,
swap the query layer. **One file is the seam.** Half a day, most of it verifying
nothing broke.

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
