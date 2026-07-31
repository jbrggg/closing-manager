import { all, get } from "@/lib/db";
import { EmailMessageRow, EmailThreadRow } from "@/types/models";
import { EmailProvider, MailboxSearchQuery } from "./provider";

// MOCK PROVIDER — clearly labeled. Reads seeded mailbox data from the app DB
// (standing in for "connected email account" until a real Gmail/MS365
// adapter is wired in). Never claims a live connection.
export class MockEmailProvider implements EmailProvider {
  readonly type = "MOCK" as const;

  async listRecentMessages(limit = 50): Promise<EmailMessageRow[]> {
    return all<EmailMessageRow>(
      `SELECT * FROM EmailMessage ORDER BY sentAt DESC LIMIT ?`,
      [limit]
    );
  }

  async getThread(threadId: string): Promise<EmailThreadRow | undefined> {
    return get<EmailThreadRow>(`SELECT * FROM EmailThread WHERE id = ?`, [threadId]);
  }

  async getMessagesForThread(threadId: string): Promise<EmailMessageRow[]> {
    return all<EmailMessageRow>(
      `SELECT * FROM EmailMessage WHERE threadId = ? ORDER BY sentAt ASC`,
      [threadId]
    );
  }

  async searchMailbox(query: MailboxSearchQuery): Promise<EmailMessageRow[]> {
    return (await this.searchMailboxScored(query)).map((s) => s.msg);
  }

  async searchMailboxScored(query: MailboxSearchQuery): Promise<{ msg: EmailMessageRow; score: number }[]> {
    const internalAddresses = new Set(
      all<{ emailAddress: string }>(`SELECT emailAddress FROM EmailAccount`).map((a) => a.emailAddress.toLowerCase())
    );
    const externalParticipants = (query.participants ?? []).filter(
      (p) => !internalAddresses.has(p.toLowerCase())
    );

    const all_msgs = all<EmailMessageRow>(`SELECT * FROM EmailMessage`);
    return all_msgs
      .map((msg) => ({ msg, score: this.scoreMatch(msg, { ...query, participants: externalParticipants }) }))
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score);
  }

  private scoreMatch(msg: EmailMessageRow, query: MailboxSearchQuery): number {
    let score = 0;
    const haystack = `${msg.subject} ${msg.bodyText} ${msg.quotedText ?? ""}`.toLowerCase();
    const toAddrs: string[] = JSON.parse(msg.toAddresses);

    if (query.participants?.length) {
      const participantHit = query.participants.some(
        (p) => msg.fromAddress.toLowerCase() === p.toLowerCase() || toAddrs.some((t) => t.toLowerCase() === p.toLowerCase())
      );
      if (participantHit) score += 3;
    }
    if (query.addressFragment) {
      if (haystack.includes(query.addressFragment.toLowerCase())) score += 4;
    }
    if (query.personNames?.length) {
      for (const name of query.personNames) {
        if (haystack.includes(name.toLowerCase())) score += 2;
      }
    }
    if (query.fileNumber && haystack.includes(query.fileNumber.toLowerCase())) score += 5;
    if (query.loanNumber && haystack.includes(query.loanNumber.toLowerCase())) score += 5;
    if (query.subjectKeywords?.length) {
      for (const kw of query.subjectKeywords) {
        if (msg.subject.toLowerCase().includes(kw.toLowerCase())) score += 1;
      }
    }
    return score;
  }
}

export const mockEmailProvider = new MockEmailProvider();
