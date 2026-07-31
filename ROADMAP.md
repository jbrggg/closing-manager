# Roadmap — ordered work queue

Work these **in order**. Each has a definition of done and says clearly
whether a human must be involved.

Legend:
- 🤖 **Agent can do this alone** — build it, test it, report back
- ✋ **Stop and ask** — needs a human decision, credential, or judgment call
- 🧍 **Human-only** — the agent physically cannot do this

---

## Phase A — Make the brain good enough (do this first)

Everything downstream is wasted effort if the AI can't read real email.

### A1. ⏭️ SKIPPED — folded into A2's acceptance criteria
The user is going straight to the real LLM. The four known gaps below are
no longer worth patching in the word-matcher; they are now the **test cases
the LLM must pass** in A2. Keep them written down for that purpose.

<details><summary>Original A1 (deferred, not deleted)</summary>

Harden the rule-based extractor as a fallback
The rule engine will remain the fallback when the LLM is unavailable, so
it shouldn't be brittle. Known gaps found in testing:
- Addresses with no street suffix ("88 Rosewood")
- Times without AM/PM ("Thursday at 10")
- Contractions without apostrophes ("dont", "havent", "wont")
- Names in subject lines with no role keyword nearby

Only revisit if the LLM fallback path becomes load-bearing.
</details>

### A2. ✅ DONE 2026-07-31 — Switch on the real LLM provider
Completed with the human's Anthropic API key (billing decision made; key
lives only in `.env.local`, which is gitignored). `src/lib/ai/llm-provider.ts`
has now executed for real against `claude-sonnet-5` — the old coded default
`claude-sonnet-4-5` was verified stale against docs.claude.com and updated
in both the code default and `.env.example`.

All four acceptance cases (A1's defect list) passed via the Email Test Lab
on a freshly reset demo database, and again on a repeat run:
1. `88 Rosewood` — extracted as the property address
2. `Thursday at 10` — date and time both extracted, exactly as written
3. `we still dont have the CPL` — CPL-request task proposed at 97%
4. `Kowalski` — buyer extracted from the subject line

Banner read "Read by the real AI (claude-sonnet-5)". One prompt change was
made during testing: the extraction prompt now forbids adding AM/PM markers
the email doesn't state (the model invented "10:00 AM" in 1 of 3 trial
runs). `npm test` passes 72/72 inside a no-network sandbox (`unshare -rn`),
proving the suite never leaves the simulated provider.

### A2.1 ✅ DONE 2026-07-31 — Speed and repeatability pass
Not originally on the roadmap; added because A2 took 40 minutes of which
roughly half was mechanical overhead. No change to what the app produces.

1. **Accuracy scorecard** (`npm run eval`, `evals/`) — runs real emails
   through the real pipeline headless. No server, no browser, no sign-in.
   Scores facts, invented detail, tasks, task count, and filing, in
   parallel, and writes a plain-English report to `evals/last-run.md`.
   Replaces ~60 seconds of browser clicking per email with ~2 seconds.
   This is what A3 now uses.
2. **One API call per message instead of one per question.** The provider
   answers facts + requests (or completion) in a single call and caches it;
   `prefetchAnalysis()` warms it. Roughly halves per-email cost.
3. **Thread messages read in parallel** (`mapConcurrent`, cap 5). A
   four-message thread now takes about as long as one message.
4. **`npm run verify`** — type check, tests and linter in parallel, one
   verdict. `npm run verify:full` adds the build.
5. **Prisma removed from `package.json`** — 182 MB of an 874 MB install
   that nothing imported. `prisma/schema.prisma` is untouched. See C1.
6. **26 new tests** covering `llm-provider.ts`, which previously had none:
   call-count guarantees, the AM/PM regression guard, enum validation,
   outage vs. empty-result handling, and end-to-end pipeline call counts.
   72 → 98 tests, all passing.

### A3 is now the CURRENT TASK — see below. Only the human can do it.

### A3. 🧍 Accuracy evaluation on real email
The human supplies 20–30 real, redacted emails and scores them. **Only they
can judge this** — it's domain expertise, not engineering.

**How, as of A2.1:** put each email in `evals/cases/` with what the right
answer should be (format and worked examples in `evals/README.md`), then
run `npm run eval`. A 25-email run takes under a minute and costs a few
cents. The Email Test Lab (`/lab`) is still there for one-off spot checks.

**Done when:** 15+ of 20 fully correct. Below that, iterate on the prompts
in `llm-provider.ts` and re-run `npm run eval` — the whole set re-scores in
under a minute, so prompt tuning is now a fast loop rather than a day.

**Note for whoever helps with this:** `evals/cases/a2-kowalski.json` must
keep passing. It is A2's acceptance test plus a guard against the AI
inventing an AM/PM the email never stated.

---

### A4. ✅ DECIDED 2026-07-31 — direction becomes per-person
**Owner's decision:** differentiate mail sent by *the signed-in user*, mail
sent by *a colleague in our office*, and mail from *outside*. Incoming vs
outgoing then falls out automatically for each user rather than being one
org-wide label. This is option 3 below.

Consequences to work through before building:
- `EmailMessage.direction` stops being a stored column and becomes something
  resolved at read time from the viewing user's own addresses. The Graph
  adapter currently writes it at ingest (`graph-mapping.ts`).
- A third category appears — **internal**: sent by a colleague, received by
  me. Today those look identical to outside mail. Several real cases in
  `evals/cases/private/` are exactly this shape (`hud-sent-for-approval`,
  `payoff-letter-request`), and they are the ones where "should this raise a
  task?" is genuinely unclear. Internal mail is often *the instruction to
  act*, so it probably should.
- The `direction` field in eval cases will need a third value, and the
  `taskCount: 0` assertions on outgoing mail will need revisiting alongside
  D5.
