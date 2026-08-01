/**
 * Ending a script that has made HTTP calls, without crashing on Windows.
 *
 * Observed 2026-07-31 on Node 24 / Windows 11: calling process.exit() while
 * Node's HTTP connection pool still holds a keep-alive socket aborts the
 * process with
 *
 *     Assertion failed: !(handle->flags & UV_HANDLE_CLOSING),
 *     file src\win\async.c, line 94
 *
 * printed AFTER the script's own output. Everything the script said was
 * correct; it just looked like it had crashed, which for a tool whose whole
 * job is telling someone whether their setup is healthy is close to the worst
 * possible ending. It does not happen on Linux — the same family as the
 * resetDb() EBUSY trap described at the top of CLAUDE.md.
 *
 * The fix is to close the pool first, then let Node exit on its own.
 */

/** The key Node stores its global fetch dispatcher under. */
const GLOBAL_DISPATCHER = Symbol.for("undici.globalDispatcher.1");

interface Closable {
  close?: () => Promise<void>;
  destroy?: () => Promise<void>;
}

/**
 * Sets the exit code and shuts down pooled HTTP connections so the process can
 * end by itself. Deliberately does NOT call process.exit() — letting the event
 * loop drain is what avoids the assertion.
 *
 * If Node ever renames that symbol this becomes a no-op and the script simply
 * takes a few seconds longer to exit, which is a safe way to be wrong.
 */
export async function exitCleanly(code: number): Promise<void> {
  process.exitCode = code;

  const dispatcher = (globalThis as unknown as Record<symbol, Closable>)[GLOBAL_DISPATCHER];
  try {
    await dispatcher?.close?.();
  } catch {
    // A pool that refuses to close politely gets destroyed instead.
    try {
      await dispatcher?.destroy?.();
    } catch {
      // Out of options; the keep-alive timeout will end it within a few seconds.
    }
  }
}
