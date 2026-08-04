# Connecting the real mailbox

**For the day you have Microsoft Entra administrator access.** Follow this in
order. It takes about twenty minutes of clicking, and then budget an afternoon
for the first connection to misbehave.

> **Said plainly, and it will be said every time it comes up:** the Outlook
> adapter is fully written and its mapping layer is unit-tested, but it has
> **never touched a live mailbox.** Treat the first connection as a debugging
> session, not a deployment. `npm run preflight` exists precisely because the
> first connection usually fails, and it tells you *which* thing is wrong
> instead of "401 Unauthorized".

---

## Before you start — what this can and cannot do

The app asks for exactly three permissions:

| Permission | What it lets the app do |
|---|---|
| `Mail.Read` | Read messages in the mailbox |
| `offline_access` | Stay connected without asking you to sign in every hour |
| `User.Read` | Know which mailbox it connected to |

**It does not ask for `Mail.Send`, and it never will.** The app cannot send,
reply to, delete, move, or modify a single message. That isn't a policy in a
document — the permission is simply never requested, so it cannot be misused
even by a bug. This is one of the app's fixed rules.

**Start with one shared closing mailbox, not everyone's personal mail.**

---

## Part 1 — In the Entra admin center

### 1. Register the application

**Entra admin center → App registrations → New registration.**

- **Name:** `Closing Manager`
- **Supported account types:** accounts in this organizational directory only
- **Redirect URI:** leave blank for now — you'll add several in the next step

Click **Register**.

### 2. Copy two values

From the **Overview** page, copy and keep:

- **Application (client) ID**
- **Directory (tenant) ID**

These are not secrets, but you'll need them in a minute.

### 3. Add the redirect URIs — do all of these now

**This is the step people get wrong, and it's the reason for doing it while you
have admin access rather than later.**

A redirect URI is the address Microsoft sends you back to after you approve the
connection. It must match **exactly** — character for character, including
`http` versus `https`. The app will live at different addresses over its life:
on this laptop now, on a hosting provider next, and on the company domain after
that. **Each address needs its own entry, and adding one later needs an
administrator again.** Registering all of them today costs nothing; an unused
redirect URI is harmless.

**App registrations → your app → Authentication → Add a platform → Web.**

Add all four:

```
http://localhost:3000/api/v1/integrations/microsoft/callback
https://aglobal-closings.onrender.com/api/v1/integrations/microsoft/callback
https://closings.aglobaltitleagency.com/api/v1/integrations/microsoft/callback
https://www.aglobaltitleagency.com/api/v1/integrations/microsoft/callback
```

The first is for testing on your laptop today. The second is the hosting
address (if that name turns out to be taken when we deploy, we'll need one more
admin visit — so if you can, check it's free first). The third and fourth cover
the company domain, whichever form we end up using.

Microsoft permits `http` only for `localhost`. Everything else must be `https`.

### 4. Create a client secret

**Certificates & secrets → New client secret.**

- Description: `Closing Manager`
- Expires: 24 months (put a reminder in your calendar — when it expires, mail
  sync stops)

**Copy the value in the column headed `Value` immediately.** Microsoft shows it
once and never again. It is *not* the one headed `Secret ID` — that's a
different thing and pasting it is the single most common mistake here.

**This is a password. Don't email it, don't paste it into a chat window.** You
will type it into a setup prompt on your own machine in Part 2.

### 5. Add the permissions

**API permissions → Add a permission → Microsoft Graph → Delegated
permissions.** Add exactly:

- `Mail.Read`
- `offline_access` — **do not skip this.** Without it the connection works for
  about an hour and then dies with no way to renew itself. It is the single
  most common cause of "it worked yesterday".
- `User.Read`

Then click **Grant admin consent for [your organisation]** and confirm. The
status column should read "Granted".

**Do not add `Mail.Send`.** If it's there by default, remove it.

---

## Part 2 — On your machine

### 6. Enter the settings

Double-click **`setup.cmd`**. Answer:

- Connect a real Outlook mailbox? → **Y**
- Application (client) ID → paste from step 2
- Directory (tenant) ID → paste from step 2
- Client secret VALUE → paste from step 4
- Mailbox address to read → the shared closing mailbox
- App address → press Enter (`http://localhost:3000`)
- Redirect URI → press Enter
- Your email domain → `aglobaltitleagency.com`

It generates the encryption key for you. **See "The encryption key" at the
bottom of this file — read that part.**

### 7. Check the settings before using them

```bash
npm run preflight
```

This proves the tenant exists, the client ID exists inside it, and the secret is
accepted — without opening a browser. If something is wrong it names the wrong
thing. **Do not continue until this passes.**

### 8. Connect

Double-click **`start-app.cmd`**, then in your browser go to:

```
http://localhost:3000/settings
```

Sign in as an admin and click **Connect Outlook**. Microsoft will ask you to
approve. Approve it. You'll be returned to Settings and the app will record
which mailbox was connected, in the audit log.

### 9. First contact — fetch the mail without spending anything

```bash
npm run sync -- --dry-run
```

This pulls messages from the mailbox and stores them, **without running the AI
over them.** Nothing is charged. This step exists to answer one question on its
own: does the connection work?

If it reports messages fetched, the adapter works against a real tenant for the
first time. That is the milestone.

### 10. Read a small batch and check the quality

```bash
npm run process -- --limit 10
```

Ten messages through the real model. This is where money starts, and ten is
small enough that a bad surprise is cheap. Then open the review queue and
**read what it concluded.** That is the judgement only you can make.

Check three things:

- Did it get the closings right?
- Did it raise the tasks you'd expect, and no phantom ones?
- Look at your model provider's usage page: **what did ten messages cost?**
  Multiply by your daily volume. That's your monthly AI bill, and it's the one
  number nobody has been able to estimate so far.

When you're satisfied:

```bash
npm run process -- --all
```

---

## What usually goes wrong

| What you see | What it means |
|---|---|
| "Redirect URI mismatch" | The address in Entra doesn't match exactly. Check `http` vs `https` and the full path. |
| Works for about an hour, then stops | `offline_access` wasn't granted. Back to step 5. |
| "needs to be reconnected" | The refresh token was revoked — a password change, an admin action, or expiry. Redo step 8. |
| Sync returns nothing, no error | Genuinely no new inbox mail since the last check. Not a fault. |
| "still rate limiting" | Microsoft is throttling a large first sync. Wait and run it again — nothing is lost, it resumes where it stopped. |
| Preflight says the secret is wrong | Most likely the `Secret ID` was pasted instead of the `Value`. Create a new secret and use the Value column. |

---

## The encryption key — read this

`setup.cmd` generates a value called `APP_ENCRYPTION_KEY` and puts it in
`.env.local` on your machine.

**What it does:** the app stores the mailbox connection in its database in
scrambled form. This key is what unscrambles it. Without the key, that stored
connection is unreadable — to an attacker, and to you.

**What losing it costs:** every connected mailbox has to be reconnected from
step 8. Nothing else is lost — no email, no closings, no tasks, no documents.
It is an inconvenience, not a disaster, but it needs an administrator again.

**What to do:** keep a copy of `.env.local` wherever you keep other business
passwords — a password manager, or wherever your bank details live. Not in
email, not in the project folder's cloud backup, and never in the code
repository. The file is excluded from GitHub deliberately and must stay that
way.
