# Handoff — forking Closewise into an independent Claude-built app

**Written 2026-08-04.** Read this first in any new session. It supersedes the
deployment plan in `CONTINUING.md` for anything concerning Closewise; that plan
still describes `closing-manager`, which is now a **parts donor**, not the
product.

Companion document: `docs/STATE-RECONCILIATION-2026-08-04.md` — the evidence
behind every claim about the current state.

---

## 1. What the owner actually wants

1. **Fork the ChatGPT-built Closewise into a Claude-built version** and move off
   the ChatGPT-hosted site `closewise-operations.jbargg.chatgpt.site` onto
   independently owned infrastructure.
2. **Run both in parallel.** Codex keeps working on the original; Claude Code
   works on the fork. **They must never share a folder, a name, a repository, a
   database, or a deployment.**
3. **An honest architectural judgement** — is the ChatGPT version
   over-engineered for a 15-person PA/NJ title agency?
4. **Use the newly available Microsoft Entra admin access** to connect the real
   work mailbox, with Claude Code driving as much of it as is safe.

---

## 2. The architecture verdict the owner asked for

Short answer: **partly, and in one place seriously.**

The strongest evidence is not any individual choice. It is that after eight
numbered gates, acceptance-evidence packets, clean-room restore procedures,
key-custody policies and RPO/RTO targets, **the application is still not live
and Gate 8 records FAIL.** The release process has become larger than the
product. A 15-person title agency needs a working tool, not a compliance
programme.

Component by component:

| Component | Verdict | Reasoning |
|---|---|---|
| **Cloudflare Workers + Vite + Next.js together** | **Drop. This is the serious one.** | Three build/runtime systems fighting each other. Workers has CPU-time limits and no long-running processes — the worst possible runtime for a job that reads an email through an AI model for several seconds. **Most of the other complexity below exists to work around this one choice.** |
| **Queues, dead-letter handling, job orchestration** | **Drop** | These are consequences of Workers, not of the business problem. A long-running Node server processing a loop with retries does the same work with a tenth of the moving parts. |
| **Graph webhooks + subscription renewal** | **Drop for now** | Saves ~5 minutes of latency and costs a public endpoint, validation tokens, 3-day subscription renewal, and missed-notification recovery. A scheduled sync every 5 minutes is indistinguishable to a human and has almost no failure surface. |
| **Graph delta sync** | **Keep — necessary** | This is how you avoid re-reading the whole mailbox. Not optional. |
| **Supabase (Postgres, Storage, Auth)** | **Keep** | Managed, sensible, already decided. |
| **Drizzle + versioned migrations** | **Keep** | Migrations are basic hygiene, not ceremony. |
| **Custom MFA + password auth + role matrix** | **Replace with Microsoft Entra sign-in** | The agency already has Entra. Signing in with Microsoft deletes an entire subsystem: no passwords to store or rotate, no separate MFA to build, no invite flow, and MFA becomes Entra's problem. **This is the largest single simplification available.** |
| **`organization_id` on records** | **Keep** | Costs nothing, and makes a second office or a future sale possible. |
| **Full RLS policy suite + cross-tenant denial tests** | **Defer** | Mandatory *if* the browser queries the database directly. Optional belt-and-braces if only the server does. Decide after the auth model is settled — it follows from it. |
| **Realtime subscriptions** | **Keep only if nearly free** | Supabase gives it cheaply. Don't build anything custom; refresh-on-focus covers most of the benefit. |
| **Attachment quarantine / honest failure states** | **Keep** | Genuinely correct. A document that can't be read must be visibly recorded, never silently skipped. |
| **Proposal-then-human-approval, evidence links, audit trail** | **Keep — this is the product** | Non-negotiable. |
| **Gate ceremony, acceptance packets, clean-room procedure** | **Defer until after it is live** | Right instincts, wrong order. Ship to a real mailbox, then harden. |

**Net effect:** roughly two-thirds of the operational machinery is removable
without touching a single user-facing capability. The target is a plain
long-running Next.js server on a normal host, talking to Supabase, syncing mail
on a schedule, with Microsoft handling sign-in.

**What to carry over from `closing-manager` (the parts donor):** its AI pipeline
has far more test coverage of the thing that actually matters — extraction,
conservative matching (the 60-point threshold tuned against a real false-merge
bug), fact supersession, redaction that never touches loan/file numbers, and the
one-checklist-is-one-task office rule. That domain logic is more valuable than
either app's infrastructure. See `CLAUDE.md` in that repo for the invariants.

---

## 3. Separation — non-negotiable, both agents run at once

Nothing may be shared. Concretely:

