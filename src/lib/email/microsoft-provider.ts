import { all, get, run } from "@/lib/db";
import { EmailMessageRow, EmailThreadRow } from "@/types/models";
import { EmailProvider, MailboxSearchQuery } from "./provider";
import { getValidAccessToken, markSynced, markSyncError } from "./microsoft-oauth";
import {
  GraphMessage,
  mapGraphMessage,
  mapGraphThread,
  participantsOf,
  buildGraphSearchQuery,
  scoreGraphResult,
} from "./graph-mapping";
import { fetchWithRetry, parseRetryAfter, RetryOptions } from "./graph-retry";

// -----------------------------------------------------------------------------
// MICROSOFT 365 / OUTLOOK ADAPTER — real Microsoft Graph implementation.
//
// Status: the code is complete and the pure mapping layer is unit-tested
// (tests/graph-mapping.test.ts), but it has NEVER been run against a live
// mailbox — no Microsoft tenant was available while building. Treat the
// first real connection as a debugging session, not a deployment.
//
// Messages fetched from Graph are cached into our own EmailMessage /
// EmailThread tables. That is deliberate: the AI pipeline, evidence viewer,
// and audit trail all reference stable internal IDs, and re-fetching from
// Graph every time would be slow, rate-limited, and would break evidence
// links if a message were later deleted from the mailbox.
// -----------------------------------------------------------------------------

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

export class MicrosoftEmailProvider implements EmailProvider {
  readonly type = "MICROSOFT_365" as const;

  constructor(
    private readonly emailAccountId: string,
    private readonly mailboxAddress: string,
    /** Overridable so tests can run the retry path without real waiting. */
    private readonly retryOptions: RetryOptions = {}
  ) {}

