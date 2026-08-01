# Testing on real email this weekend, without Entra

Written 2026-07-31. Entra is a Monday job; this is how you get real mail
through the app before then. Nothing here needs a Google Cloud project, an
OAuth consent screen, or any portal work at all.

Total time: about 15 minutes of your effort, most of it forwarding emails.

---

## Why forwarding needed a fix first

Your plan was to forward work email to a test Gmail account. That would not
have worked, for two reasons that both fail silently — you'd have gotten
results that looked plausible and were wrong.

**1. Everything would have been marked INCOMING.** The app decides incoming
vs outgoing by comparing who sent the email against the mailbox it's reading.
When you forward, *you* are the sender. So an email your office sent would
arrive looking like one you received — and the AI would hunt your own sent
mail for requests and raise tasks from it.

**2. The email would have arrived empty.** The app splits a message into "what
this says" and "what it's quoting", and only reads the first part. On a
forward, the quoted part *is* the message. Type "fyi" above a forward and the
AI would see three characters where a closing instruction used to be.

Both are fixed. The app now reads the forwarded header block, recovers who
originally sent it, and keeps the whole text. This was worth doing regardless
of the test — plenty of your real threads are internal forwards, and those are
the ones carrying the actual work.

---

## Step 1 — Tell the app which addresses are yours (2 minutes)

This is the piece that makes direction work. Open `.env.local` in Notepad and
add a line listing your own email domains, separated by commas:

```
ORG_EMAIL_DOMAINS=aglobaltitleagency.com,psatitle.com
```

Anything sent **from** those domains is treated as OUTGOING. Everything else
is INCOMING. If some of your staff use an address on a different domain, add
them individually:

```
ORG_EMAIL_ADDRESSES=someone@othercompany.com
```

Without this the app has no way to tell your mail from anyone else's, and it
will say so when you run the import.

---

## Step 2 — Forward the emails (10 minutes)

Forward 15–25 real emails to your test Gmail account. Pick a spread:

- some you **received** (lender requests, broker orders, examiner reviews)
- some you **sent** (your replies, documents going out, requests to the underwriter)
- at least a few **long quoted chains** — those are where it struggles most
- one or two **automated blasts** (CD packages, wire notifications)

Forward them normally. You don't need to strip anything or write a note.

---

## Step 3 — Get them onto your computer

**The quick way, for a handful:** in Gmail open a message → three dots at the
top right → **Show original** → **Download Original**. That saves an `.eml`
file. Repeat per email.

**The better way, for twenty-plus:** go to
[takeout.google.com](https://takeout.google.com), deselect everything, select
only **Mail**, and export. You'll get one `.mbox` file with the whole inbox in
it. One download instead of twenty clicks.

Either way, make a folder called `inbox` inside `closing-manager` and put the
files in it.

---

## Step 4 — Import them

```
npm run import
```

You'll see one line per email as it goes through:

```
  OUT  Fwd: Invitation to SAP - Whitfield, 214 Delmar Ave  (forward, original from refi@aglobaltitleagency.com)
  IN   Fwd: New Title Order - 1274 Danforth Ave            (forward, original from info@getlegacyloans.com)

  Imported 22
  17 item(s) now waiting in the review queue.
```

**Read the IN/OUT column first.** That's the thing most likely to be wrong,
and it's the thing everything else depends on. If an email is on the wrong
side, the domain list in Step 1 is probably missing something.

Useful variations:

| Command | What it does |
|---|---|
| `npm run import -- --dry-run` | Shows what it *would* do. Writes nothing. Good for checking IN/OUT before committing. |
| `npm run import -- --reset` | Clears previous imports and starts over |
| `npm run import -- --dir "C:\some\other\folder"` | Read from somewhere else |

Running it twice is safe — it skips messages it's already seen.

---

## Step 5 — Look at what it did

```
npm run dev
```

Then open **http://localhost:3000/review** and go through the queue. For each
item you're judging three things:

1. **Did it read the email right?** Facts panel — address, names, dates, file
   numbers. Watch for things it *invented* as much as things it missed.
2. **Did it file it under the right property?** The most damaging error it can
   make. Two emails about one deal landing on two files, or worse, an email
   landing on someone else's file.
3. **Are the tasks real?** Should this have raised work, and is it the right
   amount — one task for a lender's checklist, not eight.

Approve the good ones and watch them land on the Settlement Board. That's the
full loop working on your actual mail.

---

## What to expect, honestly

**Forwarded headers add noise.** Every forward carries a `Sent:` or `Date:`
line, and those are clock times sitting in the body. The AI has been told not
to treat them as closing times, and your eval cases guard against exactly this
— but it's the failure mode most likely to show up, so look for it.

**Three known weak spots**, from the last scorecard run: a missed buyer
surname, a missed CPL task, and one case that behaves differently run to run.
All three are deep quoted chains. They're quality issues, not blockers.

**If something is wrong, that's the point.** Anything you find here, tell me
and I'll turn it into an eval case so it gets checked automatically from then
on. That's how the 17 cases in `evals/cases/private/` got there.

---

## When Entra lands Monday

None of this is wasted. The import path stays useful for reproducing "why did
it do that with *this* email" without waiting for a sync. And the forwarded-
mail handling is production code — your colleagues forward things constantly.

Monday's path is already built and waiting:

```
setup.cmd          double-click, paste the four Entra values
npm run preflight  says exactly what's wrong if the connection fails
npm run sync       pulls mail with no browser open
```
