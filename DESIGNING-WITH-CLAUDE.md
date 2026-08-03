# Designing this app with Claude — the complete guide

Written 2026-08-03. Plain English. Every term explained where it first appears.

---

## First, the honest answer to your question

You asked how to "connect the design agent" to this chat and your app.

**There is no separate design agent to connect.** What you're picturing as one
feature is actually four different tools, and you already have three of them
installed. Nothing needs wiring up. What you need is to know **what each one
does and what to say to trigger it**, because right now they're sitting unused.

Here they are, in order of how much they'll actually change your day:

| Tool | What it does | Status |
|---|---|---|
| **Claude in Chrome** | Lets me *see* your running app and click through it | Installed — **use this first** |
| **Design skills** | Five specialists: critique, accessibility, design system, copy, handoff | Installed, never used |
| **Mockups in chat** | I draw a screen for you to look at *before* any code changes | Always available |
| **Figma** | Reads real design files | Installed but **not signed in** |

The rest of this document is how to use each one.

---

# Part 1 — Claude in Chrome (the big one)

## Why this is the most important thing in this document

Right now, when you say "this looks cramped," here's what happens: you see the
screen, I don't. You describe it, I guess, I change code, you refresh, you tell
me if I was close. That's a slow game of telephone, and it's exactly how design
work gets expensive.

With Chrome connected, I open `localhost:3000` myself, look at the actual
rendered page, and change what I actually see. **The loop goes from four steps
to one.**

It also means I can catch things you'd never think to report — a button that
disappears at a narrower window, text overlapping at a certain zoom, a link
that goes nowhere.

## How to set it up

1. Install the **Claude for Chrome** extension from the Chrome Web Store.
2. Open Chrome and sign in with the same account you use here.
3. Start your app: `npm run dev`
4. Open `http://localhost:3000` in a Chrome tab and **sign in to the app**
   (`dana@keystonetitle.com` / `KeystoneDemo2026!`).
5. Come back here and say: **"Look at the dashboard in Chrome and tell me what's
   wrong with it."**

That's the whole setup. Step 4 matters — I inherit whatever session your browser
already has, so if you're not signed in, all I'll see is the login page.

## What to say once it's connected

Anything visual. Some that work well:

> "Open the review queue in Chrome and walk through approving one item. Tell me
> where you got confused."

> "Look at the closing calendar and make the text bigger where it's still small."

> "Shrink the window to half width and tell me what breaks."

> "Compare the dashboard and the tasks page — are they consistent with each
> other?"

## The limit worth knowing

I can look, click, and read. I **cannot** see your screen outside the browser,
and I can't do anything on a page you haven't opened. If you want me looking at
something, open it first.

---

# Part 2 — The five design specialists you already have

These are "skills" — packaged instructions that make me approach a task a
specific way. You installed a design plugin at some point, which is where they
came from. **Each one is triggered by saying roughly what it does.** You never
type a command.

### 1. Design critique — "is this any good?"

**Say:** *"Critique the review queue screen."*

Gives you a structured read on visual hierarchy (does your eye land in the right
place?), consistency, and usability — with specific fixes, not vague praise.

**Use it when** something feels off and you can't name why.

### 2. Accessibility review — "can everyone actually use this?"

**Say:** *"Run an accessibility audit on the dashboard."*

Checks against WCAG 2.1 AA, the standard most of the world writes into
contracts. Covers colour contrast (measured, not guessed), keyboard navigation,
click-target size, and what a screen reader would announce.

**This is the one most relevant to your seventy-year-old user.** I applied its
principles in the redesign I just shipped, but running it formally will catch
what I missed — and it produces a written record, which matters if you ever have
to demonstrate the software is usable.

**Use it before** anyone outside your office touches this.

### 3. Design system — "why does every page look slightly different?"

**Say:** *"Audit the design system for inconsistencies."*

Finds the same idea implemented five different ways — three shades of green that
should be one, buttons with four different paddings.

**Use it in about a month**, once more screens exist and drift has set in.

### 4. UX copy — "what should this actually say?"

**Say:** *"Review the wording on the review queue."* Or: *"What should this
button say?"*

Every word a person reads is a design decision. `Applied CLOSING_CREATE to live
records` was on your dashboard until today — technically accurate, meaningless
to a human.

**Use it constantly.** It's the cheapest improvement available: no code risk, no
tests to re-run, and it's usually what makes software feel considered.

### 5. Design handoff — "write down exactly how this should be built"

**Say:** *"Write a handoff spec for the disbursements screen."*

Produces a build specification: exact sizes, colours, states, edge cases.

**Use it if** you ever hire a developer, or want a screen built precisely and
consistently.

---

# Part 3 — See a design before I build it

For anything bigger than a tweak, don't let me start editing code. **Ask for a
picture first.**

> "Before you change anything, show me three different layouts for the
> disbursements screen."

