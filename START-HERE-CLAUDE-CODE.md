# Starting Claude Code on this project

Written for someone who does not use a terminal. There are two routes. **Try
Route 1 first** — you almost certainly already have what it needs.

---

# Route 1 — No terminal at all (recommended)

**Claude Code runs inside the Claude desktop app.** You already have that app —
it is what you have been using. There is no separate program to install and no
terminal to learn.

### Steps

1. **Open the Claude desktop app.**
2. Look for **Claude Code** in the app (alongside Cowork). If you do not see it,
   update the app — it appears once you are on a current version.
3. When it asks which folder to work in, choose:

   ```
   C:\Users\jbarg\Downloads\closing-manager
   ```

   This is the same folder you have been working in. That single choice is what
   the phrase "the agent needs to see the repository" means — pointing it at
   this folder *is* giving it access to the project.
4. Paste the prompt from `DEPLOY-PROMPT.md` (everything between the two marker
   lines) and send it.

That's it. Skip the rest of this document unless Route 1 doesn't work.

**Note on accounts:** Claude Code needs a Pro, Max, Team, or Enterprise plan.
The free plan does not include it.

---

# Route 2 — The terminal (fallback)

Only if Route 1 is unavailable.

## Step 1 — Open a terminal already inside the folder

Skip the `cd` command entirely with this trick:

1. Open **File Explorer** and navigate to `C:\Users\jbarg\Downloads\closing-manager`
   so you can see `README.md`, `package.json` and the `src` folder.
2. Click once in the **address bar** at the top (where the folder path is shown).
   The path turns into editable text.
3. Type `cmd` and press **Enter**.

A black window opens, already pointed at the right folder. You never typed a
`cd` command, and you cannot get the path wrong.

The window should show:

```
C:\Users\jbarg\Downloads\closing-manager>
```

If it shows anything else, you are in the wrong folder — close it and repeat.

## Step 2 — Install Claude Code (once)

In that black window, paste this and press Enter:

```
curl -fsSL https://claude.ai/install.cmd -o install.cmd && install.cmd && del install.cmd
```

You do **not** need to run as Administrator.

**If you see `The token '&&' is not a valid statement separator`,** you are in
PowerShell rather than CMD (its prompt starts with `PS`). Use this instead:

```
irm https://claude.ai/install.ps1 | iex
```

Check it worked:

```
claude --version
```

A version number such as `2.1.211 (Claude Code)` means you are set. If it says
`command not found`, close the window, open a new one the same way, and try
again — the installer needs a fresh window to take effect.

**Optional but recommended:** install [Git for Windows](https://git-scm.com/downloads/win).
Without it Claude Code uses PowerShell for commands; with it, it uses the same
tooling this project was built and tested with.

## Step 3 — Start it

In the same window:

```
claude
```

It will open a browser once to sign you in. Then paste the prompt from
`DEPLOY-PROMPT.md`.

## Every time after the first

Only two steps: Explorer address bar → `cmd` → Enter, then type `claude`.

---

# Which model to use

Claude Code lets you switch models mid-conversation by typing `/model`. Use
that — it is the single highest-leverage habit here, because the two models are
good at different things and the expensive one is not always the better choice.

| Model | Use it for | Why |
|---|---|---|
| **Opus** | Planning, architecture, the deployment plan, anything where it is stuck, any decision that is hard to undo | Best judgement. Worth it when a wrong call costs hours or money. |
| **Sonnet** | Executing a plan that is already agreed, writing tests, repetitive edits, straightforward fixes | Much faster and cheaper. On well-specified work the output is not meaningfully different. |
| **Haiku** | Not for this project | Built for speed on simple tasks. |

**The pattern that works:**

1. Start on **Opus.** Get the plan and the honest sequencing answer.
2. Approve the plan, then `/model` to **Sonnet** to carry it out.
3. The moment something breaks in a way that isn't obvious, `/model` back to
   **Opus.** Do not let a cheaper model grind at a hard bug — that is where the
   cost actually goes.

Rule of thumb: **Opus decides, Sonnet types.**

---

# One chat, or several?

Several — but not for the reason you might think, and **not one per model.**

### First, an important correction

You asked whether the **email intake agent** should live in its own chat "for
long-term stay."

**It doesn't live in a chat at all.** The intake agent is not a conversation —
it is code, already built, sitting in `src/lib/ai/` inside your app. Once
deployed it runs on the server on a schedule: mail arrives, it reads it,
proposals appear in your review queue. Nobody has a chat window open, and
nothing has to stay running on your laptop.

Chats are for **building** the software. The software then **runs** on its own.
If you closed every Claude window forever, the intake agent would carry on
working.

### So how should you split the chats?

**One chat per stage of work, not one per topic.** A session gets less reliable
as it fills up — it starts forgetting earlier decisions. Fighting that is
wasted effort. Instead, end a chat at a natural boundary and start fresh.

Roughly:

| Chat | Covers | Ends when |
|---|---|---|
| 1 | Plan + Supabase migration | Database is on Supabase, tests green |
| 2 | Deployment + HTTPS | The app is reachable at a real address |
| 3 | Mailbox connection | Real mail is syncing |
| 4 | Accuracy review of real email | You believe what it extracts |

**The handoff between chats is the documents, not your memory.** That is what
`CONTINUING.md`, `REBUILD.md` and `AGENTS.md` are for. End every chat with:

> "Update CONTINUING.md with exactly where we got to, what is verified, what
> isn't, and what the next session should do first."

Then open the next chat and say:

> "Read AGENTS.md, REBUILD.md and CONTINUING.md, then tell me where we are."

Done that way, a fresh chat picks up in about a minute and starts with **better**
context than a tired one that has been running for hours.

### Keep this Cowork conversation separate

Use Claude Code for work **inside** the repository — writing code, running
tests, deploying. Keep using Cowork (here) for thinking, reviewing, and
deciding. They are good at different things, and the documents keep them in
sync.
