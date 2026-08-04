# Designing this app with an AI assistant

Written 2026-08-03. Plain English. Every term explained where it first appears.

This guide is deliberately **vendor-neutral**. It says "your AI assistant"
rather than naming one, because the workflow is the same whichever assistant
you use, and because a document that names a product goes stale the moment you
switch. Where a capability depends on a specific feature, it's described by what
it *does* so you can find the equivalent in whatever you're using.

---

## The honest starting point

There is usually no separate "design agent" to connect. What feels like one
feature is really four capabilities, and most assistants offer some mixture of
them. Nothing needs wiring together. What you need is to know **what each one
does and what to say to trigger it**.

| Capability | What it does | Why it matters |
|---|---|---|
| **Browser control** | The assistant sees your running app and clicks through it | The single biggest upgrade — do this first |
| **Design skills** | Specialists: critique, accessibility, design system, copy, handoff | Usually installed and idle |
| **Visual mockups** | Draws a screen in the chat *before* any code changes | Rejecting a picture is cheap |
| **Design-file access** | Reads files from professional design software | Only useful once a designer is involved |

---

# Part 1 — Browser control (the big one)

## Why this matters more than the rest combined

Without it, here's the loop: you see the screen, the assistant doesn't. You
describe it, it guesses, it changes code, you refresh, you report back. That's a
slow game of telephone, and it's how design work gets expensive.

With browser control, the assistant opens `localhost:3000` itself, looks at the
rendered page, and changes what it actually sees. **Four steps become one.**

It also catches things you'd never think to report — a button that vanishes at a
narrower window, text overlapping at 150% zoom, a link that goes nowhere.

## Setting it up

Most assistants offer this as a browser extension or a built-in browser tool.

1. Install your assistant's browser extension, or enable its browser tool.
2. Sign in to it with the same account you use in chat.
3. Start the app: `npm run dev`
4. Open `http://localhost:3000` and **sign in to the app itself**.
5. Say: *"Look at the dashboard in my browser and tell me what's wrong with it."*

**Step 4 is the one people skip.** The assistant inherits whatever session your
browser has. If you're not signed in, all it will ever see is the login page.

## What to say

> "Open the review queue and walk through approving one item. Tell me where you
> got confused."

> "Look at the closing calendar and make the text bigger where it's still small."

> "Shrink the window to half width and tell me what breaks."

> "Compare the dashboard and the tasks page — are they consistent?"

## The limits

It can look, click, and read. It **cannot** see anything outside the browser,
and it can't act on a page you haven't opened. If you want it looking at
something, open it first.

---

# Part 2 — The five design specialists

Most assistants ship or support "skills" — packaged instructions that make the
assistant approach a task a particular way. **Each is triggered by saying roughly
what it does.** You rarely need a command.

### 1. Design critique — "is this any good?"

**Say:** *"Critique the review queue screen."*

A structured read on visual hierarchy (does your eye land in the right place?),
consistency, and usability — with specific fixes, not vague praise.

**Use when** something feels off and you can't name why.

### 2. Accessibility review — "can everyone actually use this?"

**Say:** *"Run an accessibility audit on the dashboard."*

Checks against WCAG 2.1 AA, the standard most of the world writes into
contracts. Colour contrast (measured, not guessed), keyboard navigation,
click-target size, and what a screen reader would announce.

**This is the one that matters most here.** It has already been run on this
app — see `ACCESSIBILITY.md`. It found six issues including a focus ring
measuring **1.04:1** against the sidebar, which is no indicator at all. All six
are fixed.

**Re-run it** whenever you add a screen.

### 3. Design system — "why does every page look slightly different?"

**Say:** *"Audit the design system for inconsistencies."*

Finds the same idea implemented five ways — three greens that should be one,
buttons with four different paddings.

**Use in about a month**, once more screens exist and drift has set in.

### 4. UX copy — "what should this actually say?"

**Say:** *"Review the wording on the review queue."*

Every word a person reads is a design decision. `Applied CLOSING_CREATE to live
records` sat on this dashboard for weeks — accurate, and meaningless to a human.

**Use constantly.** It's the cheapest improvement available: no code risk, no
tests to re-run, and it's usually what makes software feel considered.

### 5. Design handoff — "write down exactly how this should be built"

**Say:** *"Write a handoff spec for the disbursements screen."*

A build specification: exact sizes, colours, states, edge cases.

**Use if** you hire a developer, or want a screen built precisely.

