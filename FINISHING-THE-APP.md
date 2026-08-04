# Finishing the app — the whole road, in plain English

Written 2026-08-01. No jargon. Where a term is unavoidable it's explained
where it first appears.

---

## First, a correction worth making

You asked about adding "a database, backend, file storage, connection to the
UI, and deployment." Three of those five already exist and have for a while.
Here's the honest state:

| Piece | Status |
|---|---|
| **Database** | ✅ Built. SQLite — a database that lives in one file on your computer. 20+ tables. |
| **Backend** | ✅ Built. 25+ API endpoints, the AI pipeline, the approval workflow, the audit trail. |
| **UI connected to it** | ✅ Built. Every screen reads live data. You clicked through it yourself. |
| **File storage** | ✅ **Built today.** See below. |
| **Deployment** | ❌ Not done. This is the real remaining gap. |

So this isn't a half-built app that needs its foundations. It's a working app
that runs on one computer and needs to become one that runs on a server.

---

## What I built today

**Document storage.** This was the genuine hole. The app knew that a file was
attached to an email — its name, its type, its size — and then threw the file
away. For a title agency that's most of the job missing. The HUD, the CPL, the
commitment, the search package: those *are* the work. A closing record that
links to "Commitment.pdf" and can't produce it is a filing cabinet full of
empty folders.

Now the files are kept. Three things worth knowing about how:

- **Files are named after their contents.** Every document gets a fingerprint
  (a "hash") calculated from its bytes. Two identical files have identical
  fingerprints. So when the same commitment PDF gets forwarded five times
  across a thread, it's stored **once** — and "is the HUD the lender approved
  the same one we sent?" becomes a fingerprint comparison instead of an
  opinion.
- **Files are not in the database.** They sit in a `storage/` folder. Putting
  PDFs inside SQLite would bloat it, slow every backup, and make the move to a
  real database much heavier later.
- **Swapping to cloud storage later is a config change**, not a rewrite. The
  code asks for "the document store" rather than "the local disk," the same
  way it asks for "the AI provider" rather than naming one vendor.

**Attachments now survive email import.** `npm run import` pulls files out of
your exported emails and stores them.

**The dashboard shows whether the mailbox is alive.** Last sync time, what it
did, and any error. This matters because a scheduled sync that quietly stopped
running looks *exactly* like a quiet mailbox — you'd never notice.

Tests went 278 → 292, all green on Windows.

---

## Your next step — 5 minutes

Just look at what's there:

```
npm run dev
```

Open **http://localhost:3000** and check the **Mailbox** panel on the
dashboard. It should say "Sample data — no real mailbox connected." That's the
new panel, and it's the thing that'll tell you the truth once a real mailbox is
attached.

That's genuinely all I need from you right now. Everything below is the map,
not homework.

---

# The road to a finished app

Five stages. Each says what it is, why it matters, who does it, and roughly
how long.

---

## Stage 1 — Prove the AI reads your email correctly

**Status: this is where you actually are.** Everything downstream is wasted
effort if the AI can't read your mail.

**What:** forward 15–25 real emails to a test Gmail account, export them, run
`npm run import`, review what the app did. Full instructions are in
`GMAIL-TEST.md`.

**Why first:** you're about to spend real time and money on hosting. Find out
whether the core works before paying to run it.

**Who:** you, mostly. ~30 minutes.

**Done when:** you've looked at 20 emails' worth of output and believe it.
The formal bar is 15 of 20 fully correct.

---

## Stage 2 — Connect the real mailbox

**What:** register an app in Microsoft Entra so the software can read your
Outlook mail, then connect it.

**Why:** until this happens, someone has to feed the app manually. This is the
step that turns it from a demo into a tool.

**Who:** you do the portal work; I do everything around it. All the tooling
already exists:

```
setup.cmd          double-click, paste four values, done
npm run preflight  tells you exactly what's wrong if it fails
npm run sync       pulls mail with no browser open
```

`preflight` is the important one. This adapter has never touched a live
tenant, and the first connection usually fails. Rather than a generic
"401 Unauthorized," it tells you *which* thing is wrong — bad secret, wrong
tenant, missing permission, or consent not granted.

**Time:** ~15 minutes of portal work, then budget an afternoon for the first
connection to misbehave.

**Done when:** `npm run sync` pulls real messages and proposals appear in the
review queue.

---

## Stage 3 — Move the database to a real one

