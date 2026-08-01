// -----------------------------------------------------------------------------
// FORWARDED MESSAGE UNWRAPPING
//
// Why this exists: a forwarded email lies about who sent it.
//
// Two things break without it, and both break silently:
//
//   1. DIRECTION. `mapGraphMessage` decides INCOMING vs OUTGOING by comparing
//      the envelope sender against the connected mailbox. On a forward the
//      envelope sender is whoever pressed Forward — so an email our own office
//      sent arrives looking INCOMING, and the AI hunts it for requests and
//      raises tasks from our own sent mail.
//
//   2. THE BODY. `splitQuotedText` cuts at the first "From:" line and files
//      everything after it as quoted history, which the AI never reads. On a
//      forward that IS the email. Type "fyi" above the forward and the AI sees
//      three characters where a closing instruction used to be.
//
// This matters beyond a test harness. Several of the agency's real threads are
// internal forwards — a colleague pushing a lender's instructions across with
// one line on top. Those are the emails that carry the actual work.
//
// What this does NOT do: guess. If the text does not clearly contain a
// forwarded header block, it says so and the caller keeps the original
// envelope. A wrong guess about who sent something is worse than no guess.
// -----------------------------------------------------------------------------

/** Just the shape we read from the environment. process.env satisfies this,
 *  and so does a plain object in a test. */
export type EnvLike = Record<string, string | undefined>;

export interface ForwardedHeader {
  /** The address the original message came from, lowercased. */
  from: string;
  /** Addresses it originally went to, lowercased. */
  to: string[];
  /** Original subject, if the block stated one. */
  subject?: string;
  /** Original send time as written — NOT parsed into a Date; see below. */
  sentRaw?: string;
  /** Parsed send time, when the format was unambiguous enough to trust. */
  sentAt?: string;
}

export interface UnwrappedMessage {
  /** True when a forwarded header block was found and parsed. */
  isForwarded: boolean;
  /** The original message's headers, when we could read them. */
  original?: ForwardedHeader;
  /**
   * Everything the AI should read: the forwarder's own note (if any) plus the
   * full forwarded message. Deliberately NOT split — on a forward the quoted
   * part is the content.
   */
  body: string;
  /** Whatever the forwarder typed above the forward. Often empty. */
  forwarderNote: string;
}

/** Pull every email address out of a header line like `Jamie <j@x.com>; b@y.com`. */
function addressesIn(line: string): string[] {
  const found = line.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
  return [...new Set(found.map((a) => a.toLowerCase()))];
}

/**
 * Gmail's forward banner. Outlook has no banner — it just starts a header
 * block — so absence of this proves nothing.
 */
const GMAIL_BANNER = /^-{2,}\s*Forwarded message\s*-{2,}\s*$/im;
const OUTLOOK_BANNER = /^\s*-{2,}\s*Original Message\s*-{2,}\s*$/im;

/**
 * A `From:` line that begins a header block. Requires an address on the line,
 * which is what separates a real header from prose that happens to start with
 * the word "from".
 */
const FROM_LINE = /^[ \t]*From:[ \t]*(.+@.+)$/im;

/** Lines that belong to a header block, in the order Outlook and Gmail emit them. */
const HEADER_LINE = /^[ \t]*(From|Sent|Date|To|Cc|Bcc|Subject|Reply-To|Importance):[ \t]*(.*)$/i;

/**
 * Parse the header block that starts at `startIndex`.
 * Returns null when the block does not look like real headers.
 */
function parseHeaderBlock(text: string, startIndex: number): ForwardedHeader | null {
  const lines = text.slice(startIndex).split(/\r?\n/);
  const header: Record<string, string> = {};

  // Headers run until the first line that is not a header and not blank.
  // Two consecutive blanks also end the block — some clients pad them.
  let blanks = 0;
  for (const line of lines.slice(0, 25)) {
    if (line.trim() === "") {
      if (Object.keys(header).length > 0 && ++blanks >= 1) break;
      continue;
    }
    const match = line.match(HEADER_LINE);
    if (!match) break;
    const key = match[1].toLowerCase();
    if (!(key in header)) header[key] = match[2].trim();
  }

  const fromAddresses = addressesIn(header.from ?? "");
  if (fromAddresses.length === 0) return null;

  // A block with only a From: line is more likely prose than a real header.
  const hasSecondSignal = Boolean(header.sent || header.date || header.to || header.subject);
  if (!hasSecondSignal) return null;

  const sentRaw = header.sent || header.date || undefined;

  return {
    from: fromAddresses[0],
    to: addressesIn(`${header.to ?? ""} ${header.cc ?? ""}`),
    subject: header.subject || undefined,
    sentRaw,
    sentAt: parseSentDate(sentRaw),
  };
}

