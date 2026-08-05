# State reconciliation — 2026-08-04

Written before any code was changed, in response to a prompt instructing an
agent to "continue the existing Closewise application" and rebuild "the
application in your current repository" to match
`Closewise_Visual_Interface_Recreation_Guide.docx`.

**Outcome: work was halted and a question put to the owner.** The two
instructions above point at two different applications. Acting on either
assumption without confirmation would waste days.

Everything below was directly observed. Nothing is quoted from older
documentation.

---

## Finding 1 — Closewise is a separate, more advanced application

It is **not** this repository.

| | This repo (`closing-manager`) | Closewise |
|---|---|---|
| Path | `C:\Users\jbarg\Downloads\closing-manager` | `C:\Users\jbarg\Documents\Closewise` |
| GitHub | `jbrggg/closing-manager` | `jbrggg/closewise-operations-recovery` (private) |
| Deployed | No | **Yes** — `https://closewise-operations.jbargg.chatgpt.site`, Sites v73 |
| Branch | `main`, clean | `codex/recover-closewise-v65`, 11 ahead of `sites/main` |
| Stack | Next.js, SQLite (`node:sqlite`), hand-written SQL, npm | Next.js + Vite + Cloudflare Workers, Supabase, Drizzle, pnpm |
| Database | one local file | 9 Supabase migrations, incl. Graph foundation and realtime |
| Tests | 350 (vitest) | 26 test files (`node --test`) |
| Multi-tenancy | none | organizations, RLS, MFA, role matrix |
| Graph/Outlook | adapter written, never run live | webhooks, delta, dead-letter, quarantine — tested deterministically |

Closewise already contains most of what the new prompt asks to build:
multi-tenant identity, RLS, real-time workspace, Graph webhook and delta
recovery, attachment extraction with quarantine, proposal-only AI boundaries,
MFA-gated approvals, and a clean-room verification workflow.

## Finding 2 — Closewise is at Gate 8, recorded FAIL, Gate 9 blocked

From `Closewise/docs/GATE_8_ACCEPTANCE_EVIDENCE_2026-08-04.md`, dated today:

- Candidate commit `75fe9d2`, tag `gate8-rc3-2026-08-04`, rollback target
  hosted version 63.
- Most acceptance items are **PARTIAL** — deterministic tests pass, live
  verification against the real mailbox and authenticated multi-user sessions
  has not run.
- Two **FAIL** items: simultaneous-device/independent-session acceptance never
  ran; and Gate 7 backup/restore has no immutable backup or clean-room restore
  receipt because **the owner-held source database connection secret is
  absent**.
- A zero-cost backup project was rejected by **Supabase's two-active-free-project
  limit**.

The blocker there is an owner-held secret and a live verification pass — not
missing code.

## Finding 3 — another agent is working in that tree right now

`codex.exe` processes started 2026-08-04 20:38 and 20:47. Files under
`Documents\Closewise` were written at 21:31, including
`app/lib/supabase/workspace-live.ts` and Cloudflare Workers runtime state.

**Two agents editing one working tree would corrupt both efforts.** Nothing
should be written there until that session is known to be finished.

## Finding 4 — there is a second copy of this repo, and it is the one running

A `next dev` server has been running since 08:02 today from
`C:\Users\jbarg\Desktop\closing-manager` — **not** from
`C:\Users\jbarg\Downloads\closing-manager`, which is where this session's two
commits were made and pushed.

Both push to the same GitHub remote, so the commits are safe. But anything
looked at in a browser today came from the Desktop copy, which may be behind.

## Finding 5 — corrections to the briefing

| Briefing said | Actually observed |
|---|---|
| The Supabase project is paused (`INACTIVE`) | Project `CLAUDE APP` (`efhwjlhpnidwzbiribzt`) is **ACTIVE_HEALTHY**, Postgres 17.6, us-east-1 |
| Supabase is the database for this app | Its schema is a **different application** — `recipes`, `forms`, `clause_library`, `variable_sheets`, `field_maps`, `provenance`. Every table has **0 rows**. Closewise's own 9 migrations are **not** applied to it. |
| No Supabase connector is available to an agent | One **is** available now, and was used to establish the two rows above. This supersedes the note in `CONTINUING.md`. |
| `prisma.compute.json` needs deleting | Already deleted in `bb53dfa`. |

Only one Supabase project exists in that account. Closewise's live data is
therefore somewhere else — Cloudflare D1 is present in its local runtime state.

---

## Why this halted work

The prompt requires identifying "the most advanced trustworthy checkpoint" and
warns: *"Do not begin by editing an older export when a newer authoritative
source exists."*

On the axes that prompt cares about — deployment, Postgres, RLS, multi-tenancy,
Graph webhooks, real-time, backup evidence — **Closewise is the more advanced
checkpoint and this repository is the older one.** Rebuilding this repository's
interface to imitate Closewise would produce a second, less capable copy of an
application that already exists and is already deployed, and would consume the
seven-day window doing it.

The opposite reading is also possible: that the owner intends to abandon
Closewise and carry its design into this codebase, which is simpler, has far
more test coverage of the AI pipeline, and which the owner has been working on
directly.

Both readings are reasonable. They lead to completely different work. That is a
product decision with materially different outcomes, which the prompt itself
reserves for the owner.

## What was NOT done, deliberately

No file in `Documents\Closewise` was modified. No Supabase migration was
applied. No schema was created. No deployment was touched. No UI rebuild was
started in either repository. The only writes this session were the two
already-pushed commits in this repo (`b07a8ed`, `b16d9ef`, `bacf374`) plus this
document.