  private async graphFetch<T>(pathOrUrl: string, init: RequestInit = {}): Promise<T> {
    const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${GRAPH_BASE}${pathOrUrl}`;

    // The token is fetched inside the retry closure, not outside it: a first
    // sync of a large mailbox can spend longer being throttled than an access
    // token lives, and a retry carrying an expired token just fails again.
    const response = await fetchWithRetry(
      async () => {
        const token = await getValidAccessToken(this.emailAccountId);
        return fetch(url, {
          ...init,
          headers: {
            ...(init.headers ?? {}),
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
          },
        });
      },
      {
        ...this.retryOptions,
        onRetry: ({ attempt, delayMs, reason }) => {
          console.warn(
            `[microsoft-provider] ${reason}; waiting ${Math.round(delayMs / 1000)}s before attempt ${attempt + 1} (${url})`
          );
        },
      }
    );

    if (response.status === 429) {
      // Still throttled after every retry. Say so plainly — this is the one
      // Graph error that means "wait", not "something is misconfigured".
      const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
      const wait = retryAfter === null ? "a few minutes" : `${Math.round(retryAfter / 1000)}s`;
      const message =
        `Microsoft Graph is still rate limiting this mailbox after several retries. ` +
        `Try again in ${wait}. No mail was lost — the next sync resumes where this one stopped.`;
      markSyncError(this.emailAccountId, message);
      throw new Error(message);
    }
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      const message = `Graph request failed (${response.status}) for ${url}: ${text.slice(0, 300)}`;
      markSyncError(this.emailAccountId, message);
      throw new Error(message);
    }
    return (await response.json()) as T;
  }

  /** Writes fetched messages into our tables, skipping ones already stored. */
  private cacheMessages(messages: GraphMessage[]): EmailMessageRow[] {
    const stored: EmailMessageRow[] = [];

    for (const graph of messages) {
      if (graph["@removed"]) continue; // deletion tombstone from a delta query
      if (graph.isDraft) continue;

      const row = mapGraphMessage(graph, this.mailboxAddress);
      if (get(`SELECT id FROM EmailMessage WHERE id = ?`, [row.id])) {
        stored.push(row);
        continue;
      }

      const thread = mapGraphThread(graph, this.emailAccountId, participantsOf(graph));
      if (!get(`SELECT id FROM EmailThread WHERE id = ?`, [thread.id])) {
        run(
          `INSERT INTO EmailThread (id, emailAccountId, subject, participants, createdAt) VALUES (?, ?, ?, ?, ?)`,
          [thread.id, thread.emailAccountId, thread.subject, thread.participants, thread.createdAt]
        );
      }

      run(
        `INSERT INTO EmailMessage (id, threadId, providerMsgId, fromAddress, toAddresses, subject, bodyText, direction, sentAt, quotedText)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          row.id,
          row.threadId,
          row.providerMsgId,
          row.fromAddress,
          row.toAddresses,
          row.subject,
          row.bodyText,
          row.direction,
          row.sentAt,
          row.quotedText,
        ]
      );
      stored.push(row);
    }

    return stored;
  }

  /**
   * Initial or incremental sync. Uses Graph's delta query so repeat syncs
   * only transfer what changed. Returns the messages newly stored, which is
   * what the caller should feed into the AI pipeline.
   */
  async syncMailbox(pageLimit = 5): Promise<EmailMessageRow[]> {
    const account = get<{ deltaLink: string | null }>(
      `SELECT deltaLink FROM EmailAccount WHERE id = ?`,
      [this.emailAccountId]
    );

    let url =
      account?.deltaLink ??
      `${GRAPH_BASE}/me/mailFolders/inbox/messages/delta?$select=id,conversationId,subject,body,bodyPreview,from,sender,toRecipients,ccRecipients,receivedDateTime,sentDateTime,hasAttachments,webLink,isDraft`;

    const collected: EmailMessageRow[] = [];
    let nextDeltaLink: string | null = null;

    for (let page = 0; page < pageLimit; page++) {
      const data: {
        value: GraphMessage[];
        "@odata.nextLink"?: string;
        "@odata.deltaLink"?: string;
      } = await this.graphFetch(url);

      collected.push(...this.cacheMessages(data.value ?? []));

      if (data["@odata.deltaLink"]) {
        nextDeltaLink = data["@odata.deltaLink"];
        break;
      }
      if (!data["@odata.nextLink"]) break;
      url = data["@odata.nextLink"];
    }

    markSynced(this.emailAccountId, nextDeltaLink);
    return collected;
  }

  async listRecentMessages(limit = 50): Promise<EmailMessageRow[]> {
    return all<EmailMessageRow>(
      `SELECT * FROM EmailMessage WHERE threadId IN (SELECT id FROM EmailThread WHERE emailAccountId = ?)
       ORDER BY sentAt DESC LIMIT ?`,
      [this.emailAccountId, limit]
    );
  }

  async getThread(threadId: string): Promise<EmailThreadRow | undefined> {
    return get<EmailThreadRow>(`SELECT * FROM EmailThread WHERE id = ?`, [threadId]);
  }

  /**
   * Returns every message in a conversation. Fetches from Graph first so a
   * reply that arrived out of order is still present, then reads back the
   * complete cached thread.
   */
  async getMessagesForThread(threadId: string): Promise<EmailMessageRow[]> {
    const conversationId = threadId.replace(/^ms-thread-/, "");
    try {
      const data: { value: GraphMessage[] } = await this.graphFetch(
        `/me/messages?$filter=conversationId eq '${encodeURIComponent(conversationId)}'&$orderby=receivedDateTime asc&$select=id,conversationId,subject,body,bodyPreview,from,sender,toRecipients,ccRecipients,receivedDateTime,sentDateTime,hasAttachments,webLink,isDraft`
      );
      this.cacheMessages(data.value ?? []);
    } catch (err) {
      // Fall back to whatever is cached rather than failing the whole
      // pipeline run — a partial thread still yields useful extraction.
      console.warn(`[microsoft-provider] thread fetch failed, using cache: ${String(err)}`);
    }

    return all<EmailMessageRow>(`SELECT * FROM EmailMessage WHERE threadId = ? ORDER BY sentAt ASC`, [
      threadId,
    ]);
  }

  async searchMailbox(query: MailboxSearchQuery): Promise<EmailMessageRow[]> {
    return (await this.searchMailboxScored(query)).map((s) => s.msg);
  }

  async searchMailboxScored(
    query: MailboxSearchQuery
  ): Promise<{ msg: EmailMessageRow; score: number }[]> {
    const searchTerm = buildGraphSearchQuery(query);
    if (!searchTerm) return [];

    try {
      const data: { value: GraphMessage[] } = await this.graphFetch(
        `/me/messages?$search=${encodeURIComponent(`"${searchTerm}"`)}&$top=25&$select=id,conversationId,subject,body,bodyPreview,from,sender,toRecipients,ccRecipients,receivedDateTime,sentDateTime,hasAttachments,webLink,isDraft`,
        { headers: { ConsistencyLevel: "eventual" } }
      );
      this.cacheMessages(data.value ?? []);
    } catch (err) {
      console.warn(`[microsoft-provider] mailbox search failed, using cache: ${String(err)}`);
    }

    // Score against our cached copies so the evidence-trust threshold in
    // process-email.ts behaves identically to the mock provider.
    const cached = all<EmailMessageRow>(
      `SELECT * FROM EmailMessage WHERE threadId IN (SELECT id FROM EmailThread WHERE emailAccountId = ?)`,
      [this.emailAccountId]
    );
    return cached
      .map((msg) => ({ msg, score: scoreGraphResult(msg, query) }))
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score);
  }
}
