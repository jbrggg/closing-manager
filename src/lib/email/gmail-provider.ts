import { EmailMessageRow, EmailThreadRow } from "@/types/models";
import { EmailProvider, MailboxSearchQuery } from "./provider";

// -----------------------------------------------------------------------------
// GMAIL ADAPTER — SCAFFOLD, NOT WIRED UP.
//
// This class satisfies the same EmailProvider contract as MockEmailProvider
// so it can be dropped into src/lib/email/index.ts's provider factory once
// real credentials exist. Nothing here has been exercised against a live
// Gmail account — treat every method body as a documented starting point,
// not tested code.
//
// Setup checklist for a real implementation:
//   1. Create a Google Cloud project, enable the Gmail API, create an OAuth
//      2.0 Client ID (Web application) with a redirect URI such as
//      /api/v1/integrations/gmail/callback.
//   2. Store GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET in .env (see .env.example).
//   3. Request scopes: https://www.googleapis.com/auth/gmail.readonly
//      (add gmail.send only if/when outgoing-detection needs it beyond what
//      history already shows — reading Sent is covered by gmail.readonly).
//   4. Implement the OAuth redirect + callback route, exchange the code for
//      access/refresh tokens, and store them ENCRYPTED against the
//      EmailAccount row (never store raw tokens in plaintext — see
//      "Security" in the project README).
//   5. Use Gmail's `users.history.list` for incremental sync (cheaper than
//      re-listing the whole mailbox) and `users.watch` + Cloud Pub/Sub for
//      push notifications instead of polling.
//   6. Translate MailboxSearchQuery into Gmail's search operator syntax,
//      e.g. `from:x OR to:x`, `"file number"`, `after:YYYY/MM/DD` — see
//      buildGmailQuery() below for a starting translation.
// -----------------------------------------------------------------------------
export class GmailEmailProvider implements EmailProvider {
  readonly type = "GMAIL" as const;

  constructor(private readonly accessToken: string) {}

  async listRecentMessages(limit = 50): Promise<EmailMessageRow[]> {
    throw new NotImplementedError("GmailEmailProvider.listRecentMessages", {
      endpoint: `GET https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${limit}`,
      note: "List message IDs, then batch-fetch full messages (format=full) and map to EmailMessageRow.",
    });
  }

  async getThread(threadId: string): Promise<EmailThreadRow | undefined> {
    throw new NotImplementedError("GmailEmailProvider.getThread", {
      endpoint: `GET https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}`,
    });
  }

  async getMessagesForThread(threadId: string): Promise<EmailMessageRow[]> {
    throw new NotImplementedError("GmailEmailProvider.getMessagesForThread", {
      endpoint: `GET https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}?format=full`,
      note: "Gmail returns the whole thread's messages in one call — map each to EmailMessageRow, decoding base64url MIME parts for bodyText.",
    });
  }

  async searchMailbox(query: MailboxSearchQuery): Promise<EmailMessageRow[]> {
    throw new NotImplementedError("GmailEmailProvider.searchMailbox", {
      endpoint: `GET https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(buildGmailQuery(query))}`,
    });
  }

  async searchMailboxScored(query: MailboxSearchQuery): Promise<{ msg: EmailMessageRow; score: number }[]> {
    // A real adapter can't reproduce the mock's local scoring (Gmail already
    // ranks/filters server-side via `q=`). A reasonable approach: call
    // searchMailbox() and assign a flat score based on which query fields
    // were present (mirroring MockEmailProvider's weighting), so
    // process-email.ts's score>=3 evidence-trust threshold still behaves
    // sensibly against a live mailbox.
    throw new NotImplementedError("GmailEmailProvider.searchMailboxScored", {
      note: "See MockEmailProvider.scoreMatch for the scoring convention this must approximate.",
    });
  }
}

/** Translates our provider-agnostic search query into Gmail search syntax. */
function buildGmailQuery(query: MailboxSearchQuery): string {
  const parts: string[] = [];
  if (query.participants?.length) {
    parts.push(`(${query.participants.map((p) => `from:${p} OR to:${p}`).join(" OR ")})`);
  }
  if (query.fileNumber) parts.push(`"${query.fileNumber}"`);
  if (query.loanNumber) parts.push(`"${query.loanNumber}"`);
  if (query.addressFragment) parts.push(`"${query.addressFragment}"`);
  if (query.personNames?.length) parts.push(query.personNames.map((n) => `"${n}"`).join(" OR "));
  if (query.dateRangeStart) parts.push(`after:${query.dateRangeStart}`);
  if (query.dateRangeEnd) parts.push(`before:${query.dateRangeEnd}`);
  return parts.join(" ");
}

class NotImplementedError extends Error {
  constructor(method: string, detail: Record<string, string>) {
    super(
      `${method} is a scaffold, not a working implementation. ${detail.note ?? ""} ${
        detail.endpoint ? `Suggested call: ${detail.endpoint}` : ""
      }`.trim()
    );
    this.name = "NotImplementedError";
  }
}
