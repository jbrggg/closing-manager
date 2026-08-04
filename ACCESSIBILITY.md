# Accessibility Audit

**Standard:** WCAG 2.1 AA · **Date:** 2026-08-03 · **Scope:** every screen in the application

---

## Why this document exists

The person who uses this software every day may be in their seventies. That is
not a hypothetical — it is a stated design constraint for this project. An audit
is how you find out whether a good intention actually reached the code, because
most accessibility failures are invisible to whoever wrote them. You cannot see
a missing form label, and you cannot judge colour contrast by eye.

Everything below was **found and fixed**, not merely noted.

---

## Summary

**Issues found: 6** — Critical: 2 · Major: 3 · Minor: 1
**Issues remaining: 0**

Two of the six were Level A failures: the baseline, not the stretch goal.

---

## Findings

### Perceivable

| # | Issue | Criterion | Severity | Status |
|---|---|---|---|---|
| 1 | Body text 13px, metadata 11px, panel headings 12px uppercase grey | 1.4.4 Resize Text | Critical | **Fixed** — 17px base, 15px floor, one `font-size` controls the app |
| 2 | Status conveyed by colour fill alone | 1.4.1 Use of Colour | Major | **Fixed** — every chip carries a border *and* a word |

### Operable

| # | Issue | Criterion | Severity | Status |
|---|---|---|---|---|
| 3 | Focus ring invisible on the green sidebar — **measured 1.04:1** | 2.4.7 Focus Visible | Critical | **Fixed** — two-tone ring: dark outline, light halo |
| 4 | No skip link; eight nav links before content on every page | 2.4.1 Bypass Blocks (**Level A**) | Major | **Fixed** — skip link, hidden until focused |

### Understandable

| # | Issue | Criterion | Severity | Status |
|---|---|---|---|---|
| 5 | Every page shared one browser title | 2.4.2 Page Titled (**Level A**) | Major | **Fixed** — eight pages named after their menu item |

### Robust

| # | Issue | Criterion | Severity | Status |
|---|---|---|---|---|
| 6 | Email Test Lab labels not attached to inputs; automation-rule controls unnamed | 4.1.2 Name, Role, Value | Minor | **Fixed** — `htmlFor`/`id`, `aria-label`, `radiogroup`, `aria-pressed` |

---

## Colour contrast

Measured, not estimated. Run it yourself:

```
npm run contrast
```

**All 32 pairings pass. 23 clear AAA** (the stricter 7:1 standard). Selected results:

| Element | Ratio | Required | Result |
|---|---|---|---|
| Body text on a card | 16.77:1 | 4.5:1 | AAA |
| Secondary text on a card | 8.04:1 | 4.5:1 | AAA |
| Sidebar label on green | 9.93:1 | 4.5:1 | AAA |
| Confirmed chip text | 6.09:1 | 4.5:1 | AA |
| Tentative chip text | 5.86:1 | 4.5:1 | AA |
| Review chip text | 5.81:1 | 4.5:1 | AA |
| Approve button label | 7.57:1 | 4.5:1 | AAA |
| Focus halo on the sidebar | 9.93:1 | 3:1 | AAA |

The script **exits non-zero on failure**, so a bad colour change can be caught
automatically instead of shipped. It reads values straight out of `globals.css`,
so it cannot drift out of date with the app.

### The one that mattered

The blue focus ring against the deep green sidebar measured **1.04:1**. For
context, 1:1 means *identical colours*. Anyone navigating by keyboard had no
idea where they were.

Neither a dark ring nor a light one fixes this alone — a dark ring vanishes on
the green, a light ring vanishes on the white selected item. The fix is a **dark
outline with a light halo behind it**: on a pale surface the outline reads, on a
dark surface the halo does. There is now no background in this app where focus
is invisible.

---

## Keyboard navigation

| Element | Behaviour |
|---|---|
| Skip link | First tab stop on every page; jumps past navigation |
| Sidebar links | Tab in document order; `aria-current="page"` marks the active one |
| Stat tiles | Real links — reachable by tab, activated by Enter |
| Approve / Reject | Standard buttons; Enter and Space both work |
| Direction toggle | Announced as a radio group, not two unrelated buttons |
| Every control | Minimum 2.6rem (~44px) tall, per WCAG 2.5.5 |

---

## Screen reader

| Element | Announced as |
|---|---|
| Page | "Needs Your Review · Keystone Closing Operations" — was identical on every page |
| Sidebar | "Main navigation, list, 8 items" |
| Active item | "…, current page" |
| Status chip | "Confirmed" — the word, not only a colour |
| Confidence | "Fairly sure 62%" — was a bare "62%" |
| Lab fields | "Who sent it, edit text" — was "edit text, blank" |
| Rule toggle | "Turn off automatic Closing Create, pressed" — was "Enabled" |

---

## Deliberate choices worth recording

**Confidence is a word first, a number second.** The confidence pill reads
"Fairly sure 62%". A bare percentage asks the reader to convert a number into a
judgement; the word does that work for them, and the number remains for anyone
who wants it.

**Approve and Reject are stacked, not side by side.** Two large adjacent buttons
of equal weight invite a mis-click, and here a mis-click writes a record.
Stacking costs nothing and removes the failure mode.

**Colour never carries meaning alone.** Roughly one man in twelve cannot
reliably separate the green chip from the amber one. Every status carries a
border and a word, so the interface survives colour-blindness, a poor monitor,
and a black-and-white printout.

---

## Honest limits

**This audit is code review plus arithmetic — not user testing.** Automated and
structural checks catch perhaps 30–40% of real accessibility problems. Two
things remain undone, and both need a human:

1. **Test with an actual screen reader.** NVDA is free on Windows. What *should*
   be announced and what *is* announced differ more often than anyone expects.
2. **Watch the actual user.** If someone squints, leans in, or hesitates before
   clicking, that is a finding — whatever the contrast numbers say.

If the app still feels small in use, the fix is one line: raise `font-size` in
`src/app/globals.css`. Everything scales together.

---

## Re-running this

```
npm run contrast      # colour contrast; exits non-zero on failure
npm run verify:full   # types, 292 tests, linter, production build
```

Re-run the contrast check after **any** colour change. That is the entire reason
it is a script and not a paragraph in a document.
