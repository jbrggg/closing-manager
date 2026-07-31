import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Point the data layer at a throwaway SQLite file BEFORE any module that
 * imports `@/lib/db` is loaded. Test files must import this helper first.
 */
const testDbPath = path.join(os.tmpdir(), `closing-manager-test-${randomUUID()}.db`);
process.env.CLOSING_MANAGER_DB_PATH = testDbPath;

export function cleanupTestDb() {
  try {
    fs.unlinkSync(testDbPath);
  } catch {
    // already gone
  }
}

export { testDbPath };
