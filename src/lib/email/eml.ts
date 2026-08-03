import { htmlToPlainText } from "./graph-mapping";

// -----------------------------------------------------------------------------
// .eml / .mbox PARSING
//
// Enough of RFC 822 to read a real email off disk. Not a general-purpose mail
// library — it handles what Gmail and Outlook actually produce when you export
// a message, and nothing more.
//
// Why this exists: connecting a live mailbox needs an Entra app registration,
// which is a Monday job. Exporting messages to a file needs nothing. This is
// how real mail reaches the pipeline before any adapter is live, and it stays
// useful afterwards for reproducing "why did it do that with THIS email".
// -----------------------------------------------------------------------------

export interface ParsedAttachment {
  filename: string;
  mimeType: string;
  bytes: Buffer;
}

export interface ParsedEmail {
  messageId?: string;
  from: string;
  fromName?: string;
  to: string[];
  cc: string[];
  subject: string;
  /** ISO timestamp from the Date header, when it parsed. */
  sentAt?: string;
  /** Best available plain-text body — text/plain if present, else HTML stripped. */
  body: string;
  /** Every address seen on the envelope, lowercased and deduped. */
  participants: string[];
  /**
   * Files carried by the message. In title work these are the job — the HUD,
   * the CPL, the commitment, the search package — so they are kept rather
   * than discarded. Inline images (a signature logo) are excluded; only
   * things a person would call an attachment.
   */
  attachments: ParsedAttachment[];
}

/**
 * Quoted-printable decoding, done a byte at a time.
 *
 * The obvious one-line version — `String.fromCharCode(parseInt(hex, 16))` —
 * is wrong for anything outside ASCII. `=E2=80=94` is three bytes of UTF-8 for
 * an em dash; decoded one character at a time it becomes three pieces of
 * mojibake. Real title email is full of em dashes and curly quotes, so this
 * collects the bytes first and decodes the whole run as UTF-8 at the end.
 */
function decodeQuotedPrintable(input: string): string {
  // Soft line breaks: "=" at end of line means the line continues.
  const joined = input.replace(/=\r?\n/g, "");
  const bytes: number[] = [];

  for (let i = 0; i < joined.length; i++) {
    const pair = joined.slice(i + 1, i + 3);
    if (joined[i] === "=" && /^[0-9A-Fa-f]{2}$/.test(pair)) {
      bytes.push(parseInt(pair, 16));
      i += 2;
      continue;
    }
    for (const byte of Buffer.from(joined[i], "utf-8")) bytes.push(byte);
  }

  return Buffer.from(bytes).toString("utf-8");
}

function decodeBase64(input: string): string {
  try {
    return Buffer.from(input.replace(/\s+/g, ""), "base64").toString("utf-8");
  } catch {
    return input;
  }
}

/**
 * RFC 2047 encoded-word, used in Subject and display names when they contain
 * anything non-ASCII: `=?utf-8?Q?Caf=C3=A9?=`
 */
export function decodeEncodedWords(input: string): string {
  return input.replace(
    /=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g,
    (_match, _charset: string, encoding: string, text: string) => {
      if (encoding.toUpperCase() === "B") return decodeBase64(text);
      // Q encoding is quoted-printable with "_" standing in for a space.
      return decodeQuotedPrintable(text.replace(/_/g, " "));
    }
  );
}

/** Split a raw message into its header block and its body. */
function splitHeadersAndBody(raw: string): { headerText: string; body: string } {
  const normalized = raw.replace(/\r\n/g, "\n");
  const blank = normalized.indexOf("\n\n");
  if (blank === -1) return { headerText: normalized, body: "" };
  return { headerText: normalized.slice(0, blank), body: normalized.slice(blank + 2) };
}

/** Parse a header block, joining folded continuation lines. */
export function parseHeaders(headerText: string): Record<string, string> {
  const headers: Record<string, string> = {};
  const lines = headerText.split("\n");
  let currentKey = "";

  for (const line of lines) {
    // A line starting with whitespace continues the previous header.
    if (/^[ \t]/.test(line) && currentKey) {
      headers[currentKey] += " " + line.trim();
      continue;
    }
    const match = line.match(/^([A-Za-z-]+):[ \t]*(.*)$/);
    if (!match) continue;
    currentKey = match[1].toLowerCase();
    // First occurrence wins — Received: appears many times and we want the top.
    if (!(currentKey in headers)) headers[currentKey] = match[2];
    else currentKey = "";
  }
  return headers;
}

function addressesIn(value: string | undefined): string[] {
  const found = (value ?? "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
  return [...new Set(found.map((a) => a.toLowerCase()))];
}

function displayNameIn(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const named = value.match(/^\s*"?([^"<]+?)"?\s*</);
  return named ? decodeEncodedWords(named[1]).trim() : undefined;
}

function decodeBody(body: string, headers: Record<string, string>): string {
  const encoding = (headers["content-transfer-encoding"] ?? "").toLowerCase().trim();
  if (encoding === "quoted-printable") return decodeQuotedPrintable(body);
  if (encoding === "base64") return decodeBase64(body);
  return body;
}

/**
 * Walk a multipart message and return the best text we can find.
 *
 * Prefers text/plain. Falls back to text/html run through the same stripper
 * the Outlook adapter uses, so an HTML-only email still reaches the AI as
 * readable text rather than markup.
 */
