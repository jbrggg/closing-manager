# Put your real emails in this folder

This folder is **excluded from GitHub** (see `.gitignore`). Nothing you put
here can be pushed or published by accident. It stays on this computer.

That is why it exists: the four example cases one level up are made up, but
your real emails contain real client names and real property addresses, and
those should not end up in a code repository even a private one.

Drop your `.json` case files straight in here. `npm run eval` picks up
everything under `evals/cases/`, including this folder.

Format and a fill-in-the-blank template: `evals/README.md`.

**Still redact before pasting:** Social Security numbers, bank account and
wire details, dates of birth. Names, addresses, file numbers and loan
numbers are what the AI is being scored on, so leave those in.
