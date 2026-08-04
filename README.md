# Keystone Closing Operations — AI Closing & Task Manager (Prototype)

[![Verify](https://github.com/jbrggg/closing-manager/actions/workflows/verify.yml/badge.svg)](https://github.com/jbrggg/closing-manager/actions/workflows/verify.yml)

Green means the type check, the full test suite and the linter all passed on
**Windows and Linux**, on Node 22 and 24. Click it to see the last run. Windows
is the one that matters — this project has already been burned once by a test
suite that was green on Linux and broken on Windows.

A working full-stack prototype of an AI-assisted closing manager and task manager
for a small PA/NJ title agency, per the project brief. This app — not any
calendar or title-production system — is the system of record for closings,
tasks, deadlines, review items, transaction context, and AI activity.

---

## Start here

Four documents, each answering one question. All are written in plain English
and are deliberately **vendor-neutral** — no AI company, assistant or model is
named, so they stay accurate whichever provider this is pointed at.

| Document | Answers |
|---|---|
| **[REBUILD.md](REBUILD.md)** | *How do I rebuild this from an empty folder?* Every stage in order, every architectural decision and why, the ten invariants, and the traps that each cost a failed attempt. |
| **[CONTINUING.md](CONTINUING.md)** | *What do I do next?* The remaining work in priority order, what to deliberately not build, and how to brief an AI assistant on this codebase. |
| **[ACCESSIBILITY.md](ACCESSIBILITY.md)** | *Can everyone actually use this?* A WCAG 2.1 AA audit — 6 issues found, 6 fixed, 32 colour pairings measured. |
| **[DESIGNING-THE-INTERFACE.md](DESIGNING-THE-INTERFACE.md)** | *How do I change how it looks?* Working on the interface with an AI assistant, and the two settings that are yours alone. |

If you read one, read `CONTINUING.md`. It says where you actually are.

---

## Status: working vertical slice, Phase 1 (approval-only)

Everything described below is real and runs locally. Nothing here is a mockup
screenshot — every page is backed by the API layer, which is backed by a real
(if simplified) AI processing pipeline and database.

## Quick start

```bash
npm install
npm run dev
```

Requires **Node 22.5+** (uses the built-in `node:sqlite` module).
Optionally `cp .env.example .env.local` to configure integrations —
everything runs on mock/simulated defaults without it.

Open http://localhost:3000. You'll be redirected to `/login` — sign in with
`dana@keystonetitle.com` / `KeystoneDemo2026!` (see **Signing in** below).
The database auto-seeds on first visit (7 scenarios described below). To force a clean reseed at any time, click
**"Reset demo data"** on the Dashboard, or:

```bash
curl -X POST http://localhost:3000/api/v1/dev/seed
```

No environment variables, Docker, or external services are required for this
prototype — see **"Why SQLite instead of Postgres"** below for why.

## Signing in

The app requires authentication. On first run the database seeds three demo
accounts (all share the same password so the walkthrough is easy):

| Email | Password | Role |
|---|---|---|
| dana@keystonetitle.com | `KeystoneDemo2026!` | Admin |
| marcus@keystonetitle.com | `KeystoneDemo2026!` | Closer |
| priya@keystonetitle.com | `KeystoneDemo2026!` | Processor |

Sign in at `/login` — any other URL redirects there when signed out.

### How the auth works

- **Passwords**: scrypt (N=32768, r=8, p=1), random per-user salt, timing-safe
  comparison. Plaintext is never stored. ~100 ms per verification.
- **Sessions**: opaque 32-byte random token in an `httpOnly`, `SameSite=Lax`
  cookie (`Secure` in production), 12-hour expiry. Only the SHA-256 *hash* of
  the token is stored, so a database leak doesn't yield usable sessions.
  Revoking access is a row delete — there's no self-contained JWT that stays
  valid until it expires.
- **Two-layer enforcement**: `src/middleware.ts` is an edge-runtime UX gate
  that only checks whether a cookie is *present* (it can't reach SQLite).
  The real check runs server-side on every request — `requirePageSession()`
  in pages, `requireApiSession()` in API routes — validating the token,
  expiry, and that the user is still active. Deleting the middleware would
  worsen redirects but would not open a hole.
- **Roles**: ADMIN, CLOSER, PROCESSOR, ATTORNEY, STAFF. The permission map
  lives in one place (`src/lib/auth/guard.ts`). Approving proposals is open
  to all roles except STAFF; changing automation rules and settings is
  admin-only.
- **Audit integrity**: approvals record the **session** user, never a user ID
  from the request body. Verified: a processor approving an item writes
  `decidedByUserId = user-processor` and an audit event with that actor.
- Sign-in, failed sign-in, and sign-out are all written to the audit log.
  Failed logins return an identical message and take similar time whether
  the email exists or not, so the endpoint doesn't leak which addresses have
  accounts.

### Managing accounts

```bash
npm run users list
npm run users create "Jane Doe" jane@firm.com ADMIN   # prompts for password
npm run users set-password jane@firm.com              # also revokes sessions
npm run users deactivate dana@keystonetitle.com       # also revokes sessions
```

## Human-run setup tasks

**To run the app locally: none.** `npm install && npm run dev`, then sign in
with a demo account. Everything else below is only needed to go beyond the
local demo.

### Required before any real (non-demo) use

1. **Replace the demo accounts.** They're published in this README, so treat
   them as public. Create real accounts, then deactivate the demo ones:
   ```bash
   npm run users create "Your Name" you@youragency.com ADMIN
   npm run users deactivate dana@keystonetitle.com
   npm run users deactivate marcus@keystonetitle.com
   npm run users deactivate priya@keystonetitle.com
   ```
2. **Serve over HTTPS.** Session cookies set `Secure` when
   `NODE_ENV=production`, which means they will not be sent over plain HTTP.
   Behind a proxy, terminate TLS there.
3. **Move to PostgreSQL.** SQLite is a single-file local database; it is not
   appropriate for multi-user production. Run `npx prisma migrate dev`
   against `prisma/schema.prisma`, then swap `src/lib/db.ts` to Prisma
   Client. The schema is already Postgres-shaped — see "Why SQLite instead
   of PostgreSQL" above.
4. **Add database backups**, since this app is the system of record for
   closings and tasks.

### Required to connect real email (unavoidably manual — external consoles)

5. **Gmail**: create a Google Cloud project → enable the Gmail API → create
   an OAuth 2.0 Web Client ID → add redirect URI
   `https://yourdomain/api/v1/integrations/gmail/callback` → request the
   `gmail.readonly` scope → put the client ID/secret in `.env.local`. If the
   agency uses Google Workspace, an admin must approve the app.
6. **Microsoft 365**: register an app in Azure AD (Entra ID) → add the same
   style of redirect URI → request the `Mail.Read` delegated scope → put
   client ID/secret/tenant ID in `.env.local`.
7. **Then finish the adapter code.** Steps 5–6 only produce credentials.
   `src/lib/email/gmail-provider.ts` and `microsoft-provider.ts` are
   scaffolds whose methods throw `NotImplementedError`; each carries a
   per-method checklist of exactly which endpoint to call. This is a
   development task, not a configuration task, and it is the single largest
   remaining gap in the project.

### Required to use a real LLM instead of the rule-based engine

8. **Get an API key from a hosted model provider** and set `AI_PROVIDER=llm`
   plus `AI_API_KEY` in `.env.local`. The provider code is complete and was
   first run successfully against a live API on 2026-07-31. Budget time to
   watch the first extractions and tune prompts.

### Optional

9. **Turn on Phase 2 automation** once you trust the AI's accuracy —
   Settings → Automation phase. Start with one low-risk action type
   (`TASK_CREATE`) at a high threshold and watch the audit log.
10. **Tighten the password policy** in
    `validatePasswordStrength()` (`src/lib/auth/password.ts`) if the agency
    has its own standard.

## What's real vs. simulated

| Piece | Status |
|---|---|
| Next.js app, API routes, UI | Real, running |
| Database schema & queries | Real, running (SQLite locally; see below) |
| Email provider | **Mock** — seeded mailbox, clearly labeled `MOCK` everywhere in the UI |
| AI extraction/matching/proposal engine | **Rule-based simulation** — deterministic regex/keyword logic implementing the same `AIProvider` interface a real LLM-backed provider would |
| Approval workflow, audit trail, idempotency, fact supersession | Real, running |
| Gmail / Microsoft 365 / real LLM provider | **Not implemented** — interfaces exist (`EmailProvider`, `AIProvider`) so they can be added without touching the rest of the app |

## Why SQLite instead of PostgreSQL

The spec's preferred stack is Postgres + Prisma. This sandbox's network
egress is restricted to package registries (npm/pip/cargo/GitHub) and does
**not** include `binaries.prisma.sh`, which Prisma's CLI needs to download
its query/schema engine binaries. Prisma Client could not be installed here.

Rather than fake it, I kept the two things separate and honest:

- **`prisma/schema.prisma`** is the canonical, documented data model — every
  entity from the spec (Organization, Office, User, EmailAccount/Thread/
  Message/Attachment, Person, Company, Property, Transaction,
  TransactionParticipant, ExtractedFact, ClosingEvent + revisions, Task +
  dependencies + completion evidence, AIProposal, ReviewItem,
  AIProcessingJob, AuditEvent, Notification, AutomationRule), targeting
  PostgreSQL. This is the model a production deployment should migrate.
- **`db/schema.sql`** + **`src/lib/db.ts`** implement the identical shape at
  runtime using Node's built-in `node:sqlite` (Node 22.5+, no native
  dependency, no download required).

**To move to real Postgres:** run `npx prisma migrate dev` against
`prisma/schema.prisma`, generate `@prisma/client`, and swap the query
functions in `src/lib/db.ts` (and the handful of call sites using raw SQL)
for Prisma Client calls. No entities, relationships, or enums need to change.

## Architecture

```
Mock email account (seeded mailbox)
        │
        ▼
EmailProvider interface  ──▶  MockEmailProvider (src/lib/email)
        │                      (Gmail/MS365 adapters plug in here later)
        ▼
AI processing pipeline (src/lib/ai/process-email.ts)
  1. Read full thread
  2. AIProvider.extractFacts()      — src/lib/ai/engine.ts (rule-based sim)
  3. Mailbox-wide search when incomplete, weighted by evidence strength
     (search hits below a trust threshold are excluded from matching —
     see "Weighted matching" below)
  4. findBestTransactionMatch()     — src/lib/ai/match.ts (weighted scoring)
  5. Persist ExtractedFact rows, marking superseded facts instead of
     deleting them
  6. Build/upsert AIProposal + ReviewItem rows (never auto-applies — Phase 1)
  7. AuditEvent logged at every step
        │
        ▼
Review Queue UI  ──▶  approve/reject  ──▶  src/lib/services/approval.ts
                                            (applies proposal to live
                                             ClosingEvent/Task records,
                                             writes audit trail)
```

One shared backend, one shared database, one versioned API
(`/api/v1/...`). The AI never talks to the database directly outside of
`src/lib/ai/*` and `src/lib/services/*` — it goes through the same proposal
pipeline a human-triggered action would.

## Weighted matching, not fuzzy merging

`src/lib/ai/match.ts` scores a new message's facts against every existing
transaction's current facts:

- Exact property address match: **+45**
- Exact file/loan number match: **+50**
- Exact full-name (buyer/seller) match: **+15**
- Exact closing-location match: **+10**
- Strong match threshold: **60** (auto-links facts to that transaction)
- Ambiguous range: **15–59** (creates a *new* transaction, but flags the
  best-scoring existing transaction as a `duplicateCandidates` entry on the
  review item for a human to merge or dismiss)
- Below 15: no relationship inferred

A shared last name or a generic subject line alone can never cross 15 (they
aren't scored at all), let alone the 60-point auto-link threshold. This is
demonstrated directly by **Scenario 6** below.

Mailbox search results are also weighted before being trusted as matching
evidence: a message found only because it happens to mention the same person
name is **not** injected into the matching fact pool (this was a real bug
caught during testing — see "Known issues found and fixed" below). Only
messages found via a shared participant, file/loan number, or address
fragment are trusted as matching evidence; weaker hits are excluded rather
than silently degrading confidence, so they never contribute to a false
merge.

## Seeded scenarios (all 7 required cases)

Reset demo data to see these fresh. All are visible via **Review Queue** →
approve/reject, and afterward on **Transactions** / **Settlement Board**.

1. **Split-across-email reconstruction** — 123 Main Street: buyer+address in
   one thread, "Friday works" in another, "2:00 PM" in a third, "Cherry Hill
   office" in a fourth. The AI searches the mailbox and reconstructs one
   closing proposal with all four facts, each retaining its own source
   email.
2. **Explicit task request** — 77 Birchwood Drive: "Please send the revised
   commitment by Friday" → explicit task, explicit due date.
3. **Implicit task request** — 14 Ridgeview Court: "We are still waiting for
   the CPL and this is holding up underwriting" → implicit task, urgent
   priority, lower confidence, routed to `low_confidence_task` review.
4. **Multiple requests, one email** — 5 Larkspur Lane: one email splits into
   three separate task proposals (commitment, payoff, scheduling).
5. **Reschedule with preserved history** — 123 Oak Lane: confirmed
   Monday 10:00 AM, then rescheduled to 3:00 PM. The `10:00 AM` fact is kept
   in the database with `status = SUPERSEDED`, visible on the transaction
   detail page under "Superseded facts."
6. **Ambiguous match, not merged** — two unrelated buyers coincidentally both
   named "Robert Johnson" at different addresses (55 Elm Street vs. 900 Birch
   Avenue) stay as two separate transactions; the second is flagged as a
   possible duplicate of the first for human review rather than silently
   merged.
7. **Completion evidence** — 200 Sunrise Boulevard: an outgoing email
   containing "please see attached the revised commitment" is matched to the
   earlier open task and proposed as a completion, pending approval.

*(Seed-time note: to demonstrate scenarios 5 and 7 without needing to click
through the UI first, the seed script pre-approves the initial closing/task
proposal for those two transactions only — simulating a prior human decision
made during onboarding. This is the only place anything is auto-approved;
every other proposal in the seed data sits in the review queue exactly as
the AI produced it.)*

## Known issues found and fixed during testing

Being transparent about this because it's the most informative part of
building something like this:

1. **Mailbox search over-matched almost everything.** The shared mailbox
   address is a participant on every thread, so naive participant scoring
   matched nearly every email in the mailbox. Fixed by excluding the
   organization's own email account addresses from participant-based search
   scoring.
2. **Duplicate facts inflated match scores.** The same fact, re-extracted
   from a repeatedly-found search result, was counted multiple times toward
   a transaction match. Fixed with dedup-by-(type, value) before scoring.
3. **A real false-merge bug (caught by Scenario 6).** Mailbox search would
   re-extract facts from an *already-processed* email purely because of a
   weak name coincidence, and those facts (which trivially matched their own
   transaction) dragged an unrelated new email's facts into the same
   transaction. Fixed by scoring search results and excluding weak,
   name-only hits from the fact pool used for matching.
4. **A regex false positive.** `File #...` extraction occasionally captured
   a name from an adjacent line when a subject ending in "file" was
   concatenated with a body starting with a capitalized word. Fixed by
   requiring extracted file/loan numbers to contain a digit.
5. **RSC serialization crash on `/review` and `/tasks`.** `node:sqlite`
   returns rows with a `null` prototype, which Next.js refuses to pass from
   a Server Component to a Client Component. Fixed by normalizing every row
   to a plain object in `src/lib/db.ts`.

All five were caught by actually running the seeded scenarios end-to-end and
inspecting the output, not by inspection alone.

## Email Test Lab (`/lab`)

Before connecting a live mailbox, paste real (redacted) emails into the
**Email Test Lab** page and see exactly what the AI extracts, what it
proposes, and which transaction it files them under. Full walkthrough in
`HOW-TO-RUN.md`.

This replaced an earlier `curl`-only dev endpoint, which was useless to
anyone who doesn't write code. Judging AI accuracy is a domain-expert task,
not a developer task, so it needed a real UI.

A representative result on a deliberately messy email is documented in
`HOW-TO-RUN.md` — the rule-based engine found the loan number, office, and
two of three requests, but missed an address without a street suffix
("88 Rosewood"), a name in the subject line, a contraction without an
apostrophe ("dont"), and a time written as "at 10". That is the expected
failure mode of literal pattern matching and the clearest argument for
switching on the real LLM provider.

## Automated tests

```bash
npm test
```

**72 tests across 5 suites.** They exist because the manual smoke testing
that built this app caught five real bugs, and nothing was stopping those
bugs from coming back.

What they cover:

- **`tests/match.test.ts`** — transaction matching weights and thresholds,
  including explicit regression tests for the false-merge bug (two unrelated
  "Robert Johnson" files) and the score-inflation bug.
- **`tests/ai-engine.test.ts`** — fact extraction, explicit vs implicit
  request detection, multi-request splitting, completion signals, and the
  file-number regex regression.
- **`tests/auth.test.ts`** — password hashing round-trips, salt randomness,
  malformed-hash handling, and the full RBAC permission matrix.
- **`tests/pipeline.test.ts`** — all seven seeded scenarios verified
  end-to-end through the real pipeline, plus idempotency, Phase 1 safety
  guarantees (nothing auto-approves), and the approve/reject workflow.
- **`tests/graph-mapping.test.ts`** — Outlook message mapping against
  recorded Graph payloads, HTML-to-text conversion, quoted-reply splitting,
  and OAuth token encryption.

Writing these immediately caught a wrong assumption — I had assumed an exact
property-address match alone should auto-link two emails. It doesn't, and
shouldn't: in title work the same property legitimately has multiple
transactions over time. The code was right; the test was wrong. That's the
kind of thing a test suite surfaces.

Each test file runs in its own process against its own throwaway SQLite
database, so suites can't corrupt each other or your demo data.

## API (versioned, `/api/v1`)

`GET /dashboard`, `GET|POST /transactions`, `GET /transactions/:id`,
`GET /closings`, `GET /tasks`, `POST /tasks/:id/complete`,
`POST /tasks/:id/reopen`, `GET /review-items` (`?status=PENDING|APPROVED|
REJECTED|ALL`), `POST /review-items/:id/approve` (body: optional
`editedPayload` to correct before applying), `POST /review-items/:id/reject`
(body: optional `explanation`), `GET /email/messages/:id`,
`POST /ai/process-email` (manual trigger, body: `emailMessageId`),
`GET /audit-events`, `GET|PATCH /settings`, `POST /dev/seed` (reset demo
data — not part of the spec'd API, dev-only).

All mutating AI actions go through `src/lib/services/approval.ts`, never
directly from a route handler.

## Idempotency & duplicate protection

Every `AIProposal` has a unique `idempotencyKey` derived from its type,
transaction, source message, and payload. Reprocessing the same email is a
verified no-op (tested: reprocessing a message twice produces zero new
review items). While a closing proposal for a transaction is still pending,
new facts **update that same proposal in place** rather than spawning a new
review item per email — verified against Scenario 1, which touches the same
transaction across four separate messages and produces exactly one pending
closing proposal, not four.

## Enabling the real integrations

All three integration paths are wired through provider factories, so
switching them on is configuration plus (for email) finishing an adapter —
no call sites change. Copy `.env.example` to `.env.local` first.

### 1. Real LLM extraction (implemented, needs a key)

`src/lib/ai/llm-provider.ts` is a complete implementation of the `AIProvider`
interface against a hosted model provider — real `fetch` calls, forced
tool-use for reliable structured output, and validation of every returned
field against the same enums the rule-based engine uses (bad values are
dropped with a warning rather than corrupting the database).

```bash
AI_PROVIDER=llm
AI_API_KEY=...
AI_MODEL=...      # optional
```

Falls back to the simulated engine with a console warning if the key is
missing, so a config slip can't take the app down. **Caveat:** no API key
was available in the build environment, so this code is written and
type-checked but has not been run against the live API. Expect to tune the
prompts after watching the first real extractions.

### 2. Gmail email (scaffold, not implemented)

`src/lib/email/gmail-provider.ts` implements the
`EmailProvider` interface's shape and contains per-method setup checklists
(OAuth app registration, required scopes, which endpoint to call, how to do
incremental sync via Gmail `history.list` / Graph delta queries, and how to
translate `MailboxSearchQuery` into each provider's search syntax — the
query translators are actually written). Every method currently throws
`NotImplementedError` with the suggested endpoint in the message.

`getActiveEmailProvider()` deliberately **falls back to mock with a warning**
even when `EMAIL_PROVIDER=gmail` is set, so the app can't half-work against
an unfinished adapter. Remove that guard once an adapter is real.

Note the interface is async (`Promise`-returning) specifically so real
network-backed adapters drop in without touching the pipeline.

## Connecting Outlook (Microsoft 365)

The Microsoft adapter is **implemented**, not a scaffold. What follows is
configuration, not development work.

> **Status caveat:** this code has never run against a live Microsoft
> tenant — none was available while building. The pure mapping layer is
> unit-tested against recorded Graph payloads (`tests/graph-mapping.test.ts`),
> but treat your first real connection as a debugging session. Budget an
> afternoon, not five minutes.

### 1. In the Entra admin center

If you already registered an app for something else, **register a separate
one** for this. Sharing an app registration across tools makes permissions
and revocation messy.

1. **Entra admin center → App registrations → New registration**
2. Name it something like `Keystone Closing Manager`
3. **Redirect URI**: select **Web**, enter
   `http://localhost:3000/api/v1/integrations/microsoft/callback`
   (for local testing; add your real HTTPS URL later)
4. Register, then copy the **Application (client) ID** and
   **Directory (tenant) ID** from the Overview page
5. **Certificates & secrets → New client secret** → copy the **Value**
   immediately (it's only shown once)
6. **API permissions → Add a permission → Microsoft Graph → Delegated**:
   - `Mail.Read`
   - `offline_access` — **do not skip this**; without it the connection
     dies after about an hour and can't renew itself
   - `User.Read`
7. If your tenant requires it, click **Grant admin consent**

### 2. Generate an encryption key

OAuth tokens are encrypted before they touch the database. Generate the key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Back this up somewhere safe. Losing it means every connected mailbox has to
be reconnected.

### 3. Fill in `.env.local`

Copy `.env.example` to `.env.local` and set:

```
EMAIL_PROVIDER=microsoft
MICROSOFT_CLIENT_ID=<Application (client) ID>
MICROSOFT_CLIENT_SECRET=<the secret Value>
MICROSOFT_TENANT_ID=<Directory (tenant) ID>
APP_ENCRYPTION_KEY=<the key you just generated>
```

Restart the app after editing this file.

### 4. Connect the mailbox

Sign in as an **admin**, then visit:

```
http://localhost:3000/api/v1/integrations/microsoft/start
```

You'll be sent to Microsoft's consent screen. Approve, and you'll be
redirected back to Settings. The app stores the encrypted tokens and records
which mailbox was connected in the audit log.

### 5. Pull mail in

```bash
curl -X POST http://localhost:3000/api/v1/integrations/microsoft/sync
```

This fetches new messages via Graph's delta query, caches them, and runs
each one through the AI pipeline. Proposals land in the review queue exactly
like the demo data. Run it on a schedule (cron, Task Scheduler) for now; a
Graph change-notification webhook can replace polling later.

**Start with one shared closing mailbox, not everyone's personal mail.**

### What could go wrong on first connect

| Symptom | Likely cause |
|---|---|
| Redirect URI mismatch error | The URI in Entra must match **exactly**, including `http` vs `https` and the trailing path |
| Works for an hour, then stops | `offline_access` was not granted — no refresh token |
| "needs to be reconnected" | Refresh token revoked (password change, admin action, or expiry) — re-run step 4 |
| Empty sync, no errors | The mailbox genuinely has no new inbox mail since the last delta |
| 429 errors | Graph rate limit; the adapter surfaces `Retry-After` rather than hammering |

### Deliberate scope limits

- **Read-only.** The app never sends, deletes, or modifies mail. Adding send
  capability would require the `Mail.Send` scope, which is intentionally not
  requested.
- **Inbox only** for delta sync. Sent mail is picked up when it appears in a
  fetched conversation, which is how task-completion detection sees replies.
  Syncing the Sent folder separately is a small addition if it turns out to
  matter.
- Messages are **cached into our database** rather than re-fetched each
  time, so evidence links stay stable even if a message is later deleted
  from the mailbox.

### 3. Phase 2 / Phase 3 automation (implemented and tested, off by default)

`src/lib/services/automation.ts` is a working confidence-threshold
auto-approval engine, not a stub. Every proposal the pipeline creates is
passed through `maybeAutoApprove()`, which:

- looks up the `AutomationRule` for that action type,
- no-ops if no rule exists, the rule is disabled, or confidence is below its
  threshold (**this is the Phase 1 default — all six seeded rules ship
  `enabled = 0`**),
- otherwise calls the *same* `approveReviewItem()` a human clicking Approve
  calls, so automation cannot bypass validation via a separate code path,
- marks the proposal `AUTO_APPROVED` (not `HUMAN_APPROVED`) and writes an
  audit event naming the rule and the confidence that triggered it.

Toggle rules from **Settings → Automation phase** in the UI, or via the API:

```bash
curl -X PATCH localhost:3000/api/v1/settings/automation \
  -H 'Content-Type: application/json' \
  -d '{"actionType":"TASK_CREATE","enabled":true,"minConfidence":0.9}'
```

The Settings banner flips from "Phase 1 — Approval only" to "Phase 2 —
Selective automation" as soon as any rule is enabled.

**Verified end to end:** with the rule disabled, an injected email's
`TASK_CREATE` proposal stayed `PENDING` in the review queue; after enabling
it at 0.8, the next injected email produced a live `OPEN` task with no human
approval and this audit entry: *"Auto-approved TASK_CREATE (confidence 88%
>= rule threshold 80%) — Phase 2/3 automation rule, no human in the loop for
this action."*

Phase 3 (auto-activating waiting tasks, auto-reminders, calendar sync) is
not built — but it extends this same evaluator rather than needing new
plumbing.

### Testing new email without a real provider

`POST /api/v1/dev/inject-email` simulates a message arriving in the mock
mailbox and runs it straight through the pipeline — this is the hook a real
provider webhook (Gmail push / Graph change notification) would call:

```bash
curl -X POST localhost:3000/api/v1/dev/inject-email \
  -H 'Content-Type: application/json' \
  -d '{"subject":"12 Oak St","body":"Please send the CPL.","fromAddress":"lender@example.com"}'
```

## What's still not built

- **Real Gmail/Microsoft adapters** — scaffolds with documented TODOs only
  (see above). This is the largest remaining gap.
- **Transaction merge/split** — the review queue surfaces duplicate
  candidates and links both transactions for comparison, but
  `POST /transactions/:id/merge` is not implemented.
- **Office deadline defaults are in-memory** — `src/lib/services/office-rules.ts`
  resets on restart. (Automation rules *are* persisted; these aren't yet.)
- **Phase 3 behaviors** — auto-activating waiting tasks, escalations,
  reminders, external calendar sync.
- **Gmail adapter** — still a scaffold. Outlook is implemented; Gmail is not.
- **Live-tenant verification of the Outlook adapter** — the code is written
  and its mapping layer is unit-tested, but it has not touched a real
  mailbox.

## Project structure

```
prisma/schema.prisma        canonical documented data model (Postgres target)
db/schema.sql                runtime schema (SQLite, same shape)
src/lib/db.ts                 query layer (swap for @prisma/client later)
src/lib/email/                EmailProvider interface, provider factory,
                               MockEmailProvider (working), gmail-provider
                               + microsoft-provider (scaffolds)
src/lib/ai/                   AIProvider interface, provider factory,
                               engine.ts (rule-based, working),
                               llm-provider.ts (real hosted-model API),
                               matching, process-email orchestrator
src/lib/auth/                 password hashing, sessions, route guards/RBAC,
                               AES-256-GCM encryption for OAuth tokens
tests/                        72 automated tests (npm test)
src/lib/services/             approval workflow, automation (Phase 2/3
                               engine), audit logging, office rules
src/middleware.ts             edge cookie gate (UX only — see Signing in)
scripts/manage-users.mjs      user administration CLI
src/lib/seed.ts               seed data for the 7 required scenarios
src/app/api/v1/                versioned API route handlers
src/app/                      pages (dashboard, board, transactions, tasks,
                               review, activity, settings, email evidence)
```
