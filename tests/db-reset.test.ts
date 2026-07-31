import "./helpers/test-db";
import { describe, it, expect, beforeEach } from "vitest";
import { all, run, resetDb, clearAllTables, closeDb, getDb, nowIso } from "@/lib/db";

// REGRESSION SUITE for a Windows-only bug found on 2026-07-31.
//
// resetDb() used to be `fs.unlinkSync(DB_PATH)` in a bare try/catch, with the
// open connection never closed. On Linux, unlinking a file that still has an
// open handle succeeds, so the next getDb() made a fresh empty file and every
// test passed. On Windows the unlink throws EBUSY, the catch swallowed it, and
// getDb() reopened the SAME populated file — so the reset did nothing and any
// test that reseeded fixed ids died with "UNIQUE constraint failed".
//
// The whole suite reported green on Linux for weeks while being broken on the
// machine the owner actually uses. These tests fail on BOTH platforms if the
// bug comes back.

function seed(id: string) {
  run(
    `INSERT INTO TransactionRecord (id, organizationId, officeId, propertyId, fileNumber, loanNumber, transactionType, status, createdAt, updatedAt)
     VALUES (?, 'org-test', NULL, NULL, NULL, NULL, NULL, 'POTENTIAL', ?, ?)`,
    [id, nowIso(), nowIso()]
  );
}

function transactionCount(): number {
  return all(`SELECT id FROM TransactionRecord`).length;
}

beforeEach(() => {
  resetDb();
});

describe("resetDb actually resets", () => {
  it("leaves an empty database behind", () => {
    seed("txn-a");
    expect(transactionCount()).toBe(1);

    resetDb();

    expect(transactionCount()).toBe(0);
  });

  it("REGRESSION: the same fixed id can be seeded again after a reset", () => {
    // This is the exact shape of the failure: tests/match.test.ts seeds
    // "txn-a" in every case and resets between them.
    seed("txn-a");
    resetDb();
    expect(() => seed("txn-a")).not.toThrow();
  });

  it("survives being called many times in a row without leaking handles", () => {
    for (let i = 0; i < 12; i++) {
      resetDb();
      seed("txn-a");
    }
    expect(transactionCount()).toBe(1);
  });

  it("keeps the schema — tables still exist after a reset", () => {
    resetDb();
    const tables = all<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`
    ).map((t) => t.name);

    for (const expected of ["TransactionRecord", "ExtractedFact", "Task", "TransactionMerge", "OfficeSetting"]) {
      expect(tables).toContain(expected);
    }
  });
});

describe("the fallback path Windows takes when the file cannot be deleted", () => {
  // On Linux the unlink always succeeds, so this branch would never run in
  // CI. Calling it directly is what gives it real coverage on every platform.
  it("clearAllTables empties every table without dropping the schema", () => {
    seed("txn-a");
    run(
      `INSERT INTO ExtractedFact (id, transactionId, factType, structuredValue, sourceEmailId, sourceThreadId, sourceTimestamp, sourceSender, evidenceSummary, confidence, status, supersedesId, extractedAt, modelVersion)
       VALUES ('f-1', 'txn-a', 'BUYER_NAME', '"Kowalski"', 'e1', 't1', ?, 's@x.com', 'seed', 0.9, 'CURRENT', NULL, ?, 'test')`,
      [nowIso(), nowIso()]
    );
    run(`INSERT INTO OfficeSetting (organizationId, key, value, updatedAt) VALUES ('org-demo', 'k', 'v', ?)`, [nowIso()]);

    expect(transactionCount()).toBe(1);

    clearAllTables();

    expect(transactionCount()).toBe(0);
    expect(all(`SELECT id FROM ExtractedFact`)).toHaveLength(0);
    expect(all(`SELECT key FROM OfficeSetting`)).toHaveLength(0);

    // ...and the tables are still there to write to.
    expect(() => seed("txn-a")).not.toThrow();
  });

  it("leaves foreign keys switched back on afterwards", () => {
    clearAllTables();
    const [row] = all<{ foreign_keys: number }>(`PRAGMA foreign_keys`);
    expect(row.foreign_keys).toBe(1);
  });
});

describe("closeDb", () => {
  it("is safe to call twice, and the next query reopens transparently", () => {
    seed("txn-a");
    closeDb();
    closeDb();

    expect(() => getDb()).not.toThrow();
    // The file was never deleted, so the row is still there.
    expect(transactionCount()).toBe(1);
  });
});
