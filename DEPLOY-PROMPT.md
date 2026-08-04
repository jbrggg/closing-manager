# Prompt for Claude Code — finish and deploy closing-manager

**How to use this:** see `START-HERE-CLAUDE-CODE.md` for how to launch Claude
Code pointed at this folder — there is a route that needs no terminal at all.
Then paste everything between the two marker lines below.

The only thing that matters is that Claude Code is **opened on this folder**.
That is what "the agent needs to see the repository" means.

---

## ⬇ COPY FROM HERE ⬇

---

You are working on **closing-manager**, an AI-assisted closing and task manager
for a small title agency in Pennsylvania and New Jersey. I am the owner. **I am
not a developer** — explain things in plain English, and never assume I can read
code to check your work.

My goal: **get this deployed and usable against my real mailbox.**

---

### STEP 0 — READ BEFORE YOU TOUCH ANYTHING

Read these four files completely, in this order, before writing a single line
of code:

1. `AGENTS.md` (and `CLAUDE.md`) — the invariants. These are not suggestions.
2. `CONTINUING.md` — what is done, what is next, and what to deliberately NOT
   build.
3. `REBUILD.md` — every architectural decision and why it was made.
4. `README.md` — the feature inventory.

Then run `npm run verify` and tell me the result before proposing anything.

---

### THE MOST IMPORTANT INSTRUCTION

**This application is already built. Do not rebuild it.**

There are ~348 passing tests, nine working screens, a working AI pipeline, an
approval workflow, an audit trail, document storage, and a real-email import
path. If you find yourself writing a new dashboard, a new database layer, or a
new AI provider, **stop — you have misunderstood the task.**

The gap is **deployment and connection**, not construction.

If something looks wrong or badly built, say so and ask. Do not silently
"improve" working code. Several things that look odd are deliberate and were
paid for with a failed attempt — the comments explain them.

---

### WHAT I ACTUALLY WANT

In priority order:

1. **Deploy it** so it runs on a computer that is always on, over HTTPS, without
   my laptop being open.
2. **Migrate the database** from SQLite to **Supabase PostgreSQL**, because a
   server cannot use a file on my laptop.
3. **Move document storage** off local disk for the same reason.
4. **Harden it for real use** — rotate the published demo password, create real
   accounts, set up scheduled mail sync, and set up backups *and prove the
   restore works.*

---

### DECISIONS ALREADY MADE — DO NOT REOPEN THESE

**The database is Supabase.** Decided. Supabase connected cleanly to my tools;
Prisma's connector would not connect at all, so that path is closed.

Three things you need to know about my Supabase project:

- It is currently **paused** (`INACTIVE`). It will need restoring before use.
- It is on a tier that **pauses itself after inactivity.** That is fine for
  migrating and testing, and it is *not* fine for a system of record that has to
  answer at 9am on a closing day. Tell me plainly when in the process I need to
  move to a tier that does not pause, and what that costs.
- Next.js on a serverless host opens and closes connections constantly. Use
  Supabase's **connection pooler**, not a direct database connection, and say so
  in the plan.

There is a leftover `prisma.compute.json` in the repository from that failed
Prisma connector. It is dead configuration for a path we are not taking, and it
will mislead you or a future session. **Delete it as part of the first stage.**

---

### DECISIONS YOU MUST ASK ME ABOUT — NEVER GUESS

Stop and ask before acting on any of these:

- **Which host**, and what it costs per month. Tell me the real number.
- **Anything that costs money.** Ever. Including the Supabase tier change above.
- **Any account creation, OAuth consent screen, or payment.** I do those
  myself — describe exactly what to click.

Never ask me to paste an API key, password, or secret into the chat. Tell me
which file to put it in and I will do it on my machine.

---

### HARD CONSTRAINTS — breaking these is a failed task

1. **Approval-only.** No AI proposal becomes a live record without a human
   decision. Every `AutomationRule` ships `enabled = 0`. **Do not enable any of
   them**, however accurate the AI seems.
2. **Mail access is read-only.** Never request send permission from the mail
   provider. The app does not send, delete, or modify mail.
3. **Never delete a fact.** Information that changes gets marked `SUPERSEDED`
   and a new row inserted. History is evidence.
4. **Every fact and proposal links to a source email.** No orphans.
5. **Matching is deliberately conservative.** The 60-point threshold and the
   weights in `src/lib/ai/match.ts` were tuned against a real false-merge bug.
   A shared surname or office must never be enough to link two files.
