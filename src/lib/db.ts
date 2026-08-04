import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

// -----------------------------------------------------------------------------
// Runtime data layer.
//
// See prisma/schema.prisma for the canonical, documented production data model
// (PostgreSQL target). This module implements the identical shape against
// SQLite via Node's built-in `node:sqlite`, because this sandbox environment
// cannot reach Prisma's engine CDN. Swapping to @prisma/client later requires
// no schema redesign — only replacing this file's query implementations.
// -----------------------------------------------------------------------------

declare global {
  // eslint-disable-next-line no-var
  var __closingManagerDb: DatabaseSync | undefined;
}

const DB_PATH = process.env.CLOSING_MANAGER_DB_PATH ?? path.join(process.cwd(), "db", "app.db");
const SCHEMA_PATH = path.join(process.cwd(), "db", "schema.sql");

/**
 * Columns added to a table that already exists somewhere.
 *
 * `db/schema.sql` is all `CREATE TABLE IF NOT EXISTS`, which means a new column
 * reaches a brand-new database and silently misses every database that already
 * exists — including the owner's. That failure shows up as "no such column" at
 * the moment the feature is used, which is the worst time to find out.
 *
 * This is deliberately not a migration framework. Adding a column is the only
 * schema change that has ever been needed after the fact; anything structural
 * (renaming, dropping, changing a type) should be done properly rather than
 * bolted on here.
 */
const ADDITIVE_COLUMNS: { table: string; column: string; definition: string }[] = [
  // What the last sync actually did, for the dashboard's sync health panel.
  { table: "EmailAccount", column: "lastSyncSummary", definition: "TEXT" },
  { table: "EmailAccount", column: "lastSyncFinishedAt", definition: "TEXT" },
  // Where an attachment's bytes live, and their hash. NULL on anything
  // ingested before document storage existed. See src/lib/storage/.
  { table: "EmailAttachment", column: "storageKey", definition: "TEXT" },
  { table: "EmailAttachment", column: "sha256", definition: "TEXT" },
  // Text read out of the document, and how that went. extractionStatus is the
  // interesting one: a count of EMPTY over a few weeks of real mail is what
  // says whether OCR is ever worth building. See src/lib/documents/.
  { table: "EmailAttachment", column: "extractedText", definition: "TEXT" },
  { table: "EmailAttachment", column: "extractionStatus", definition: "TEXT" },
  { table: "EmailAttachment", column: "pageCount", definition: "INTEGER" },
];

function applyAdditiveColumns(db: DatabaseSync) {
  for (const { table, column, definition } of ADDITIVE_COLUMNS) {
    const exists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`).get(table);
    if (!exists) continue;

    const columns = db.prepare(`PRAGMA table_info("${table}")`).all() as { name: string }[];
    if (columns.some((c) => c.name === column)) continue;

    db.exec(`ALTER TABLE "${table}" ADD COLUMN "${column}" ${definition};`);
  }
}

function createConnection(): DatabaseSync {
  const db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA foreign_keys = ON;");
  const schema = fs.readFileSync(SCHEMA_PATH, "utf-8");
  db.exec(schema);
  applyAdditiveColumns(db);
  return db;
}

export function getDb(): DatabaseSync {
  if (!global.__closingManagerDb) {
    global.__closingManagerDb = createConnection();
  }
  return global.__closingManagerDb;
}

// Generic helpers -------------------------------------------------------------

export function all<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T[] {
  const db = getDb();
  const stmt = db.prepare(sql);
  const rows = stmt.all(...(params as never[])) as T[];
  // node:sqlite returns null-prototype row objects, which Next.js rejects
  // when passed from a Server Component to a Client Component. Normalize
  // to plain objects here so every caller gets safely-serializable rows.
  return rows.map((r) => ({ ...r }));
}

export function get<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T | undefined {
  const db = getDb();
  const stmt = db.prepare(sql);
  const row = stmt.get(...(params as never[])) as T | undefined;
  return row ? ({ ...row } as T) : undefined;
}

export function run(sql: string, params: unknown[] = []) {
  const db = getDb();
  const stmt = db.prepare(sql);
  return stmt.run(...(params as never[]));
}

/** Close the open connection, if there is one. Safe to call repeatedly. */
export function closeDb() {
  try {
    global.__closingManagerDb?.close();
  } catch {
    // already closed, or never opened
  }
  global.__closingManagerDb = undefined;
}

/**
 * Delete every row in every table, leaving the schema intact.
 *
 * This is the fallback path for `resetDb()` when the database file cannot be
 * removed — see the Windows note there. Exported so it can be tested directly,
 * because on Linux the unlink always succeeds and this branch would otherwise
 * never run in CI.
 */
export function clearAllTables() {
  const db = getDb();
  const tables = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
    .all() as { name: string }[];

  db.exec("PRAGMA foreign_keys = OFF;");
  for (const t of tables) db.exec(`DELETE FROM "${t.name}";`);
  db.exec("PRAGMA foreign_keys = ON;");
}

/**
 * Throw the database away and start from an empty one.
 *
 * WINDOWS, THE HARD WAY: this used to be `fs.unlinkSync()` inside a bare
 * try/catch. On Linux, unlinking a file that still has an open handle
 * succeeds — the old inode lives on until the handle closes, and the next
 * connection creates a fresh file. On Windows it throws EBUSY/EPERM instead,
 * the catch swallowed it, and `getDb()` then opened a SECOND connection to
 * the same still-populated file. The reset silently did nothing, and every
 * test that reseeds fixed ids failed with "UNIQUE constraint failed".
 *
 * Two changes: close the handle before unlinking, and if the file still
 * cannot be removed, empty it instead. A reset must always be a reset.
 */
export function resetDb() {
  closeDb();

  let removed = true;
  try {
    fs.unlinkSync(DB_PATH);
  } catch (err) {
    // ENOENT just means there was nothing to delete, which is fine. Anything
    // else (a lock held by antivirus, an indexer, a stray handle) means the
    // file survived and we have to clear it by hand.
    removed = (err as NodeJS.ErrnoException)?.code === "ENOENT";
  }

  getDb();
  if (!removed) clearAllTables();
}

export function nowIso(): string {
  return new Date().toISOString();
}
