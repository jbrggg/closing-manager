import { EmailMessageRow, EmailThreadRow } from "@/types/models";

// This interface is the contract a real Gmail or Microsoft 365 adapter would
// implement (OAuth-backed, incremental sync, webhooks, etc). The prototype
// only ships MockEmailProvider; adapters are added later without touching
// callers, since everything above this line only talks to EmailProvider.
// Methods are async because a real adapter makes a network call — the mock
// provider's implementations are async trivially, so both are interchangeable.
export interface EmailProvider {
  readonly type: "MOCK" | "GMAIL" | "MICROSOFT_365";
  listRecentMessages(limit?: number): Promise<EmailMessageRow[]>;
  getThread(threadId: string): Promise<EmailThreadRow | undefined>;
  getMessagesForThread(threadId: string): Promise<EmailMessageRow[]>;
  /**
   * Mailbox-wide search used for reconstructing split-across-email context.
   * Real adapters would translate this into provider search syntax
   * (Gmail search operators / Microsoft Graph $search).
   */
  searchMailbox(query: MailboxSearchQuery): Promise<EmailMessageRow[]>;
  /**
   * Same as searchMailbox but exposes the match score per message, so a
   * caller can distinguish strong evidence (shared participant, file/loan
   * number, address fragment) from a weak coincidence (name only) before
   * treating a found message as evidence for transaction identity.
   */
  searchMailboxScored(query: MailboxSearchQuery): Promise<{ msg: EmailMessageRow; score: number }[]>;
}

export interface MailboxSearchQuery {
  participants?: string[];
  addressFragment?: string;
  personNames?: string[];
  fileNumber?: string;
  loanNumber?: string;
  subjectKeywords?: string[];
  dateRangeStart?: string;
  dateRangeEnd?: string;
}