I'll draw them right in the chat. You look, you point at one, *then* I build it.

**Why this is worth the extra step:** rejecting a picture costs you thirty
seconds. Rejecting a built screen costs a rebuild, and there's a quiet pressure
to keep something that was expensive to make. Deciding while it's cheap to
change your mind is the whole trick.

Use this for: new screens, big layout changes, colour direction, anything where
you're not sure what you want yet.

Skip it for: "make this bigger," "change this word," obvious fixes.

---

# Part 4 — Figma (optional, and honestly, skip it for now)

Figma is professional design software. There's a connector installed that would
let me read design files you or a designer made.

**It is not signed in, and I can't sign it in for you** — that needs a browser
login you have to do yourself, in your Claude connector settings.

**My advice: don't bother yet.** Figma earns its keep when a human designer
hands you files. You don't have a designer, and the code *is* the design right
now. Come back to this if you ever hire one.

---

# Part 5 — The workflow, start to finish

Here's what a real design session looks like once everything's connected:

**1. You notice something.** "The tasks page feels cluttered."

**2. I look at it.** *"Open the tasks page in Chrome and critique it."* Now I'm
reacting to the real thing, not your description of it.

**3. We agree on the problem before the fix.** I'll tell you what I think is
wrong. You correct me — you know this work, I don't. A closer's instinct about
what matters on a settlement board beats my design instinct every time.

**4. I show you options.** Pictures, not code, if it's a real change.

**5. I build it, and verify it.** `npm run verify:full` — types, all 292 tests,
the linter, and a production build. If any of it fails, the change doesn't ship.

**6. You look at it in the browser.** Always. I verify that the code is correct;
only you can verify that it *feels* right.

**7. I commit and push.** Every change is a separate save point in GitHub. If
you hate something a week later, it can be undone precisely, without touching
anything else.

---

# Part 6 — Exact phrases, copy and paste

**To look at something:**
- "Open [page] in Chrome and tell me what's wrong with it."
- "Click through [task] and tell me where you'd get stuck."

**To improve something:**
- "Critique the [page] screen."
- "Run an accessibility audit on [page]."
- "Make everything on [page] bigger and easier to read."
- "Review the wording on [page] — plain English, no jargon."

**To design something new:**
- "Show me three layouts for [screen] before building anything."
- "Design a [screen] for someone who is not comfortable with computers."

**To fix everything at once:**
- "Go through every screen in the app and make it consistent with the
  dashboard."

**To undo:**
- "I don't like the new [thing]. Put it back the way it was."

---

# Part 7 — Two settings that give you control

### Make the entire app bigger or smaller — one number

In `src/app/globals.css`:

```css
html {
  font-size: 17px;
}
```

Every size in the application is now expressed as a multiple of that number.
Change it to `19px` and **everything** grows in proportion — headings, buttons,
spacing, the lot. Nothing else has to change, and nothing can fall out of
alignment.

You can try this yourself. It's one number, and if you don't like it, change it
back.

### Change the colours — one block

Directly above it in the same file is the colour list, each with a comment
saying what it's for:

```css
--brand: #0f4c3a;      /* deep green: top bar, primary buttons */
--confirmed: #0a6135;  /* green  — done, confirmed, approved */
--tentative: #8a4700;  /* amber  — not settled yet, needs a date */
--review: #9a3310;     /* orange — a person has to decide */
--danger: #8f1f1a;     /* red    — cancelled, failed, overdue */
```

Better: just tell me. *"Make the green darker"* or *"the orange is too close to
the red"* and I'll adjust it **and re-check the contrast**, which is the part
that's easy to break by eye. A colour that looks fine on your monitor can be
unreadable on a laptop screen at an angle.

---

# Part 8 — Guardrails, so design work can't break the app

Design changes feel safe — it's just colours and sizes. Mostly true, but:

**Every design change still runs the full check.** `npm run verify:full`. Design
work is not exempt.

**Colour is never the only signal.** Roughly one man in twelve can't reliably
separate a green chip from an amber one. So every status chip in this app also
carries a **border** and a **word**. It survives colour-blindness, a bad
monitor, and a black-and-white printout. If I ever propose something where
colour alone carries the meaning, push back.

**Nothing important is small.** 17px base, and 15px is the floor for anything a
person has to read. If you see text smaller than that, it's a bug — tell me.

**Plain words beat correct words.** `SETTLEMENT_BOARD` is what the database
calls it. "Closing Calendar" is what your office calls it. The screen shows the
second one.

---

# The shortest version

1. **Install the Claude for Chrome extension.** Biggest single upgrade to how we
   work together. Everything else is optional.
2. **Say "critique this screen" or "run an accessibility audit"** whenever
   something feels off. Those specialists are already installed and idle.
3. **Ask for a picture before a build** on anything substantial.
4. **Skip Figma** until you have a designer.
5. **`font-size` in `globals.css` is your volume knob** for the whole app.
