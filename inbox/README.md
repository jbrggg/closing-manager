# Put your real email here

This folder is where you drop real work emails so the app can read them and
you can judge whether it understood them.

**Nothing in here ever leaves this computer.** The folder is excluded from
GitHub, and so is everything the import produces — the database, the stored
documents, and the scorecard report. The only file in here that gets
committed is this one.

---

## What to collect

**15 to 25 messages**, chosen to be representative rather than easy. A good
mix:

- three or four ordinary closing emails
- one where a closing gets **rescheduled** (and ideally the original too, so
  you can check it keeps the history)
- two or three **document requests** — "please send the CPL", a lender
  checklist
- one that is genuinely **ambiguous**, where you'd have to think about which
  file it belongs to
- **several with attachments** — a commitment, a HUD, a payoff letter. This
  matters: the app now reads text out of attached PDFs, and a closing date
  that only exists inside a settlement statement is the hardest thing it has
  to do.
- one or two of **your own sent** messages

Don't clean them up. Messy is the point.

---

## How to save them out

### Outlook on the web — the easy one

This is the shortest route and it keeps attachments.

1. Go to <https://outlook.office.com> and open a message.
2. Click the **three dots** (`···`) at the top right of the message.
3. Choose **Download**.
4. Your browser saves an `.eml` file, usually to your Downloads folder.
5. Drag it into this folder.

Repeat for each message. It's about five seconds each once you have the
rhythm.

### New Outlook for Windows

Same as above — open the message, three dots, **Download**.

### Classic Outlook (the older desktop app)

Classic Outlook saves in a format this tool can't read (`.msg`). Two ways
around it:

- Open the same mailbox at <https://outlook.office.com> and use the steps
  above. This is the recommended route.
- Or forward the messages to a webmail account and download them from there.
  Forwarding works properly — the app unwraps the forward and recovers who
  really sent it — but it's more steps than just using the web version.

### Gmail

Open a message → **three dots** → **Download message**. Saves an `.eml`.

---

## Then run it

Double-click **`import.cmd`** in the main project folder.

It reads everything in here, runs it through the same pipeline a live mailbox
would use, and prints one line per message showing whether it was treated as
incoming or outgoing, and how many attachments it kept and could read.

When it finishes it will tell you to open the review queue in your browser.
**That's the part that matters** — the printed lines only prove the mail was
read, not that it was understood. The review queue is where you see what the
app actually concluded, and you're the only person who can judge whether it's
right.

---

## Things that will look like bugs and aren't

**Running it twice imports nothing the second time.** Each message is
recognised by its Message-ID, so re-running is safe and does nothing. If you
genuinely want to start over, use `npm run import -- --reset`.

**A PDF reported as "scanned/no text" is not a failure.** It means the
document is a picture of a page rather than text — a scan. The app records
that deliberately instead of treating it as an error, because the count of
those across your real mail is the only evidence that will ever exist for
whether it's worth teaching the app to read scans. Watch that number.

**Everything showing as INCOMING** means `ORG_EMAIL_DOMAINS` isn't set. Run
`setup.cmd` and answer the question about your own email domains.
