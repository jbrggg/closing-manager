import { describe, it, expect, vi } from "vitest";
import {
  fetchWithRetry,
  parseRetryAfter,
  backoffDelay,
  isRetryableStatus,
} from "@/lib/email/graph-retry";

// These tests use a fake sleep, so the delays are asserted rather than spent.
// Nothing here touches the network.
function fakeClock() {
  const waits: number[] = [];
  return {
    waits,
    sleep: async (ms: number) => {
      waits.push(ms);
    },
  };
}

/** Deterministic "random" so jittered delays are exactly predictable. */
const noJitter = () => 1;

function reply(status: number, headers: Record<string, string> = {}) {
  return new Response(status === 204 ? null : JSON.stringify({ value: [] }), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("Retry-After parsing", () => {
  it("reads a plain seconds value", () => {
    expect(parseRetryAfter("30")).toBe(30_000);
  });

  it("reads an HTTP date", () => {
    const now = Date.parse("2026-07-31T12:00:00Z");
    expect(parseRetryAfter("Fri, 31 Jul 2026 12:00:45 GMT", now)).toBe(45_000);
  });

  it("never returns a negative wait for a date already past", () => {
    const now = Date.parse("2026-07-31T12:00:00Z");
    expect(parseRetryAfter("Fri, 31 Jul 2026 11:59:00 GMT", now)).toBe(0);
  });

  it("returns null when the header is absent or nonsense", () => {
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter("soon please")).toBeNull();
  });
});

describe("which statuses are worth retrying", () => {
  it("retries throttling and server errors", () => {
    for (const status of [429, 408, 500, 502, 503, 504]) {
      expect(isRetryableStatus(status), `status ${status}`).toBe(true);
    }
  });

  it("does not retry auth or permission failures", () => {
    // The whole point: a 401 from a bad secret must reach the human fast,
    // not after four rounds of backoff.
    for (const status of [400, 401, 403, 404]) {
      expect(isRetryableStatus(status), `status ${status}`).toBe(false);
    }
  });
});

describe("backoff", () => {
  it("doubles each attempt", () => {
    const opts = { baseDelayMs: 1000, maxDelayMs: 60_000 };
    expect(backoffDelay(1, opts, noJitter)).toBe(1000);
    expect(backoffDelay(2, opts, noJitter)).toBe(2000);
    expect(backoffDelay(3, opts, noJitter)).toBe(4000);
  });

  it("clamps at the ceiling", () => {
    expect(backoffDelay(20, { baseDelayMs: 1000, maxDelayMs: 5000 }, noJitter)).toBe(5000);
  });

  it("jitters but never collapses to nothing", () => {
    // Full jitter with random()=0 would be a zero wait, which would just burn
    // another request inside the same throttle window.
    const delay = backoffDelay(1, { baseDelayMs: 1000, maxDelayMs: 60_000 }, () => 0);
    expect(delay).toBe(250);
  });
});

describe("fetchWithRetry", () => {
  it("returns a success first time without waiting", async () => {
    const clock = fakeClock();
    const attempt = vi.fn(async () => reply(200));

    const response = await fetchWithRetry(attempt, { sleep: clock.sleep, random: noJitter });

    expect(response.status).toBe(200);
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(clock.waits).toEqual([]);
  });

  it("honours Retry-After on a 429 instead of guessing", async () => {
    const clock = fakeClock();
    const attempt = vi
      .fn()
      .mockResolvedValueOnce(reply(429, { "retry-after": "12" }))
      .mockResolvedValueOnce(reply(200));

    const response = await fetchWithRetry(attempt, { sleep: clock.sleep, random: noJitter });

    expect(response.status).toBe(200);
    expect(clock.waits).toEqual([12_000]);
  });

  it("falls back to exponential backoff when Retry-After is missing", async () => {
    const clock = fakeClock();
    const attempt = vi
      .fn()
      .mockResolvedValueOnce(reply(503))
      .mockResolvedValueOnce(reply(503))
      .mockResolvedValueOnce(reply(200));

    const response = await fetchWithRetry(attempt, {
      sleep: clock.sleep,
      random: noJitter,
      baseDelayMs: 1000,
    });

    expect(response.status).toBe(200);
    expect(clock.waits).toEqual([1000, 2000]);
  });

  it("caps a server-sent Retry-After at maxDelayMs", async () => {
    // A throttled tenant can be told to wait an hour. We surface that as an
    // error rather than parking a scheduled task for an hour.
    const clock = fakeClock();
    const attempt = vi
      .fn()
      .mockResolvedValueOnce(reply(429, { "retry-after": "3600" }))
      .mockResolvedValueOnce(reply(200));

    await fetchWithRetry(attempt, { sleep: clock.sleep, random: noJitter, maxDelayMs: 30_000 });

    expect(clock.waits).toEqual([30_000]);
  });

  it("gives up after maxAttempts and returns the last failing response", async () => {
    const clock = fakeClock();
    const attempt = vi.fn(async () => reply(429, { "retry-after": "1" }));

    const response = await fetchWithRetry(attempt, {
      sleep: clock.sleep,
      random: noJitter,
      maxAttempts: 3,
    });

    expect(response.status).toBe(429);
    expect(attempt).toHaveBeenCalledTimes(3);
    expect(clock.waits).toEqual([1000, 1000]); // no wait after the final attempt
  });

  it("does not retry a 401 — a bad secret fails identically forever", async () => {
    const clock = fakeClock();
    const attempt = vi.fn(async () => reply(401));

    const response = await fetchWithRetry(attempt, { sleep: clock.sleep, random: noJitter });

    expect(response.status).toBe(401);
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(clock.waits).toEqual([]);
  });

  it("retries a dropped connection, then rethrows if it never recovers", async () => {
    const clock = fakeClock();
    const attempt = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });

    await expect(
      fetchWithRetry(attempt, { sleep: clock.sleep, random: noJitter, maxAttempts: 3 })
    ).rejects.toThrow("ECONNRESET");

    expect(attempt).toHaveBeenCalledTimes(3);
  });

  it("recovers when a dropped connection succeeds on the retry", async () => {
    const clock = fakeClock();
    const attempt = vi
      .fn()
      .mockRejectedValueOnce(new Error("socket hang up"))
      .mockResolvedValueOnce(reply(200));

    const response = await fetchWithRetry(attempt, { sleep: clock.sleep, random: noJitter });

    expect(response.status).toBe(200);
    expect(clock.waits).toEqual([1000]);
  });

  it("re-reads the token on every attempt, so a sync can outlive a token", async () => {
    // Regression guard: the token used to be fetched once outside the retry
    // loop, which meant a long throttle wait retried with an expired token.
    const clock = fakeClock();
    const tokensUsed: number[] = [];
    let calls = 0;

    const attempt = vi.fn(async () => {
      tokensUsed.push(++calls);
      return calls < 3 ? reply(503) : reply(200);
    });

    await fetchWithRetry(attempt, { sleep: clock.sleep, random: noJitter });

    expect(tokensUsed).toEqual([1, 2, 3]);
  });
});