- Every extracted fact and proposal must still resolve identically for all
  users — only *whose task it is* changes, never *what the email said*.

**Do not start this before Phase B.** It should be built against real mailbox
data, once we can see how much internal mail actually flows between the
shared inboxes.

<details><summary>Original write-up of the problem and the three options</summary>

Raised 2026-07-31 while building eval cases.

`src/lib/email/graph-mapping.ts` decides `INCOMING` vs `OUTGOING` by
comparing the sender against **the one connected mailbox address**. That is
correct for a single shared closing mailbox, which is what the README
recommends starting with.

But the agency has several people and several shared inboxes (`refi@`,
`purchase@`, `info@`). An email sent by `purchase@` and copied to `refi@` is
genuinely **outgoing for the person who sent it and incoming for the person
who received it** — and the app currently has to pick one.

This matters because direction is not cosmetic: `INCOMING` makes the AI look
for requests and raise tasks, `OUTGOING` makes it look for completions.
Getting it wrong makes the AI look broken when it isn't.

Options, roughly in order of effort:
1. **Keep one connected mailbox** and accept org-level direction. Simplest,
   works today, and is what the eval cases currently assume.
2. **Connect several mailboxes**, keep direction org-relative — treat any
   address belonging to the organisation as "us". An internal `purchase@` →
   `refi@` email becomes OUTGOING and stops raising tasks, which may be
   wrong: those internal forwards often *are* the instruction to act.
3. **Make direction per-user** — store the message once, resolve direction at
   read time from the signed-in user's own addresses. Most correct, most
   work, and it changes the `EmailMessage.direction` column into something
   computed rather than stored.

</details>

---

## Phase B — Connect the real mailbox

Do not start before Phase A passes.

### B1. 🧍 Entra app registration
Human-only: consent screens and MFA cannot be automated.
Full steps in README → "Connecting Outlook". Register a **separate** app
from any existing one. `offline_access` scope is mandatory.

### B2. ✋ First live connection + debugging
The adapter is written but unverified. Expect failures on the first
attempt. The agent can read error output and fix the code; the human must
click through consent.

**Done when:** `POST /api/v1/integrations/microsoft/sync` returns real
messages and they appear in the review queue.

### B3. 🤖 Sync scheduling and resilience
Add scheduled sync, retry with backoff on 429/5xx, and surface sync health
on the dashboard. Consider a Graph change-notification webhook to replace
polling.

**Done when:** sync survives a token expiry, a rate limit, and a network
drop without losing messages or double-processing them.

---

## Phase C — Make it real infrastructure

### C1. ✋ PostgreSQL migration
`prisma/schema.prisma` is already Postgres-shaped. Needs a database the
human provisions (Supabase is already connected to their GitHub — Neon and
RDS are alternatives; their choice and their billing).

**Start by reinstalling Prisma**, which was removed in A2.1 because nothing
imported it and it was 182 MB of the install:

```bash
npm install -D prisma @prisma/client
```

**Done when:** the app runs against Postgres, all tests pass, and the seed
produces identical results.

### C2. ✋ Deployment
Needs hosting account + domain + HTTPS. Session cookies set `Secure` in
production and will not transmit over plain HTTP.

### C3. 🤖 Backups and retention
The app is the system of record for closings. Automated backup + a
documented restore procedure.

---

## Phase D — Complete the product

### D1. 🤖 Transaction merge and split
`POST /api/v1/transactions/:id/merge` is specified but unbuilt. The review
queue already surfaces duplicate candidates with no way to act on them.
Must preserve full fact history from both sides.

### D2. 🤖 Persist office settings
`src/lib/services/office-rules.ts` is in-memory and resets on restart.
Write through to the Office/Organization tables with a Settings UI.

### D3. 🤖 Gmail adapter
Only if the agency actually needs it. Outlook first.

### D5. ✋ Our own outgoing requests raise no task at all
Found 2026-07-31 while building the `cpl-correction-request` eval case.

The pipeline treats direction as a hard fork: `INCOMING` → look for requests
and raise tasks; `OUTGOING` → look for completions only. So when someone here
emails the underwriter "please provide us with an updated CPL", the app
records the facts and creates **nothing to chase**. The obligation exists —
it is just invisible until the underwriter happens to reply.

This is the single most common shape of work in the mailbox: we ask an
outside party for something and then have to remember to follow up.

The schema already supports it. `Task.status` has `WAITING_EXTERNALLY`, and
the brief calls for exactly this ("Forward payoff when received", "Send
revised commitment after underwriting changes arrive"). What is missing is
the pipeline step that creates one.

Sketch:
- on an `OUTGOING` message, ask the model for *outbound* requests as well as
  completion signals — "what did we just ask someone else for?"
- raise a `TASK_CREATE` proposal with status `WAITING_EXTERNALLY`, the
  recipient as the party being waited on, and a trigger condition
- a later inbound reply on the same transaction is what closes it, which is
  the completion detection that already exists

**Ask before building.** It changes what OUTGOING mail does, and today
`taskCount: 0` on outgoing mail is asserted in several eval cases and is a
deliberate safety property — our own sent mail cannot currently spam the task
list. Those assertions would need revisiting together with the owner.

### D4. ✋ Phase 2 automation rollout
Human decides when to trust it. Start with `TASK_CREATE` at a high
threshold, watch the audit log, expand slowly.

---

## Standing rules for every task

- Read `CLAUDE.md` first. The invariants there are not negotiable.
- Write the test before the fix when fixing a bug.
- Run the full verification block before saying anything is done.
- If a change would touch matching weights, thresholds, the approval
  workflow, or anything security-related — **stop and ask**.
- Report honestly. "Implemented but untested against real data" is a
  useful status. "Done" when it isn't is not.
