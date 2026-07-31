// -----------------------------------------------------------------------------
// Retry policy for Microsoft Graph.
//
// Graph throttles aggressively on a real mailbox — a first full sync of a busy
// inbox will hit 429 almost immediately — and returns transient 503/504 during
// service maintenance. Before this existed, either one aborted the whole sync
// run and the delta link was never advanced, so the same page was re-fetched
// and re-throttled on the next attempt.
//
// Rules, in Microsoft's documented order of preference:
//   1. If the response carries Retry-After, wait exactly that long. Graph knows
//      when its own throttle window reopens; guessing is worse than obeying.
//   2. Otherwise back off exponentially with jitter, so two syncs that were
//      throttled together don't come back in lockstep.
//   3. Never retry a 4xx that isn't 429 — a 401 or 403 will fail identically
//      forever, and retrying just delays the real error reaching the human.
//
// Kept separate from microsoft-provider.ts so it can be tested against a fake
// fetch with a fake clock: the tests assert the delays without spending them.
// -----------------------------------------------------------------------------

export interface RetryOptions {
  /** Total attempts including the first. 4 attempts ≈ 1s + 2s + 4s worst case. */
  maxAttempts?: number;
  /** First backoff step in ms; doubles each attempt. */
  baseDelayMs?: number;
  /** Ceiling for a single wait, including a server-sent Retry-After. */
  maxDelayMs?: number;
  /** Injectable for tests. Defaults to a real timer. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable for tests. Defaults to Math.random. */
  random?: () => number;
  /** Called before each wait, for logging. */
  onRetry?: (info: { attempt: number; delayMs: number; reason: string }) => void;
}

const DEFAULTS = {
  maxAttempts: 4,
  baseDelayMs: 1000,
  maxDelayMs: 60_000,
};

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** True for the statuses where trying the exact same request again can succeed. */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 408 || (status >= 500 && status < 600);
}

/**
 * Reads Retry-After, which Graph may send as seconds ("30") or as an HTTP date.
 * Returns null when absent or unparseable, so the caller falls back to its own
 * backoff rather than treating a malformed header as "retry immediately".
 */
export function parseRetryAfter(headerValue: string | null, now = Date.now()): number | null {
  if (!headerValue) return null;
  const trimmed = headerValue.trim();

  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    return Number.isFinite(seconds) ? seconds * 1000 : null;
  }

  const asDate = Date.parse(trimmed);
  if (Number.isNaN(asDate)) return null;
  // A date in the past means "now"; never return a negative wait.
  return Math.max(0, asDate - now);
}

/** Exponential backoff with full jitter, clamped to maxDelayMs. */
export function backoffDelay(attempt: number, opts: Required<Pick<RetryOptions, "baseDelayMs" | "maxDelayMs">>, random: () => number): number {
  const exponential = Math.min(opts.baseDelayMs * 2 ** (attempt - 1), opts.maxDelayMs);
  // Full jitter, but never less than a quarter of the step — a near-zero wait
  // on a 429 just burns another request against the same throttle window.
  return Math.round(exponential * (0.25 + 0.75 * random()));
}

/**
 * Runs `attempt` until it returns a non-retryable response or the attempts run
 * out. `attempt` is called fresh each time (it re-reads the access token, which
 * matters when a sync spans a token expiry).
 *
 * Returns the final Response — including a failing one. Deciding what a 401
 * means is the caller's job; this function only decides what is worth retrying.
 */
export async function fetchWithRetry(
  attemptFn: () => Promise<Response>,
  options: RetryOptions = {}
): Promise<Response> {
  const maxAttempts = options.maxAttempts ?? DEFAULTS.maxAttempts;
  const baseDelayMs = options.baseDelayMs ?? DEFAULTS.baseDelayMs;
  const maxDelayMs = options.maxDelayMs ?? DEFAULTS.maxDelayMs;
  const sleep = options.sleep ?? realSleep;
  const random = options.random ?? Math.random;

  let lastNetworkError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let response: Response;
    try {
      response = await attemptFn();
    } catch (err) {
      // A dropped connection or DNS blip. Same treatment as a 503: worth one
      // more try, but the original error surfaces if we run out of attempts.
      lastNetworkError = err;
      if (attempt === maxAttempts) throw err;
      const delayMs = backoffDelay(attempt, { baseDelayMs, maxDelayMs }, random);
      options.onRetry?.({ attempt, delayMs, reason: `network error: ${String(err)}` });
      await sleep(delayMs);
      continue;
    }

    if (!isRetryableStatus(response.status)) return response;
    if (attempt === maxAttempts) return response;

    const serverAsked = parseRetryAfter(response.headers.get("retry-after"));
    const delayMs =
      serverAsked === null
        ? backoffDelay(attempt, { baseDelayMs, maxDelayMs }, random)
        : Math.min(serverAsked, maxDelayMs);

    options.onRetry?.({
      attempt,
      delayMs,
      reason:
        response.status === 429
          ? `rate limited (429)${serverAsked === null ? "" : `, server asked for ${Math.round(serverAsked / 1000)}s`}`
          : `server error (${response.status})`,
    });

    await sleep(delayMs);
  }

  // Unreachable: the loop either returns or throws. Kept for the type checker.
  throw lastNetworkError ?? new Error("Graph request failed after all retries.");
}
