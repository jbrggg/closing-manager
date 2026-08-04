/**
 * SENSITIVE-DATA REDACTION
 *
 * Title agencies are the most-targeted business category for wire fraud, and
 * this application stores human-readable summaries of email in a database that
 * will one day sit on a server. Bank details have no business being in those
 * summaries. The office rule already said "no wire instructions in task
 * titles"; this file is that rule enforced in code rather than intended.
 *
 * ---------------------------------------------------------------------------
 * THE CONSTRAINT THAT SHAPES EVERYTHING HERE
 *
 * A naive redactor destroys this application.
 *
 * Loan numbers are frequently nine or ten digits. File numbers, order numbers
 * and policy numbers are similar. Those are the STRONGEST matching signal the
 * app has — a file or loan number is worth 50 points against a 60-point
 * threshold, more than a property address. Mask those and emails stop filing
 * against the right transaction, which is a far worse outcome than the problem
 * being solved.
 *
 * So detection is never by shape alone. Every rule requires either a
 * mathematical checksum, or a nearby word establishing what the number is, and
 * usually both. A bare nine-digit number is left completely alone.
 *
 * ---------------------------------------------------------------------------
 * WHERE THIS APPLIES — AND WHERE IT MUST NOT
 *
 * APPLY to free human-readable text: evidence summaries, task titles and
 * descriptions, audit event summaries. These are for a person to read; a
 * masked number still reads fine.
 *
 * NEVER APPLY to structured fact values. `LOAN_NUMBER` and `FILE_NUMBER` rows
 * are matching keys, not prose. Redacting those would silently break the
 * matching system, and the failure would look like an AI accuracy problem.
 *
 * Masks keep the last four digits, the way a bank statement does, so a human
 * can still confirm "yes, that is the account we were told about" without the
 * full number ever being written down.
 */

/** Words that mean a nearby number is a bank detail. */
const BANK_CONTEXT = /\b(?:aba|rtn|routing|wire|wiring|swift|iban|beneficiary|bank|deposit)\b/i;

/** Words that mean a nearby number is ORDINARY BUSINESS DATA — never mask. */
const BUSINESS_CONTEXT =
  /\b(?:loan|file|order|policy|commitment|invoice|case|claim|parcel|apn|tax|folio|reference|ref|tracking|escrow\s+no|title)\b/i;

/** How far either side of a number to look for a word saying it is a bank detail. */
const CONTEXT_WINDOW = 48;

function contextAround(text: string, start: number, end: number): string {
  return text.slice(Math.max(0, start - CONTEXT_WINDOW), Math.min(text.length, end + CONTEXT_WINDOW));
}

/**
 * The text on the same line, before the number — which is where a number's own
 * label lives ("Loan 4012...", "ABA routing: 0210...").
 *
 * This distinction is not fussiness; it is a bug that a test caught. Looking
 * for business words in a wide window meant that in a genuine wire-instruction
 * block, the word "file" two lines below suppressed the routing-number mask.
 * A number is described by its own label, not by whatever happens to appear
 * further down the message.
 */
function labelBefore(text: string, start: number): string {
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  return text.slice(lineStart, start);
}

/**
 * ABA routing-number check digit.
 *
 * 3(d1+d4+d7) + 7(d2+d5+d8) + (d3+d6+d9) must be divisible by 10. This is
 * what makes it safe to look at nine-digit numbers at all: a randomly chosen
 * nine-digit loan number has only about a one-in-ten chance of passing, and
 * the context rules then have to agree as well.
 */
export function isValidRoutingNumber(digits: string): boolean {
  if (!/^\d{9}$/.test(digits)) return false;
  const d = [...digits].map(Number);
  const sum =
    3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + 1 * (d[2] + d[5] + d[8]);
  return sum % 10 === 0 && sum > 0;
}

/** Luhn check, used for payment card numbers. */
export function passesLuhn(digits: string): boolean {
  if (!/^\d{13,19}$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = Number(digits[i]);
    if (double) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    double = !double;
  }
  return sum % 10 === 0;
}

const last4 = (s: string) => s.replace(/\D/g, "").slice(-4);

export interface RedactionResult {
  text: string;
  /** What was masked, for the audit trail. Never contains the values. */
  found: string[];
}

/**
 * Mask bank and identity details in free text.
 *
 * Order matters: the most specific and highest-confidence patterns run first,
 * so a card number is never re-examined as an account number.
 */
export function redactSensitive(input: string | null | undefined): RedactionResult {
  if (!input) return { text: input ?? "", found: [] };

  let text = input;
  const found: string[] = [];

  // --- 1. Social security numbers -------------------------------------------
  // The dashed form is unambiguous; nothing else in this domain looks like it.
  text = text.replace(/\b(\d{3})-(\d{2})-(\d{4})\b/g, () => {
    found.push("ssn");
    return "[SSN redacted]";
  });

  // Undashed, but only with an explicit label. Nine bare digits stay untouched.
  text = text.replace(/\b(?:ssn|social\s+security(?:\s+(?:number|no\.?|#))?)\s*[:#]?\s*(\d{9})\b/gi, () => {
    found.push("ssn");
    return "[SSN redacted]";
  });

  // --- 2. Payment cards -----------------------------------------------------
  // Luhn is a strong filter, so no context word is required.
  text = text.replace(/\b(?:\d[ -]?){13,19}\b/g, (match) => {
    const digits = match.replace(/\D/g, "");
    if (!passesLuhn(digits)) return match;
    found.push("card");
    return `[card ending ${last4(digits)}]`;
  });

  // --- 3. Routing numbers ---------------------------------------------------
  // Three conditions, all required:
  //   a) the ABA check digit passes;
  //   b) a banking word appears nearby;
  //   c) the number's OWN label is not a business label.
  // (c) is checked only on the same line, before the number — see labelBefore.
  text = text.replace(/\b\d{9}\b/g, (match, offset: number) => {
    if (!isValidRoutingNumber(match)) return match;
    if (!BANK_CONTEXT.test(contextAround(text, offset, offset + match.length))) return match;
    if (BUSINESS_CONTEXT.test(labelBefore(text, offset))) return match;
    found.push("routing");
    return `[routing ending ${last4(match)}]`;
  });

  // --- 4. Account numbers ---------------------------------------------------
  // No checksum exists, so this is context-only: an explicit account label
  // immediately followed by the digits. Anything less would be guessing.
  text = text.replace(
    /\b(acct|account|a\/c|beneficiary\s+account)\s*(?:number|no\.?|#)?\s*[:#]?\s*(\d{6,17})\b/gi,
    (match, label: string, digits: string, offset: number) => {
      // "escrow account 12345" and "file account 998" are ordinary business
      // references. A banking word on the same line overrides that.
      const line = labelBefore(text, offset) + match;
      if (BUSINESS_CONTEXT.test(line) && !BANK_CONTEXT.test(line)) return match;
      found.push("account");
      return `${label} [ending ${last4(digits)}]`;
    }
  );

  return { text, found: [...new Set(found)] };
}

/** Convenience for the common case where only the cleaned text is wanted. */
export function redact(input: string | null | undefined): string {
  return redactSensitive(input).text;
}

/**
 * True if the text contains anything this module would mask. Used to flag a
 * review item as containing bank details, so a human is told why a summary
 * looks abbreviated rather than assuming the AI mangled it.
 */
export function containsSensitiveData(input: string | null | undefined): boolean {
  return redactSensitive(input).found.length > 0;
}