---

# Part 3 — See a design before it's built

For anything bigger than a tweak, don't let the assistant start editing code.
**Ask for a picture first.**

> "Before you change anything, show me three layouts for the disbursements
> screen."

Most assistants can draw a mockup directly in the chat. You look, you point,
*then* it gets built.

**Why the extra step pays.** Rejecting a picture costs thirty seconds. Rejecting
a built screen costs a rebuild — and there's a quiet pressure to keep something
that was expensive to make. Deciding while changing your mind is still cheap is
the whole trick.

Use for: new screens, big layout changes, colour direction, anything undecided.
Skip for: "make this bigger," "change this word."

---

# Part 4 — Design-file access

Professional design tools (Figma, Sketch and similar) can usually be connected
so the assistant reads real design files.

**Skip this for now.** It earns its keep when a human designer hands you files.
You don't have a designer, and right now the code *is* the design. Revisit if
that changes.

---

# Part 5 — The workflow, end to end

**1. You notice something.** "The tasks page feels cluttered."

**2. It looks at the real thing.** *"Open the tasks page and critique it."*

**3. Agree on the problem before the fix.** It'll say what it thinks is wrong.
Correct it — you know this work, it doesn't. A closer's instinct about what
matters on a settlement board beats a design instinct every time.

**4. See options.** Pictures, not code, if it's a real change.

**5. It builds and verifies.** `npm run verify:full` — types, all 293 tests, the
linter, a production build. Failing any of it means the change doesn't ship.

**6. You look in the browser.** Always. Verification proves the code is correct;
only you can judge whether it *feels* right.

**7. Commit and push.** Every change is a separate save point. If you hate
something next week it can be undone precisely.

---

# Part 6 — Phrases worth copying

**To look:**
- "Open [page] in my browser and tell me what's wrong with it."
- "Click through [task] and tell me where you'd get stuck."

**To improve:**
- "Critique the [page] screen."
- "Run an accessibility audit on [page]."
- "Review the wording on [page] — plain English, no jargon."

**To design new:**
- "Show me three layouts for [screen] before building anything."
- "Design a [screen] for someone not comfortable with computers."

**To fix broadly:**
- "Go through every screen and make it consistent with the dashboard."

**To undo:**
- "I don't like the new [thing]. Put it back."

---

# Part 7 — Two controls that are yours

### Make the whole app bigger — one number

In `src/app/globals.css`:

```css
html {
  font-size: 17px;
}
```

Every size in the app is a multiple of that. Change it to `19px` and
**everything** grows in proportion — headings, buttons, spacing. Nothing else
changes, and nothing can fall out of alignment.

Try it yourself. It's one number, and it's reversible.

### Change the colours — one block

Directly above, each colour is commented with what it's for:

```css
--brand: #0f4c3a;      /* deep green: sidebar, primary buttons */
--confirmed: #0a6135;  /* green  — done, confirmed, approved */
--tentative: #8a4700;  /* amber  — not settled yet, needs a date */
--review: #9a3310;     /* orange — a person has to decide */
--danger: #8f1f1a;     /* red    — cancelled, failed, overdue */
```

Better: just say *"make the green darker."* The assistant will adjust it **and
re-run `npm run contrast`**, which is the part that's easy to get wrong by eye.
A colour that looks fine on your monitor can be unreadable on a laptop at an
angle.

---

# Part 8 — Guardrails

Design changes feel safe — it's only colours and sizes. Mostly true, but:

**Every design change runs the full check.** `npm run verify:full`. No
exemptions.

**Colour is never the only signal.** Roughly one man in twelve can't reliably
separate the green chip from the amber one. Every status chip carries a
**border** and a **word** as well as a fill, so it survives colour-blindness, a
bad monitor, and a black-and-white printout. If anyone proposes a design where
colour alone carries meaning, push back.

**Nothing important is small.** 17px base, 15px floor for anything readable. Text
smaller than that is a bug.

**Plain words beat correct words.** `SETTLEMENT_BOARD` is what the database calls
it. "Closing Calendar" is what your office calls it. The screen shows the second.

---

# The shortest version

1. **Turn on browser control.** Everything else is optional.
2. **Say "critique this screen" or "run an accessibility audit"** when something
   feels off.
3. **Ask for a picture before a build** on anything substantial.
4. **Skip design-file tools** until a designer is involved.
5. **`font-size` in `globals.css` is your volume knob.**
