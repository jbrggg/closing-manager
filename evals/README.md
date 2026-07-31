# Accuracy scorecard — how to test the AI on your own email

This folder is how you answer the only question that matters right now:
**does the AI actually understand how your office writes email?**

That's roadmap task A3, and only you can judge it. This makes the judging
fast: instead of pasting emails into a web page one at a time, you put them
in here once and run a single command whenever you want a fresh score.

---

## The short version

1. Put each real (redacted) email in this folder's `cases/` folder as a small
   text file, along with what the right answer is.
2. Run `npm run eval`.
3. Read the scorecard.

A run of 25 emails takes well under a minute and costs a few cents.

---

## Before you paste anything

**Take out Social Security numbers, bank account and wire details, and dates
of birth.** Names, property addresses, file numbers and loan numbers are fine
— those are exactly what the AI is being judged on.

Everything in this folder stays on your computer. It is not sent anywhere
except to the AI as part of the test, the same as if you typed it into the
Email Test Lab.

---

## Adding an email

Create a new file in **`cases/private/`**. Name it whatever helps you remember
it, ending in `.json` — for example `cases/private/lender-chasing-cpl.json`.

> **Why `private/`?** That folder is excluded from GitHub. Your real emails
> contain real client names and property addresses, and those should never
> end up in a code repository. The scorecard reads everything under `cases/`
> including `private/`, so it works exactly the same either way — you just
> can't publish it by accident.

Copy this and fill it in:

```json
{
  "id": "lender-chasing-cpl",
  "note": "Typical nagging email from Coastal Federal. They never use punctuation.",
  "from": "jsmith@lender.com",
  "subject": "RE: RE: 14 Ridgeview",
  "direction": "INCOMING",
  "body": "paste the email text here, on one line, with \\n where line breaks go",

  "expect": {
    "facts": [
      { "type": "PROPERTY_ADDRESS", "contains": "14 Ridgeview" },
      { "type": "CLOSING_TIME", "contains": "2:00" }
    ],
    "tasks": [
      { "contains": "CPL" }
    ],
    "filing": "new"
  }
}
```

### What each part means

| Field | What to put |
|---|---|
| `id` | A short nickname. Shows up in the scorecard. |
| `note` | Optional. A reminder to yourself about why this email is interesting. |
| `from` | The other person's email address. |
| `subject` | The subject line, copied exactly. |
| `direction` | `INCOMING` if someone sent it to you. `OUTGOING` if you sent it. **This matters** — see below. |
| `body` | The email text. Write `\n` where a line break goes. |
| `expect` | What the right answer looks like. Everything in here is optional — only fill in what you care about. |

### Why `direction` matters

The AI treats the two directions completely differently:

- **`INCOMING`** → it looks for *requests* ("please send the commitment") and
  turns them into tasks.
- **`OUTGOING`** → it looks for *completions* ("attached is the commitment")
  and proposes marking a task done.

Pick the wrong one and it will look broken when it isn't.

---

## What you can check for

Everything below goes inside `"expect"`. Leave out anything you don't care
about for that email.

**`facts`** — things it should have pulled out.

```json
"facts": [ { "type": "BUYER_NAME", "contains": "Kowalski" } ]
```

`contains` is a partial, case-insensitive match, so `"contains": "Kowalski"`
passes whether the AI recorded `Kowalski` or `Anna Kowalski`.

**These are the only nine types you can check**, because these are the only
ones the app files against a transaction:

`PROPERTY_ADDRESS` · `BUYER_NAME` · `SELLER_NAME` · `CLOSING_DATE` ·
`CLOSING_TIME` · `CLOSING_LOCATION` · `FILE_NUMBER` · `LOAN_NUMBER` ·
`MILESTONE`

The AI can also *recognise* `LENDER_NAME`, `ATTORNEY_NAME`, `REALTOR_NAME`,
`DEADLINE`, `REQUEST` and `OTHER`, but the pipeline does not store them
(`src/lib/ai/process-email.ts`, `relevantFacts`). Asking for one of those in
a case will fail every time no matter how well the AI reads the email — it is
testing something the app was never built to keep. If you want one of them
stored, that is a change to the app, not to your test.

**`mustNotSay`** — things it should *not* have invented. This is how you catch
the AI adding detail the email never contained, which is more dangerous than
missing something.

```json
"mustNotSay": [
  { "type": "CLOSING_TIME", "text": "AM", "why": "the email never says AM" }
]
```

**`tasks`** — tasks it should have proposed.

```json
"tasks": [ { "contains": "payoff" }, { "contains": "commitment" } ]
```

**`taskCount`** — the exact number of tasks. Use `0` for an email that asks
for nothing, to catch the AI inventing busywork.

```json
"taskCount": 0
```

**`filing`** — `"new"` if this email should start a new property file, or
`"existing"` if it should attach to one that already exists. Filing an email
under the wrong property is the most damaging mistake this app can make, so
it's worth checking.

**`proposesClosing`** — `true` or `false`, if you want to check whether it
offered to put a closing on the board.

---

## Testing that two emails get filed together

Give both emails the same `group`. Cases in a group run in order against the
same file cabinet, so the second one can be checked for landing on the first
one's file. See `cases/linking-pair.json` for a worked example.

You can also put several cases in one file by making it a list — that file
shows how.

---

## Running it

```
npm run eval
```

Useful variations:

| Command | What it does |
|---|---|
| `npm run eval` | Score every email in `cases/` using the real AI |
| `npm run eval -- --simulated` | Use the free built-in word-matcher instead. Costs nothing. Good for checking your test files are written correctly before spending money. |
| `npm run eval -- --only ridgeview` | Only run emails whose `id` contains "ridgeview" |
| `npm run eval -- --jobs 8` | Run 8 emails at a time instead of 4 (faster, but more likely to hit a rate limit) |

The scorecard prints to the screen and is also saved to `evals/last-run.md`,
so you can open it like any other document.

---

## Reading the scorecard

```
PASS  explicit-request
      PROPERTY_ADDRESS="77 Birchwood Drive", CLOSING_TIME="2:00 PM", ...

FAIL  lender-chasing-cpl
      Typical nagging email from Coastal Federal.
      - MISSED PROPERTY_ADDRESS containing "14 Ridgeview" — it found nothing of this kind
      - MISSED a task about "CPL" — it proposed "Confirm the payoff" instead

========================================================
SCORE: 18 of 20 emails fully correct
That clears the 15-of-20 bar in ROADMAP.md task A3.
COST:  22 API calls for 20 emails - about 14.8 cents total, 0.7 cents per email
========================================================
```

An email counts as correct only if **everything** you asked for is right. That
is a deliberately harsh standard — partial credit would let real problems hide.

**The bar is 15 out of 20** (roadmap task A3). Above it, move on to connecting
Outlook. Below it, the prompts in `src/lib/ai/llm-provider.ts` need work — and
now you can change them and re-score all 20 emails in under a minute, instead
of re-testing by hand.

---

## The two cases already in here that you should not delete

- **`a2-kowalski.json`** — the acceptance test for roadmap task A2. It contains
  the four things the old word-matcher got wrong, plus a guard against the AI
  inventing an "AM" that the email never stated (which it did once, on
  2026-07-31). If this case ever starts failing, something has gone backwards.
- **`linking-pair.json`** — proves two emails about the same file end up on the
  same file.

The other two (`explicit-request`, `no-request`) are examples you can delete
once you have your own.
