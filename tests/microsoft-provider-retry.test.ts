import "./helpers/test-db";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { run, get } from "@/lib/db";
import { MicrosoftEmailProvider } from "@/lib/email/microsoft-provider";
import { encryptSecret } from "@/lib/auth/crypto";

// End-to-end through graphFetch, with fetch stubbed. Proves the retry policy
// is actually wired into the adapter rather than just existing beside it.
// Nothing here touches the network.

const ACCOUNT_ID = "acct-retry-test";
const MAILBOX = "closings@keystonetitle.com";

const originalFetch = globalThis.fetch;
const originalKey = process.env.APP_ENCRYPTION_KEY;

function graphPage(body: object) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function throttled(retryAfterSeconds: string) {
  return new Response(JSON.stringify({ error: { code: "TooManyRequests" } }), {
    status: 429,
    headers: { "content-type": "application/json", "retry-after": retryAfterSeconds },
  });
}

/** A provider whose waits are recorded instead of served. */
function providerWithFakeClock(waits: number[]) {
  return new MicrosoftEmailProvider(ACCOUNT_ID, MAILBOX, {
    sleep: async (ms: number) => {
      waits.push(ms);
    },
    random: () => 1,
    baseDelayMs: 1000,
  });
}

beforeEach(() => {
  process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

  run(`DELETE FROM EmailMessage`);
  run(`DELETE FROM EmailThread`);
  run(`DELETE FROM EmailAccount WHERE id = ?`, [ACCOUNT_ID]);
  run(
    `INSERT INTO EmailAccount (id, organizationId, providerType, emailAddress, connected, accessTokenEnc, tokenExpiresAt)
     VALUES (?, 'org-1', 'MICROSOFT_365', ?, 1, ?, ?)`,
    [
      ACCOUNT_ID,
      MAILBOX,
      encryptSecret("fake-access-token"),
      new Date(Date.now() + 3600_000).toISOString(),
    ]
  );
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.APP_ENCRYPTION_KEY;
  else process.env.APP_ENCRYPTION_KEY = originalKey;
  vi.restoreAllMocks();
});

describe("Microsoft adapter survives throttling", () => {
  it("retries a 429 and completes the sync", async () => {
    const waits: number[] = [];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(throttled("3"))
      .mockResolvedValueOnce(
        graphPage({
          value: [
            {
              id: "msg-1",
              conversationId: "conv-1",
              subject: "512 Oak Ave — commitment",
              body: { contentType: "text", content: "Please send the commitment." },
              from: { emailAddress: { address: "carla@abcrealty.com" } },
              toRecipients: [{ emailAddress: { address: MAILBOX } }],
              receivedDateTime: "2026-07-30T10:00:00Z",
              sentDateTime: "2026-07-30T10:00:00Z",
              isDraft: false,
            },
          ],
          "@odata.deltaLink": "https://graph.microsoft.com/v1.0/delta?token=NEXT",
        })
      );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const stored = await providerWithFakeClock(waits).syncMailbox();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(waits).toEqual([3000]); // obeyed Retry-After, did not guess
    expect(stored).toHaveLength(1);

    // The delta link advanced, so the next sync resumes rather than refetching.
    const account = get<{ deltaLink: string | null; lastSyncError: string | null }>(
      `SELECT deltaLink, lastSyncError FROM EmailAccount WHERE id = ?`,
      [ACCOUNT_ID]
    );
    expect(account?.deltaLink).toContain("token=NEXT");
    expect(account?.lastSyncError).toBeNull();
  });

  it("records a plain-English error when throttling never lets up", async () => {
    const waits: number[] = [];
    globalThis.fetch = vi.fn(async () => throttled("2")) as unknown as typeof fetch;

    await expect(providerWithFakeClock(waits).syncMailbox()).rejects.toThrow(/still rate limiting/i);

    const account = get<{ lastSyncError: string | null }>(
      `SELECT lastSyncError FROM EmailAccount WHERE id = ?`,
      [ACCOUNT_ID]
    );
    expect(account?.lastSyncError).toMatch(/still rate limiting/i);
    expect(account?.lastSyncError).toMatch(/No mail was lost/i);
  });

  it("does not retry a 401 — the real error reaches the human immediately", async () => {
    const waits: number[] = [];
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { code: "InvalidAuthenticationToken" } }), {
          status: 401,
          headers: { "content-type": "application/json" },
        })
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(providerWithFakeClock(waits).syncMailbox()).rejects.toThrow(/401/);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(waits).toEqual([]);
  });

  it("retries a 503 with backoff, then succeeds", async () => {
    const waits: number[] = [];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(graphPage({ value: [], "@odata.deltaLink": "https://x/delta?token=A" }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const stored = await providerWithFakeClock(waits).syncMailbox();

    expect(stored).toEqual([]);
    expect(waits).toEqual([1000, 2000]);
  });
});
