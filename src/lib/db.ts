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

function createConnection(): DatabaseSync {
  const db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA foreign_keys = ON;");
  const schema = fs.readFileSync(SCHEMA_PATH, "utf-8");
  db.exec(schema);
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

export function resetDb() {
  try {
    fs.unlinkSync(DB_PATH);
  } catch {
    // no-op if file doesn't exist
  }
  global.__closingManagerDb = undefined;
  getDb();
}

export function nowIso(): string {
  return new Date().toISOString();
}
