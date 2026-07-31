import { EmailMessageRow, EmailThreadRow } from "@/types/models";

// -----------------------------------------------------------------------------
// Pure translation between Microsoft Graph's message shape and our internal
// row types. Kept free of network calls and database access on purpose, so
// it can be unit-tested against recorded Graph payloads without a live
// mailbox — see tests/graph-mapping.test.ts.
// -----------------------------------------------------------------------------

export interface GraphEmailAddress {
  emailAddress?: { name?: string; address?: string };
}

export interface GraphMessage {
  id: string;
  conversationId?: string;
  subject?: string | null;
  bodyPreview?: string;
  body?: { contentType?: string; content?: string };
  from?: GraphEmailAddress;
  sender?: GraphEmailAddress;
  toRecipients?: GraphEmailAddress[];
  ccRecipients?: GraphEmailAddress[];
  receivedDateTime?: string;
  sentDateTime?: string;
  hasAttachments?: boolean;
  webLink?: string;
  isDraft?: boolean;
  parentFolderId?: string;
  "@removed"?: { reason: string };
}

export interface GraphAttachment {
  id: string;
  name?: string;
  contentType?: string;
  size?: number;
}

/**
 * Graph returns message bodies as HTML by default. We store plain text
 * because every downstream consumer (extraction, evidence display) wants
 * readable prose, not markup.
 *
 * This is deliberately a conservative converter rather than a full HTML
 * parser: block-level tags become newlines, everything else is stripped,
 * entities are decoded. Real-world Outlook HTML is messy, so expect to
 * revisit this once you see actual agency mail.
 */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();
}

/**
 * Outlook quotes prior messages inline rather than exposing them as
 * separate fields. We split on the common reply markers so the AI can tell
 * "what this message says" from "what it is quoting" — the spec requires
 * examining quoted history without treating it as new information.
 */
export function splitQuotedText(body: string): { current: string; quoted: string | null } {
  const markers = [
    /^\s*-{2,}\s*Original Message\s*-{2,}\s*$/im,
    /^\s*_{5,}\s*$/m,
    /^\s*From:\s.+\s*$/im,
    /^\s*On .+ wrote:\s*$/im,
  ];

  let earliest = -1;
  for (const marker of markers) {
    const match = body.match(marker);
    if (match?.index !== undefined && (earliest === -1 || match.index < earliest)) {
      earliest = match.index;
    }
  }

  if (earliest <= 0) return { current: body.trim(), quoted: null };
  return {
    current: body.slice(0, earliest).trim(),
    quoted: body.slice(earliest).trim(),
  };
}

function addressOf(entry: GraphEmailAddress | undefined): string {
  return entry?.emailAddress?.address?.toLowerCase() ?? "";
}

/**
 * Maps a Graph message onto our EmailMessageRow.
 *
 * `mailboxAddress` is the connected account, used to decide direction:
 * anything the mailbox owner sent is OUTGOING (which is what drives
 * task-completion detection), everything else INCOMING.
 */
export function mapGraphMessage(graph: GraphMessage, mailboxAddress: string): EmailMessageRow {
  const rawBody =
    graph.body?.contentType?.toLowerCase() === "html"
      ? htmlToPlainText(graph.body?.content ?? "")
      : (graph.body?.content ?? graph.bodyPreview ?? "").trim();

  const { current, quoted } = splitQuotedText(rawBody);
  const from = addressOf(graph.from) || addressOf(graph.sender);
  const direction = from === mailboxAddress.toLowerCase() ? "OUTGOING" : "INCOMING";

  const recipients = (graph.toRecipients ?? []).map(addressOf).filter(Boolean);

  return {
    id: `ms-${graph.id}`,
    threadId: `ms-thread-${graph.conversationId ?? graph.id}`,
    providerMsgId: graph.id,
    fromAddress: from,
    toAddresses: JSON.stringify(recipients),
    subject: graph.subject ?? "(no subject)",
    bodyText: current,
    direction,
    sentAt: graph.sentDateTime ?? graph.receivedDateTime ?? new Date().toISOString(),
    quotedText: quoted,
  };
}

export function mapGraphThread(
  graph: GraphMessage,
  emailAccountId: string,
  participants: string[]
): EmailThreadRow {
  return {
    id: `ms-thread-${graph.conversationId ?? graph.id}`,
    emailAccountId,
    subject: graph.subject ?? "(no subject)",
    participants: JSON.stringify(Array.from(new Set(participants.filter(Boolean)))),
    createdAt: graph.receivedDateTime ?? graph.sentDateTime ?? new Date().toISOString(),
  };
}

export function participantsOf(graph: GraphMessage): string[] {
  return [
    addressOf(graph.from) || addressOf(graph.sender),
    ...(graph.toRecipients ?? []).map(addressOf),
    ...(graph.ccRecipients ?? []).map(addressOf),
  ].filter(Boolean);
}

/** Translates our provider-agnostic search into a Graph $search string. */
export function buildGraphSearchQuery(query: {
  participants?: string[];
  addressFragment?: string;
  personNames?: string[];
  fileNumber?: string;
  loanNumber?: string;
}): string {
  const terms: string[] = [];
  if (query.fileNumber) terms.push(`"${query.fileNumber}"`);
  if (query.loanNumber) terms.push(`"${query.loanNumber}"`);
  if (query.addressFragment) terms.push(`"${query.addressFragment}"`);
  for (const name of query.personNames ?? []) terms.push(`"${name}"`);
  for (const p of query.participants ?? []) terms.push(`"${p}"`);
  return terms.join(" OR ");
}

/**
 * Approximates MockEmailProvider's local scoring for results that Graph
 * already filtered server-side, so the pipeline's evidence-trust threshold
 * (score >= 3) keeps the same meaning against a live mailbox.
 */
export function scoreGraphResult(
  msg: EmailMessageRow,
  query: {
    participants?: string[];
    addressFragment?: string;
    personNames?: string[];
    fileNumber?: string;
    loanNumber?: string;
  }
): number {
  let score = 0;
  const haystack = `${msg.subject} ${msg.bodyText} ${msg.quotedText ?? ""}`.toLowerCase();
  const toAddrs: string[] = JSON.parse(msg.toAddresses);

  if (query.participants?.length) {
    const hit = query.participants.some(
      (p) => msg.fromAddress === p.toLowerCase() || toAddrs.includes(p.toLowerCase())
    );
    if (hit) score += 3;
  }
  if (query.addressFragment && haystack.includes(query.addressFragment.toLowerCase())) score += 4;
  for (const name of query.personNames ?? []) {
    if (haystack.includes(name.toLowerCase())) score += 2;
  }
  if (query.fileNumber && haystack.includes(query.fileNumber.toLowerCase())) score += 5;
  if (query.loanNumber && haystack.includes(query.loanNumber.toLowerCase())) score += 5;
  return score;
}
