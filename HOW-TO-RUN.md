# How to Run This — Plain English Guide

Written assuming you have never run a program from source before. Nothing
here requires you to write code. You will type a few commands exactly as
shown.

Total time the first time: about 15 minutes, most of it waiting on a
download.

---

## Step 1 — Install Node.js (one time only)

This app is written in JavaScript. Node.js is the free program that runs
JavaScript on your computer. Think of it like needing Adobe Reader before
you can open a PDF.

1. Go to **https://nodejs.org**
2. Download the version labeled **LTS** (Long Term Support)
3. Run the installer, click Next through it, accept the defaults

**Important:** you need Node version **22.5 or newer**. The LTS download
will be fine. We'll verify in Step 3.

---

## Step 2 — Unzip the project somewhere you can find it

Unzip `closing-manager.zip`. Put the resulting `closing-manager` folder
somewhere memorable, like your Desktop or Documents.

You should now have a folder called `closing-manager` containing folders
named `src`, `db`, `prisma`, and files like `package.json`.

---

## Step 3 — Open a terminal in that folder

A "terminal" is a window where you type commands instead of clicking.

**On Windows:**
- Open the `closing-manager` folder in File Explorer
- Click the address bar at the top, type `cmd`, press Enter
- A black window opens, already pointed at the right folder

**On Mac:**
- Open the `closing-manager` folder in Finder
- Right-click the folder → Services → **New Terminal at Folder**
- (If you don't see that option: open Terminal from Applications →
  Utilities, type `cd ` with a space, then drag the folder into the window
  and press Enter)

**Verify Node installed correctly.** Type this and press Enter:

```
node --version
```

You should see something like `v22.5.0` or higher. If you see an error or a
number lower than 22.5, redo Step 1.

---

## Step 4 — Download the app's building blocks (one time, ~2 minutes)

Type this and press Enter:

```
npm install
```

You'll see a lot of text scroll by. This is downloading roughly 450 small
open-source libraries the app depends on. It's normal and it's noisy.

**You may see warnings in yellow about "vulnerabilities."** For local
testing this is fine and expected — nearly every project shows these. Don't
worry about them now.

Wait until you get your cursor back and can type again.

---

## Step 5 — Start the app

Type this and press Enter:

```
npm run dev
```

After a few seconds you'll see something like:

```
▲ Next.js 16.2.10
- Local:  http://localhost:3000
✓ Ready in 1.2s
```

**Leave this window open.** Closing it stops the app. This window is now the
"engine" — you'll go look at the app in your browser instead.

---

## Step 6 — Open it in your browser

Go to: **http://localhost:3000**

You'll land on a sign-in screen. Use:

- **Email:** `dana@keystonetitle.com`
- **Password:** `KeystoneDemo2026!`

That's the admin account. You're in.

---

## Step 7 — What to look at first

Here's the tour I'd take, in this order:

**1. Review Queue** (left sidebar) — This is the heart of it. You'll see
nine items the AI proposed from the fake emails. Click one. On the right
you'll see the actual email it read and why it proposed what it did.

Try clicking **Approve** on one. Then go to:

**2. Settlement Board** — the closing you just approved now appears here as
a real scheduled closing. That's the whole loop: email → AI proposal →
your approval → live record.

**3. Transactions** → click any property → this is the full operational
record. Scroll to **Extracted facts** to see every fact with its confidence
score and a link to the email it came from.

Look at **123 Oak Lane** specifically. You'll see a "Superseded facts"
section showing the old 10:00 AM time crossed out and preserved after the
reschedule to 3:00 PM. Nothing gets silently overwritten.

**4. AI Activity Log** — every single thing the AI did, in order. This is
the audit trail.

**5. Tasks** — the tasks the AI pulled out of email requests.

**6. Settings** → **Automation phase** — currently "Phase 1: Approval only."
This is where you'd eventually let the AI act on its own. Leave it alone
for now.

---

## Step 8 — Stopping and restarting

