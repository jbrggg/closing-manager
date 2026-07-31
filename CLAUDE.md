@AGENTS.md

# Project context for agents

Read this before changing anything. It exists so a fresh session doesn't
undo decisions that were made deliberately, or spend ten minutes
rediscovering the layout.

## What this is

An AI-assisted closing manager and task manager for a small title agency
operating in Pennsylvania and New Jersey. It reads email, extracts facts
about real-estate closings, proposes closings and tasks, and routes every
proposal to a human review queue.

**This application is the system of record.** Not Google Calendar, not
Microsoft 365 Calendar, not Qualia/SoftPro/TitleExpress. External calendars
are an optional future adapter, never the primary write target.

The user is **not a developer**. Explain things plainly, and never assume
they can read code to check your work.

## Where things are

| If you need to... | Go to |
|---|---|
| Change what the AI is asked | `src/lib/ai/llm-provider.ts` — the prompt strings near the top |
| Change the free fallback word-matcher | `src/lib/ai/engine.ts` |
| Change which provider is used | `src/lib/ai/index.ts` (reads `AI_PROVIDER` from `.env.local`) |
| Understand the whole pipeline | `src/lib/ai/process-email.ts` — read this first, it orchestrates everything |
| Change how emails get filed together | `src/lib/ai/match.ts` — **see invariant 4, ask before touching** |
| Change what happens on Approve | `src/lib/services/approval.ts` |
| See the settlement board / review queue UI | `src/app/board/`, `src/app/review/` |
| Test the AI on real email | `evals/` + `npm run eval` — read `evals/README.md` |
| Add a database table | `db/schema.sql` (runtime) **and** `prisma/schema.prisma` (documentation) |
| Query the database | `src/lib/db.ts` — hand-written SQL, not an ORM |

## Commands

```bash
npm install          # setup
npm run dev          # start the app at http://localhost:3000
npm run verify       # type check + tests + linter, all at once  <- use this
npm run verify:full  # the above plus the production build
npm run eval         # score the AI against the real emails in evals/cases/
npm run eval -- --simulated   # same, using the free word-matcher, costs nothing
```

Demo sign-in: `dana@keystonetitle.com` / `KeystoneDemo2026!` (published, not
a secret, must be rotated before real use).

## Current state

Working and verified:
- Full UI: dashboard, settlement board, transactions + detail, tasks,
  review queue, email evidence viewer, AI activity log, settings, Email
  Test Lab
- Authentication: scrypt passwords, opaque server-side sessions, RBAC
- AI pipeline: extraction → mailbox search → weighted matching → proposals
  → review queue → approval → live records → audit trail
- Real Anthropic-backed AI provider — first run successfully against the
  live API on 2026-07-31 (roadmap A2)
- 98 automated tests, all passing (`npm test`)
- Accuracy scorecard (`npm run eval`) — runs the real pipeline headless,
  no server and no browser required
- Outlook/Microsoft Graph adapter: implemented, NEVER run against a live
  tenant
- Phase 2/3 automation engine: implemented, all rules ship disabled

Not built:
- Gmail adapter (scaffold only, throws NotImplementedError)
- PostgreSQL migration (runs on SQLite via node:sqlite)
- Transaction merge/split
- Persisted office deadline defaults (currently in-memory)
- Deployment/hosting

## Invariants — do not break these without explicit human approval

1. **Phase 1 is approval-only.** No AI proposal may become a live record
    without a human decision. `AutomationRule` rows ship `enabled = 0`.
    Do not enable any of them.
2. **Never delete a fact.** When information changes, mark the old
    `ExtractedFact` row `SUPERSEDED` and insert a new one. History is
    evidence.
3. **Every fact and proposal links to a source email.** No orphans.
    There is a test asserting this.
4. **Matching is deliberately conservative.** A shared surname or a shared
    office location must never be enough to link two transactions. The
    60-point threshold and the individual weights in
    `src/lib/ai/match.ts` were tuned against a real false-merge bug.
    If you change them, the regression tests in `tests/match.test.ts`
    must still pass.
5. **Approval attribution comes from the session**, never from a request
    body. `decidedByUserId` must be the actually-signed-in user.
6. **The email adapter is read-only.** Never request `Mail.Send`. The app
    does not send, delete, or modify mail.