| | Codex keeps | Claude Code takes |
|---|---|---|
| Folder | `C:\Users\jbarg\Documents\Closewise` | **a new folder, new name** |
| Product name | Closewise | **new name — owner decides** |
| GitHub repo | `jbrggg/closewise-operations-recovery` | **a new private repo** |
| Git remotes | `origin` + `sites` (ChatGPT) | `origin` only — **`sites` remote must be removed** |
| Deployment | `closewise-operations.jbargg.chatgpt.site` | **independent host (Render)** |
| Database | whatever it uses today | **its own Supabase project** |
| Entra app registration | its own | **its own, separate registration** |
| Storage bucket | its own | **its own** |

**The `sites` remote must be deleted from the fork before the first commit.** If
it survives, a push could deploy the Claude fork over the ChatGPT site.

**Do not copy while Codex is writing.** `codex.exe` was running and wrote into
that tree at 21:31 on 2026-08-04. Copying a tree mid-write produces a fork that
compiles but is subtly inconsistent. Confirm the Codex session is idle or
stopped first.

Exclude from the copy: `node_modules`, `.git`, `.wrangler`, `dist`, `build`,
`.vinext`, `.openai`, `tsconfig.tsbuildinfo`, and any `.env*`.

---

## 4. What Claude Code can and cannot do on your screen

The owner has asked Claude Code to drive the Microsoft setup. Being precise
about the boundary, because it is not negotiable:

**Claude Code can:**
- Read the screen, navigate the admin centre, and read back exactly what is there.
- Fill in non-credential configuration — app registration name, redirect URIs,
  permission selections — with approval at each step.
- Run every local command, script, migration, test and deployment.
- Verify the deployed result in a browser.

**Claude Code will not, under any circumstances:**
- Type a password, or any credential, into anything.
- Complete an MFA prompt or a security-key challenge.
- Click **Grant admin consent** — that is a consent decision and it is the
  owner's.
- Create an account, or approve a paid resource.

**Practical limit:** desktop screen-control grants browsers *read-only* access —
Claude can see the browser but cannot click in it. Clicking inside a browser
requires the Claude-in-Chrome extension to be connected. Without it, the
workflow is: Claude reads the screen and says exactly what to click; the owner
clicks.

For every step, Claude prepares everything up to the exact screen requiring a
human, then asks for that one action and continues with other work meanwhile.

---

## 5. Order of work for the fork

1. **Confirm Codex is idle**, then snapshot-copy the tree to the new folder.
2. **Rename everything** — package name, product name, page titles, repo.
   Remove the `sites` remote. Create the new private GitHub repo.
3. **Get it running locally, unchanged**, and record what actually passes:
   `typecheck`, `test`, `lint`, build. This is the honest baseline — the Gate 8
   packet says most acceptance items are PARTIAL, so do not inherit its claims.
4. **Strip the Workers/Vite layer** down to a plain Next.js server. This is the
   biggest single change and unlocks every other simplification.
5. **Switch auth to Microsoft Entra sign-in.** Deletes passwords, MFA and the
   invite flow in one move.
6. **Point it at its own Supabase project**; run the migrations; verify.
7. **Replace webhooks/queues with a scheduled sync**, keeping delta.
8. **Deploy to Render** over HTTPS, on the free host address first.
9. **Connect the real mailbox** — read-only, `Mail.Read` + `offline_access` +
   `User.Read`, never `Mail.Send`. Then the safe first-contact sequence: fetch
   without spending, read ten messages, judge the output, measure the cost.
   `closing-manager` already has scripts for this shape (`sync --dry-run`,
   `process --limit`); port them.
10. **Then** harden: backups with a restore actually watched working, real
    accounts, monitoring.

Register **all** redirect URIs at step 9 while admin access is available —
localhost, the Render address, and the company domain. Adding one later needs an
administrator again.

---

## 6. Open decisions blocking the start

1. **The product name** for the fork.
2. **Which Supabase project** the fork uses. `CLAUDE APP`
   (`efhwjlhpnidwzbiribzt`) is ACTIVE_HEALTHY and **completely empty** — its
   tables belong to an unrelated app and hold zero rows. Repurposing it costs
   nothing but means dropping those tables. The alternative is a new project,
   and the Gate 8 packet records that Supabase's **two-active-free-project
   limit** has already been hit once.
3. **Confirmation that the Codex session is finished** with the Closewise tree.
4. **Agreement on the architecture simplifications** in section 2 — chiefly
   dropping Cloudflare Workers and moving sign-in to Microsoft Entra.

---

## 7. Standing rules carried into the fork

These came from `closing-manager/CLAUDE.md` and remain in force:

- **Approval-only.** No AI proposal becomes a live record without a human
  decision. Automation rules ship disabled.
- **Mail is read-only.** `Mail.Send` is never requested.
- **Never delete a fact.** Supersede and keep the old row; history is evidence.
- **Every fact and proposal links to a source email.** No orphans.
- **Matching stays conservative.** A shared surname or office must never link
  two files.
- **Never redact structured fact values** — loan and file numbers are matching
  keys.
- **Never commit secrets.**
- **Verify on Windows** before claiming a suite passes.
- **Never claim something works because the code exists or a command exited 0.**
  Verify at the layer a user depends on.