6. **Never redact structured fact values.** `LOAN_NUMBER` and `FILE_NUMBER` are
   matching keys worth 50 points. Redaction applies to prose only. See
   `src/lib/security/redact.ts`.
7. **Never commit secrets.** `.env.local` is gitignored and stays that way.
8. **Verify on Windows.** I run Windows; most agent sandboxes are Linux. A
   file-locking bug once reported every test green on Linux while failing on
   Windows for weeks. Anything touching file deletion, renaming or locking
   deserves suspicion.

---

### HOW TO WORK

**Plan first.** Do not start editing. Produce a written plan covering:

- the exact order of work, and why that order
- what breaks if each step goes wrong, and how to undo it
- every decision you need from me, gathered up front
- what it will cost per month
- what you will *not* do

Get my approval on the plan. Then work in stages, and after **each** stage:

```bash
npm run verify:full   # types, all tests, linter, production build
npm run contrast      # colour contrast; exits non-zero on failure
```

If any of that fails, fix it before continuing. Commit and push after each
working stage so nothing is lost and anything can be undone precisely.

**Prefer a checked-in script over a manual procedure, every time.** If I have to
do something more than once, write me a script I can double-click. Never tell me
to run a `curl` command as the primary way to do something — build a page or an
npm script instead. That mistake was already made once here and corrected.

**Work in stages, and expect this to span several sessions.** I will not do all
of this in one conversation, because a long session gets less reliable as it
fills up and starts forgetting decisions made earlier.

So: at the end of each stage, **before I run out of room**, update
`CONTINUING.md` with exactly where we got to, what is verified, what is not, and
what the next session should do first. Those documents are the handoff — not my
memory, and not yours. A fresh session that reads them should be able to pick up
in a minute.

If you notice the conversation getting long or your own recall getting patchy,
say so and write the handoff. Do not push on and hope.

---

### A SEQUENCING QUESTION I WANT YOUR HONEST OPINION ON

`CONTINUING.md` says the next step is not deployment — it is proving the AI
reads my real email correctly, by importing 15–25 real messages and checking the
output. Deployment is listed as step five.

I am asking you to deploy anyway. **Tell me honestly whether that is a mistake
before you start.**

Consider both sides: deploying something unvalidated may mean paying to host
software that turns out not to work — but a real mailbox connection needs a
public HTTPS callback, and scheduled sync needs an always-on machine, so
deployment may genuinely be a prerequisite rather than a premature optimisation.

Give me your actual recommendation. If you think I am wrong, say so plainly,
then do what I decide.

---

### DEFINITION OF DONE

- The app is reachable at an HTTPS address that works with my laptop closed.
- The published demo password (`KeystoneDemo2026!`, printed in the README) is
  **rotated**, and real accounts exist for real people.
- `APP_ENCRYPTION_KEY` is generated, stored safely, and **I have been told in
  plain English that losing it means reconnecting every mailbox.**
- Mail syncs on a schedule without anyone pressing anything.
- Backups run, and **you have watched a restore actually work.** An untested
  backup is a rumour, and this app is the system of record for closings.
- All tests still pass, on Windows.
- `CONTINUING.md` and `REBUILD.md` are updated to match reality.

---

### HOW TO TALK TO ME

- **Plain English.** Define any unavoidable term inline.
- **Be direct about what is unverified.** The Microsoft/Outlook mail adapter is
  fully implemented but has **never touched a live mailbox**. Say so every time
  it comes up.
- **Do not claim production readiness.** Tell me what you tested and what you
  did not.
- **Tell me when I am wrong.** I would rather hear it now than after paying for
  a month of hosting.
- End each stage with: what changed, what it cost, what is still unverified, and
  the single next thing you need from me.

Start by reading the four files, running `npm run verify`, and giving me your
plan plus your honest answer on the sequencing question.

---

## ⬆ COPY TO HERE ⬆

---

## Notes for you (Jaydon) — not part of the prompt

**Why this prompt is shaped the way it is.** The biggest risk when you say
"fully build out the app" to a fresh agent is that it takes you literally and
starts rebuilding what already works. A new session has no memory of this
project — it sees a folder and an ambitious instruction. Nearly a third of this
prompt exists to prevent that one failure.

**The two questions it forces the agent to bring back to you** are the hosting
cost and the sequencing question. Those are genuinely yours to make, and an
agent left alone will quietly pick one and proceed. The database question is
now answered — Supabase — so the prompt states it as settled rather than
inviting a debate you have already had.

**If the plan it produces starts with "first I'll set up the project structure"
or mentions creating files that already exist — stop it.** It did not read the
documents, and everything after that point will be wrong.