**To stop:** click on the terminal window and press `Ctrl` + `C`
(that's `Ctrl`, not `Cmd`, even on a Mac).

**To start again later:** open a terminal in the folder again (Step 3) and
type `npm run dev`. You don't need to repeat `npm install`.

---

## Things that might go wrong

**"npm is not recognized" / "command not found: npm"**
Node.js didn't install, or your terminal was open before you installed it.
Close the terminal, open a new one, try again. If it still fails, redo
Step 1.

**"Port 3000 is already in use"**
Something else is using that door. Run this instead:
```
npm run dev -- -p 3001
```
Then use http://localhost:3001 in your browser.

**The page says "This site can't be reached"**
The terminal window probably isn't running. Check that it says "Ready" and
that you didn't accidentally close it or press Ctrl+C.

**I want to start the demo data over**
Sign in as Dana (the admin), go to the Dashboard, and click **Reset demo
data** in the top right. Everything returns to its original state.

**I forgot the password**
It's in this file and in the README: `KeystoneDemo2026!` for all three demo
accounts.

---

## The most important thing to do: test it on YOUR real emails

Everything above uses nine fake emails I wrote. They're clean and tidy.
Your actual email is messier — forwarded chains, typos, missing subject
lines, three questions crammed into one paragraph.

**Before anyone spends weeks connecting Outlook, find out whether the AI
actually understands how your office writes.**

There are two ways to do this, and you'll probably use both.

### The fast way — the scorecard (do this for all 20–30 emails)

Put your emails into the `evals/cases/` folder once, along with what the
right answer should be, then run one command:

```
npm run eval
```

It reads every email, runs each one through exactly the same machinery the
app uses, and prints a scorecard — what it got right, what it missed, what
it invented, and whether it filed each email under the right property. Then
it saves the same report to `evals/last-run.md` so you can read it later
without a terminal open.

Twenty-five emails takes under a minute and costs a few cents.

**Full instructions, with a fill-in-the-blank template: `evals/README.md`.**

The reason this matters isn't just speed. Once your emails are in that
folder, they stay there. Every time anyone changes how the AI is
instructed, all 25 get re-scored automatically, and you find out
immediately if a change that fixed one email broke three others.

### The hands-on way — the Email Test Lab (good for one-offs)

1. Start the app and sign in (Steps 5–6 above)
2. Click **Email Test Lab** in the left sidebar
3. You'll see a form on the left with three boxes:
   - **Who sent it** — the sender's email address (e.g. `jsmith@lender.com`)
   - **Subject line** — copy the subject from the real email
   - **Email body** — copy and paste the text of the email
4. Choose **Someone sent it to us** or **We sent it** (this matters —
   see below)
5. Click **Analyze this email**
6. Results appear on the right within a second or two

**Before you paste: take out Social Security numbers, bank account or wire
details, and dates of birth.** Names and property addresses are fine and are
exactly what the AI needs to be judged on. Everything you paste is stored in
this app's local database file on your own computer.

### Why "who sent it" matters

The AI treats the two directions completely differently:

- **Someone sent it to us** → it looks for *requests* ("please send the
  commitment") and turns them into tasks
- **We sent it** → it looks for *completions* ("attached is the
  commitment") and proposes marking a task done

Pick the wrong one and it'll look broken when it isn't.

### How to read the results

Three panels appear on the right:

**"What the AI understood"** — every fact it pulled out, with a confidence
percentage. Check for two kinds of error: things it *missed* (a property
address that was right there) and things it *invented* (a date that isn't
in the email).

**"What it wants to do about it"** — the tasks or closings it proposes.
Check whether it correctly noticed someone was asking for something, and
whether it split multiple requests into separate tasks.

**"Which file it filed this under"** — whether it recognized this belongs
to an existing property file or started a new one. Filing an email under the
wrong property is the most damaging mistake it can make.

### Keep score

Run **20 to 30 real emails** — via `npm run eval` if you want the tally done
for you, or by hand in the Test Lab. For each one, check whether it got all
three right: facts, requests, filing.

- **15+ out of 20 fully correct** → the approach works, proceed to Outlook
- **Below 15** → the AI's instructions need tuning. They live in
  `src/lib/ai/llm-provider.ts`. Change them, re-run `npm run eval`, and
  compare. Don't build the email connection on top of a brain that can't
  read your mail.

### Starting over

The test emails accumulate in your demo data. To wipe them: go to the
**Dashboard** and click **Reset demo data** (top right). You must be signed
in as Dana, the admin.

---

## What I already found when I tested this

I ran one realistically messy email through it myself:

> Subject: `RE: RE: FW: Kowalski / 88 Rosewood`
>
> "Hi - circling back on this one. We still dont have the CPL and
> underwriting is asking. Also can you confirm the payoff was ordered?
> Borrower is asking about Thursday at 10, does that still work for the
> Cherry Hill office? Loan #LN-44821. Thanks"

**It got right:** the loan number, the Cherry Hill office, Thursday, the
payoff question as a task, and the scheduling question as a task.

**It missed four things:**

1. The **property address** — "88 Rosewood" has no "Street" or "Ave" on it,
   and the current word-matching rules require one
2. The **buyer name** "Kowalski" — it was in the subject line with no
   "buyer:" label next to it
3. The **CPL request** — "we still dont have the CPL" was missed because
   the rule looks for "don't" with an apostrophe
4. The **time** — "Thursday at 10" was missed because the rule expects
   "10:00 AM"

Because it never found the address, it filed the email under a brand-new
empty transaction instead of the real one.

**This is not a bug to patch — it's the expected result**, and it's the
whole reason to run this test. The current engine matches literal word
patterns, so it will keep failing on ordinary human variation forever. No
amount of tweaking fixes that category of problem.

It is the clearest possible argument for switching on the real AI
(README → "Enabling the real integrations", step 1 — an API key and two
lines of configuration). A real language model reads "still dont have the
CPL" the way you do.

Run your own 20 emails and I'd expect a similar pattern.

---

## Checking the app is healthy (optional, but nice to see)

One command runs everything:

```
npm run verify
```

It checks three things at the same time and prints a single verdict:

```
  OK   Type check         4.7s
  OK   Tests             11.1s
  OK   Linter             6.2s

Everything passed.
```

"Tests" is 98 automated checks of the app's logic. They're what protects the
app from breaking when someone changes it later — and none of them ever call
the real AI, so running them costs nothing.

`npm run verify:full` does the same and also builds the production version,
which takes longer and is only needed before putting the app on a server.

---

## What you're looking at vs. what's real

To be clear about what this demo is:

| What you see | What it actually is |
|---|---|
| The emails | **Fake.** Nine sample emails I wrote to demonstrate seven situations |
| The AI reading them | **A word-matcher**, not a real AI (yet) |
| The screens, workflow, approvals | **Completely real and working** |
| The audit trail, confidence scores, evidence links | **Completely real** |
| The database | **Real**, but a simple local file meant for one computer |

The building is finished. Connecting it to your real Outlook and a real AI
is the remaining work — see the README section "Connecting Outlook."