function extractText(body: string, headers: Record<string, string>): string {
  const contentType = headers["content-type"] ?? "";
  const boundaryMatch = contentType.match(/boundary="?([^";]+)"?/i);

  if (!boundaryMatch) {
    const decoded = decodeBody(body, headers);
    return /text\/html/i.test(contentType) ? htmlToPlainText(decoded) : decoded;
  }

  const boundary = boundaryMatch[1].trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Non-capturing group on purpose: a capturing one makes String.split return
  // the captures interleaved with the parts, and the undefined entries then
  // throw on .trim().
  const parts = body.split(new RegExp(`^--${boundary}(?:--)?[ \\t]*$`, "m"));

  let html = "";
  for (const part of parts) {
    if (!part || !part.trim()) continue;
    const { headerText, body: partBody } = splitHeadersAndBody(part.replace(/^\n+/, ""));
    const partHeaders = parseHeaders(headerText);
    const partType = partHeaders["content-type"] ?? "";

    // Nested multipart (alternative inside mixed) — recurse.
    if (/multipart\//i.test(partType)) {
      const nested = extractText(partBody, partHeaders);
      if (nested.trim()) return nested;
      continue;
    }
    if (/text\/plain/i.test(partType)) {
      const text = decodeBody(partBody, partHeaders);
      if (text.trim()) return text;
    }
    if (/text\/html/i.test(partType) && !html) {
      html = htmlToPlainText(decodeBody(partBody, partHeaders));
    }
  }
  return html;
}

/** Decode a part's body to raw bytes, honouring its transfer encoding. */
function decodeBodyToBytes(body: string, headers: Record<string, string>): Buffer {
  const encoding = (headers["content-transfer-encoding"] ?? "").toLowerCase().trim();
  if (encoding === "base64") return Buffer.from(body.replace(/\s+/g, ""), "base64");
  if (encoding === "quoted-printable") return Buffer.from(decodeQuotedPrintable(body), "utf-8");
  return Buffer.from(body, "utf-8");
}

/**
 * Walk a multipart message collecting real attachments.
 *
 * "Real" means it has a filename and is not `inline` — a signature logo is
 * technically an attachment and is not one in any sense the office cares
 * about. Anything with a Content-Disposition of `attachment`, or a name in
 * its Content-Type, counts.
 */
function extractAttachments(body: string, headers: Record<string, string>): ParsedAttachment[] {
  const contentType = headers["content-type"] ?? "";
  const boundaryMatch = contentType.match(/boundary="?([^";]+)"?/i);
  if (!boundaryMatch) return [];

  const boundary = boundaryMatch[1].trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = body.split(new RegExp(`^--${boundary}(?:--)?[ \\t]*$`, "m"));

  const found: ParsedAttachment[] = [];
  for (const part of parts) {
    if (!part || !part.trim()) continue;
    const { headerText, body: partBody } = splitHeadersAndBody(part.replace(/^\n+/, ""));
    const partHeaders = parseHeaders(headerText);
    const partType = partHeaders["content-type"] ?? "";

    if (/multipart\//i.test(partType)) {
      found.push(...extractAttachments(partBody, partHeaders));
      continue;
    }

    const disposition = partHeaders["content-disposition"] ?? "";
    const nameMatch =
      disposition.match(/filename\*?="?([^";]+)"?/i) ?? partType.match(/name\*?="?([^";]+)"?/i);
    if (!nameMatch) continue;
    // Inline images are signature logos and tracking pixels, not documents.
    if (/^\s*inline/i.test(disposition)) continue;

    const bytes = decodeBodyToBytes(partBody, partHeaders);
    if (bytes.length === 0) continue;

    found.push({
      filename: decodeEncodedWords(nameMatch[1]).trim(),
      mimeType: (partType.split(";")[0] || "application/octet-stream").trim().toLowerCase(),
      bytes,
    });
  }
  return found;
}

/** Parse one raw RFC 822 message. */
export function parseEml(raw: string): ParsedEmail {
  const { headerText, body } = splitHeadersAndBody(raw);
  const headers = parseHeaders(headerText);

  const from = addressesIn(headers.from)[0] ?? "";
  const to = addressesIn(headers.to);
  const cc = addressesIn(headers.cc);

  const dateRaw = headers.date;
  let sentAt: string | undefined;
  if (dateRaw) {
    const parsed = new Date(dateRaw);
    if (!Number.isNaN(parsed.getTime())) sentAt = parsed.toISOString();
  }

  return {
    messageId: headers["message-id"]?.replace(/[<>]/g, "").trim() || undefined,
    from,
    fromName: displayNameIn(headers.from),
    to,
    cc,
    subject: decodeEncodedWords(headers.subject ?? "").trim() || "(no subject)",
    sentAt,
    body: extractText(body, headers).replace(/\r\n/g, "\n").trim(),
    participants: [...new Set([from, ...to, ...cc])].filter(Boolean),
    attachments: extractAttachments(body, headers),
  };
}

/**
 * Split an mbox file into individual raw messages.
 *
 * Google Takeout produces mbox, which is one download for a whole mailbox
 * rather than clicking "Download original" twenty times. Messages are
 * separated by a line starting `From ` (no colon — that is what distinguishes
 * the separator from a `From:` header).
 */
export function splitMbox(raw: string): string[] {
  const normalized = raw.replace(/\r\n/g, "\n");

  // The separator is `From <sender> <asctime date>`, e.g.
  //   From 1234@xxx Thu Jul 30 15:37:00 2026
  // Matching on the date shape is what distinguishes it from a `From:` header.
  // An earlier attempt used "a From line with no colon", which fails on every
  // real mbox because the timestamp contains colons.
  const separator = /^From \S+ [A-Za-z]{3} [A-Za-z]{3} {1,2}\d{1,2} \d{2}:\d{2}:\d{2} \d{4}[^\n]*$/m;

  const parts = normalized.split(separator);
  return parts.map((p) => p.replace(/^\n+/, "")).filter((p) => p.trim().length > 0);
}