/**
 * Turn a header date into an ISO string, but only when it is unambiguous.
 *
 * Deliberately conservative. `Date.parse` will happily accept "Thursday" and
 * hand back today, and a wrong closing date on the settlement board is exactly
 * the failure this project keeps guarding against. Anything without a year is
 * rejected rather than guessed.
 */
export function parseSentDate(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const cleaned = raw.replace(/\s+/g, " ").trim();
  if (!/\b(19|20)\d{2}\b/.test(cleaned)) return undefined;

  const parsed = new Date(cleaned);
  if (Number.isNaN(parsed.getTime())) return undefined;

  const year = parsed.getUTCFullYear();
  if (year < 1990 || year > 2100) return undefined;

  return parsed.toISOString();
}

/**
 * Look at a message body and, if it is a forward, recover the original
 * message's headers and full text.
 */
export function unwrapForwarded(body: string): UnwrappedMessage {
  const text = (body ?? "").replace(/\r\n/g, "\n");

  // Prefer an explicit banner — it marks the boundary unambiguously. Fall back
  // to the first header-shaped From: line, which is how Outlook forwards look.
  const banner = text.match(GMAIL_BANNER) ?? text.match(OUTLOOK_BANNER);
  const bannerIndex = banner?.index;

  let headerStart: number | undefined;
  if (bannerIndex !== undefined) {
    const after = text.slice(bannerIndex + (banner?.[0].length ?? 0));
    const fromInBanner = after.match(FROM_LINE);
    headerStart = fromInBanner?.index !== undefined
      ? bannerIndex + (banner?.[0].length ?? 0) + fromInBanner.index
      : undefined;
  } else {
    headerStart = text.match(FROM_LINE)?.index;
  }

  if (headerStart === undefined) {
    return { isForwarded: false, body: text.trim(), forwarderNote: "" };
  }

  const original = parseHeaderBlock(text, headerStart);
  if (!original) {
    return { isForwarded: false, body: text.trim(), forwarderNote: "" };
  }

  const noteEnd = bannerIndex !== undefined ? bannerIndex : headerStart;

  return {
    isForwarded: true,
    original,
    // The whole thing. On a forward the "quoted" part is the message.
    body: text.trim(),
    forwarderNote: text.slice(0, noteEnd).trim(),
  };
}

/**
 * Is this one of the agency's own addresses?
 *
 * Reads `ORG_EMAIL_DOMAINS` and `ORG_EMAIL_ADDRESSES` from the environment,
 * both comma-separated. Domains cover the common case (everyone at
 * @ouragency.com is us); addresses cover staff on a different domain.
 *
 * Roadmap A4 decided direction should eventually be per-person rather than
 * per-organisation. This is the organisation-level step, and it is what makes
 * a forwarded email from our own purchase@ read as OUTGOING instead of
 * arriving as a request we have to answer.
 */
export function isOurAddress(address: string, env: EnvLike = process.env): boolean {
  const addr = (address ?? "").trim().toLowerCase();
  if (!addr.includes("@")) return false;

  const addresses = (env.ORG_EMAIL_ADDRESSES ?? "")
    .split(",")
    .map((a) => a.trim().toLowerCase())
    .filter(Boolean);
  if (addresses.includes(addr)) return true;

  const domain = addr.slice(addr.lastIndexOf("@") + 1);
  const domains = (env.ORG_EMAIL_DOMAINS ?? "")
    .split(",")
    .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);

  return domains.includes(domain);
}

/**
 * Work out the direction of a message that may be a forward.
 *
 * `connectedMailbox` is the account we synced from. On a forward that address
 * is meaningless — it is just wherever the mail was sent for testing — so the
 * original sender decides instead.
 *
 * Returns `undefined` when there is no basis for a decision, so the caller can
 * fall back rather than take a coin flip. Direction drives whether the AI
 * hunts for requests or completions; guessing it wrong makes the AI look
 * broken when it isn't.
 */
export function directionFor(
  message: { fromAddress: string; unwrapped?: UnwrappedMessage },
  connectedMailbox: string,
  env: EnvLike = process.env
): "INCOMING" | "OUTGOING" | undefined {
  const originalFrom = message.unwrapped?.isForwarded
    ? message.unwrapped.original?.from
    : undefined;

  const sender = (originalFrom ?? message.fromAddress ?? "").toLowerCase();
  if (!sender) return undefined;

  // If we know the agency's own addresses, that is the most reliable signal
  // and it survives forwarding.
  if (env.ORG_EMAIL_DOMAINS || env.ORG_EMAIL_ADDRESSES) {
    return isOurAddress(sender, env) ? "OUTGOING" : "INCOMING";
  }

  // Otherwise fall back to the old rule, which is correct for a directly
  // synced mailbox and wrong for a forward — hence the configuration above.
  const mailbox = (connectedMailbox ?? "").toLowerCase();
  if (!mailbox) return undefined;
  return sender === mailbox ? "OUTGOING" : "INCOMING";
}