7. **Never commit secrets.** Tokens are encrypted at rest via
    `src/lib/auth/crypto.ts`. `.env.local` is gitignored and stays that way.
8. **Do not reword the extraction prompt without re-running `npm run eval`.**
    The "never add an AM/PM marker" sentence in `llm-provider.ts` is a fix
    for an observed defect, and `tests/llm-provider.test.ts` asserts it is
    still there.
9. **One lender checklist is one task.** Office rule, decided 2026-07-31 by
    the owner. When one party sends a list of requirements, conditions or
    documents for a single purpose, the AI raises ONE request naming the
    list — not one per bullet. Genuinely separate asks (send the CPL *and*
    confirm the payoff) still split. Both halves are asserted in
    `tests/llm-provider.test.ts`; don't loosen either without asking.

## Verification — required before claiming any milestone is done

```bash
npm run verify       # type check + tests + linter (parallel, ~12s)
```

Before shipping anything user-facing, also:

```bash
npm run verify:full  # adds the production build
```

If you add a feature, add tests for it. If a test fails, decide honestly
whether the code or the test is wrong — during the original build, writing
tests revealed that an assumption in the *test* was wrong (address-alone
matching), not the code.

If you change anything about how the AI reads email, run `npm run eval`
as well and report the before/after score.

## Things that are true and easy to get wrong

- **Node 22.5+ required** — uses the built-in `node:sqlite` module.
- **`node:sqlite` returns null-prototype rows.** They must be spread into
  plain objects before crossing a Server→Client Component boundary or
  Next.js throws. `src/lib/db.ts` already does this; don't undo it.
- **scrypt needs an explicit `maxmem`** at N=32768 or Node throws a memory
  limit error.
- **The demo password is published** in the README. It is not a secret and
  must be rotated before real use.
- `prisma/schema.prisma` is the canonical documented model, but Prisma is
  **not installed** — it was removed from `package.json` on 2026-07-31
  because it was 182 MB of an 874 MB install and nothing imported it.
  Bring it back with `npm install -D prisma @prisma/client` when starting
  roadmap task C1 (Postgres). Don't `import` from it before then.
- **The LLM provider makes one API call per message, not one per question.**
  `extractFacts` / `detectRequests` / `detectCompletionSignal` all read from
  a single cached call, warmed by the optional `prefetchAnalysis()`. If you
  add a fourth question, add it to that one call — don't add a second call.
- **Tests never touch the network.** `tests/llm-provider.test.ts` and
  `tests/pipeline-llm.test.ts` stub `fetch`. Verified on 2026-07-31 by
  running the suite inside a no-network sandbox with a real key present.

## Quirks learned the hard way (each one cost a failed attempt)

- Remote/agent file bridges **refuse to write `.env*` files**. The human has
  to create `.env.local` themselves. Give them a script to double-click, not
  a Save As dialog to navigate — Windows Save As is where this went wrong
  once already.
- **Resetting demo data also wipes login sessions.** Any script that resets
  then keeps clicking must sign in again afterwards.
- Every test file shares one database. If a test's call counts depend on an
  empty mailbox, clear the tables in `beforeEach` — see
  `tests/pipeline-llm.test.ts`.
- Re-running the same email against the same database looks like a failure
  but isn't: the dedup/supersession system correctly skips facts it already
  knows. Reset between runs, or use `npm run eval`, which isolates each case.
- Some sandboxes cannot run `next build` or bind a port at all, and some
  block outbound API calls. If the app "can't start" in an agent
  environment, verify with `npm run verify` and `npm run eval --simulated`
  and hand the browser check to the human — don't burn time fighting it.

## How to talk to this user

- Plain English, no jargon. If a term is unavoidable, define it inline.
- Never tell them to run a `curl` command as the primary way to do
  something — build a UI page or an npm script instead. This mistake was
  already made once and corrected with the Email Test Lab.
- Be direct about what is unverified. The Outlook adapter has never touched
  a real mailbox; say so every time it comes up.
- Do not claim production readiness.

## Standing decisions (don't re-ask these)

- Testing may run in the agent's own workspace; the API key may be copied
  there privately but must never be displayed.
- The API key lives only in `.env.local` on the user's machine.
- Automated tests must never make real API calls.
- Prefer a checked-in script over a manual multi-step procedure, every time.
