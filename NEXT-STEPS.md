# What to do next

Written 2026-07-31, after the speed pass. Follow these in order. Nothing here
requires you to read or write code.

---

## Step 1 — Get the app running on your computer (~5 minutes)

You already have Node.js installed, so this is short.

Open a terminal in this folder (in File Explorer, click the address bar, type
`cmd`, press Enter), then:

```
npm install
```

This downloads the app's building blocks. It should take under a minute now —
it used to be about twice as long, because we removed a 182 MB tool the app
never actually used.

Then check everything is healthy:

```
npm run verify
```

You should see:

```
  OK   Type check
  OK   Tests
  OK   Linter

Everything passed.
```

If any line says FAIL, stop and send me what it printed.

---

## Step 2 — Confirm the app still works in a browser (~3 minutes)

**I could not do this one for you.** The sandbox I work in cannot start a web
server or open a browser, so the last time anyone saw this app's actual
screens was in the previous session, before today's changes. My changes are
covered by 98 automated tests, but tests are not eyes.

```
npm run dev
```

Then open **http://localhost:3000** and sign in with
`dana@keystonetitle.com` / `KeystoneDemo2026!`.

Click through: Dashboard → Review Queue → approve one item → Settlement
Board. If those work, the app is fine.

Press `Ctrl+C` in the terminal to stop it.

---

## Step 3 — The real test of today's work (~2 minutes, a few cents)

This is the one that matters. It runs your test emails through the real AI
and scores the answers.

```
npm run eval
```

Expect the scorecard to show the Kowalski case passing — that's the roadmap
A2 acceptance email, and it checks all four things the old word-matcher got
wrong, plus a guard against the AI inventing an "AM" the email never said.

**If it reports a 401 or an authentication error**, your API key needs
replacing. I could not check whether your key is still valid — this sandbox
blocks all authenticated calls to the AI service, so a good key and a bad key
look identical from here. Get a new one at platform.claude.com/settings/keys
and paste it into `.env.local` after `ANTHROPIC_API_KEY=`.

Two things worth knowing about what changed under the hood:

- Each email now costs **one** call to the AI instead of two. Your bill for
  the same work should be roughly halved.
- A reply chain is now read all at once instead of one message at a time, so
  a four-message thread takes about as long as a single email.

The scorecard prints the actual cost at the bottom, so you can see this for
yourself.

---

## Step 4 — Roadmap task A3: your real emails

This is the current task and only you can do it. It used to mean pasting
20–30 emails into a web page one at a time. Now:

1. Open the folder `evals/cases/private/`
2. Put each email in as a small file — the template and instructions are in
   **`evals/README.md`**, and there are four worked examples one folder up
3. Run `npm run eval`

**The bar is 15 out of 20 fully correct.** Above that, move on to connecting
Outlook. Below it, the AI's instructions need tuning — and now that your
emails live in that folder, every tuning attempt gets re-scored against all
of them in under a minute, which is the part that actually protects quality.

`evals/cases/private/` is excluded from GitHub on purpose. Your real emails
contain client names and property addresses and will never leave this
computer.

Redact before pasting: Social Security numbers, bank/wire details, dates of
birth. Leave names, addresses, file numbers and loan numbers in — those are
what the AI is being judged on.

---

## Step 5 — Put this on GitHub (~5 minutes, one time)

Right now this project exists in exactly one place: this folder. If the
laptop dies, or a change breaks something and you want to go back, there is
nothing to go back to. GitHub fixes both, and it also means future sessions
start with `git clone` instead of zipping folders back and forth.

I've already prepared everything on this side. There is one commit ready,
and I checked that your API key, your database, and your private emails are
all excluded from it.

**First, make sure Git is installed.** Type `git --version` in a terminal. If
you get an error, install it from https://git-scm.com/download/win (click
through the installer with the defaults).

**Then create the repository on GitHub:**

1. Go to https://github.com/new
2. Repository name: `closing-manager`
3. **Choose Private.** This is not open-source software and it describes a
   real agency's workflow.
4. **Do not** tick "Add a README", "Add .gitignore", or "Choose a license" —
   this project already has them, and ticking those causes a conflict on the
   first push.
5. Click **Create repository**

**Then, in a terminal in this folder, run these three lines** (replace
`YOUR-USERNAME` with your GitHub username):

```
git remote add origin https://github.com/YOUR-USERNAME/closing-manager.git
git branch -M main
git push -u origin main
```

Windows will pop up a browser window asking you to sign in to GitHub. Approve
it. When the command finishes, refresh the GitHub page — your project is
there.

**After that, saving a new version is:**

```
git add -A
git commit -m "a short note about what changed"
git push
```

### One thing to check after your first push

Open the repository on GitHub and confirm you do **not** see a file called
`.env.local`. You shouldn't — it's excluded — but that file holds your API
key, and it is worth thirty seconds to be sure.

---

## What I could not verify, stated plainly

| Thing | Status |
|---|---|
| 98 automated tests | Passed, including with the network completely cut off |
| Type check, linter | Clean |
| Accuracy scorecard | Works — proven against the built-in word-matcher |
| The app's actual screens | **Not checked.** My sandbox cannot run a web server. Step 2 above. |
| The production build | **Not checked.** My sandbox crashes running it, for reasons below the app's own code. Run `npm run verify:full` on your machine. |
| The real AI | **Not checked.** My sandbox blocks authenticated calls to it. Step 3 above. |
| Your API key's validity | **Unknown from here**, for the same reason. |
| The Outlook connection | Still never run against a real mailbox. Unchanged from before. |

None of these are new risks introduced today — they are limits of where I
run, and Steps 2 and 3 close all of them in about five minutes.

---

## Housekeeping

- The folder `_to_delete/` holds a leftover file-transfer bundle from the
  previous session. Safe to delete whenever.
- Your API key has now travelled through file uploads across two accounts.
  You chose not to rotate it for now, which is a reasonable call since it was
  never printed in a chat and is excluded from GitHub. If you change your
  mind it's a two-minute job at platform.claude.com/settings/keys.
