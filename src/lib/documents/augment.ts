import { all } from "@/lib/db";
import { EmailMessageRow } from "@/types/models";
import { asAttachmentContext } from "./extract-text";

/**
 * PUTTING DOCUMENT TEXT IN FRONT OF THE AI
 *
 * An email that says "see attached" and nothing else is common, and until now
 * it gave the AI nothing to read. This appends the text of a message's
 * attachments to the body the AI sees, clearly labelled with the filename it
 * came from.
 *
 * WHY IT WORKS THIS WAY
 *
 * The AIProvider interface takes an EmailMessageRow. Rather than widen that
 * interface — which would mean changing both providers, every test double and
 * every call site — this returns a copy of the message with the document text
 * appended to bodyText. Both the rule-based engine and the model-backed
 * provider then benefit without either knowing attachments exist.
 *
 * The labelling matters for evidence, not just for tidiness. "The lender said
 * this in the email" and "this appeared inside an attached settlement
 * statement" are both evidence, but they are not equally direct, and a fact's
 * provenance should be able to name the document it came from.
 */

interface AttachmentTextRow {
  messageId: string;
  filename: string;
  extractedText: string | null;
  extractionStatus: string | null;
}

/**
 * Return copies of these messages with their attachment text appended.
 *
 * Messages with no attachments — the majority — are returned unchanged, and
 * the whole thing is one query regardless of how many messages are passed, so
 * this stays cheap on a long thread.
 */
export function withAttachmentText(messages: EmailMessageRow[]): EmailMessageRow[] {
  if (messages.length === 0) return messages;

  const ids = messages.map((m) => m.id);
  const placeholders = ids.map(() => "?").join(",");
  const rows = all<AttachmentTextRow>(
    `SELECT messageId, filename, extractedText, extractionStatus
       FROM EmailAttachment
      WHERE messageId IN (${placeholders})
        AND extractionStatus = 'EXTRACTED'
        AND extractedText IS NOT NULL
        AND extractedText != ''
      ORDER BY filename`,
    ids
  );
  if (rows.length === 0) return messages;

  const byMessage = new Map<string, AttachmentTextRow[]>();
  for (const r of rows) {
    const list = byMessage.get(r.messageId) ?? [];
    list.push(r);
    byMessage.set(r.messageId, list);
  }

  return messages.map((m) => {
    const attachments = byMessage.get(m.id);
    if (!attachments?.length) return m;

    const appended = attachments
      .map((a) => asAttachmentContext(a.filename, a.extractedText!))
      .join("");

    return { ...m, bodyText: `${m.bodyText ?? ""}${appended}` };
  });
}

/** Convenience for a single message. */
export function withAttachmentTextOne(message: EmailMessageRow): EmailMessageRow {
  return withAttachmentText([message])[0];
}