**What:** move from SQLite (one file on your laptop) to PostgreSQL (a database
running on a server). Supabase is the easy option and you already have an
account.

**Why it is NOT urgent:** for one person on one computer, SQLite is genuinely
fine. It's a real database, not a toy. **Don't do this until Stage 5 forces
it** — a server can't use a file on your laptop.

**Why it becomes necessary:** the moment a second person needs access, or the
app lives anywhere but your machine.

**Who:** mostly me. You create the Supabase project and hand me a connection
string.

**What's involved:** the design file (`prisma/schema.prisma`) already
describes every table in PostgreSQL terms — that work is done. What's needed
is installing the database tool, running the migration, and swapping the query
layer. One file (`src/lib/db.ts`) is the seam; everything else is untouched.

**Time:** half a day, most of it verifying nothing broke.

---

## Stage 4 — Move documents to cloud storage

**What:** move the `storage/` folder to Supabase Storage or Amazon S3.

**Why:** same reason as Stage 3. A server doesn't have your `storage/` folder.

**Who:** me, entirely — once you've made a bucket.

**What's involved:** one new file implementing the same interface the local
store already implements, plus a line in the factory. That's it, because
today's work was built for this swap.

**Time:** 2–3 hours including tests.

---

## Stage 5 — Deployment

**What:** put the app on a computer that's always on, so it works when your
laptop is closed and other people can use it.

**Why last:** everything above is cheaper and easier to fix on your own
machine. Deploy a thing that works, not a thing you hope works.

**Who:** together. You create accounts and click through consent screens; I
configure everything.

**The pieces, in order:**

1. **Somewhere to run it.** Vercel is the natural fit for this kind of app and
   has a usable free tier. A small always-on server (Railway, Render, a
   $10/month virtual machine) also works and gives more control.
2. **HTTPS.** Non-negotiable, and not optional in a technical sense either:
   the app's sign-in cookies refuse to travel over an unencrypted connection
   in production. Every host above provides this automatically.
3. **Rotate the demo password.** `KeystoneDemo2026!` is printed in the README.
   It must be replaced before the app holds one real client email. There's a
   command for it: `npm run users`.
4. **Real accounts for real people.** Same command. Deactivate the three demo
   ones.
5. **Scheduled sync.** So mail arrives without anyone pressing anything.
   Windows Task Scheduler on your machine, or a cron job on the server.
6. **Backups.** The app is the system of record for closings. Supabase does
   automatic backups; you need to know the restore procedure works, which
   means testing it once.

**Time:** a day, spread across waiting for DNS and consent screens.

---

## What's deliberately NOT on this list

Things that look like gaps and aren't worth doing yet:

- **A Gmail adapter.** Outlook is your real target. The import path covers
  Gmail for testing.
- **Transaction split.** Merge is built and reversible, which covers the real
  case. Split when something demands it.
- **Turning on automation.** The AI proposes and you approve, deliberately.
  Loosen that only once you have months of evidence, one action type at a
  time. `Settings → Automation phase` is where it lives, and everything ships
  switched off.
- **A phone app.** The desktop layout works on a tablet. Build this when
  someone actually asks.

---

## Three known gaps, written down so they aren't forgotten

These came out of your own emails. Each is real, none is blocking:

- **D5 — your outgoing requests raise nothing to chase.** When you email an
  underwriter asking for a corrected CPL, the app records the facts and creates
  no task. The obligation is invisible until they reply. Four of your 22 real
  emails hit this. Needs a decision from you before building, because today
  "our sent mail raises no tasks" is a deliberate safety property.
- **D6 — wire notifications have nowhere to go.** They ask for nothing, so no
  task is raised and the notification vanishes. They need their own
  Disbursements section, matched to a file by the memo field.
- **A4 — incoming vs outgoing is decided per mailbox, not per person.** You
  already flagged this. The same internal email is outgoing for the sender and
  incoming for the recipient. Decided; deferred until real mailbox data shows
  how much internal mail actually flows.

---

## The shortest honest summary

You have a working application. It reads email, extracts facts, files them
against properties, proposes work, keeps evidence for everything, and now
keeps the documents too.

**What stands between here and daily use is not construction. It's
connection** — one Microsoft registration — **and confidence** — 20 emails
you've checked yourself.

Hosting, PostgreSQL and cloud storage matter when someone *else* needs to use
this. For you, on your machine, they're optional. Don't let them block you.
