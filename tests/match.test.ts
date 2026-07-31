import "./helpers/test-db";
import { describe, it, expect, beforeEach } from "vitest";
import { resetDb, run, nowIso } from "@/lib/db";
import { findBestTransactionMatch } from "@/lib/ai/match";
import { ExtractedFactCandidate } from "@/lib/ai/provider";

const ORG = "org-test";

function fact(factType: ExtractedFactCandidate["factType"], value: unknown): ExtractedFactCandidate {
  return { factType, value, confidence: 0.9, evidenceSummary: "test" };
}

/** Creates a transaction with the given current facts. */
function seedTransaction(id: string, facts: [string, unknown][]) {
  run(
    `INSERT INTO TransactionRecord (id, organizationId, officeId, propertyId, fileNumber, loanNumber, transactionType, status, createdAt, updatedAt)
     VALUES (?, ?, NULL, NULL, NULL, NULL, NULL, 'POTENTIAL', ?, ?)`,
    [id, ORG, nowIso(), nowIso()]
  );
  for (const [factType, value] of facts) {
    run(
      `INSERT INTO ExtractedFact (id, transactionId, factType, structuredValue, sourceEmailId, sourceThreadId, sourceTimestamp, sourceSender, evidenceSummary, confidence, status, supersedesId, extractedAt, modelVersion)
       VALUES (?, ?, ?, ?, 'e1', 't1', ?, 's@x.com', 'seed', 0.9, 'CURRENT', NULL, ?, 'test')`,
      [`${id}-${factType}`, id, factType, JSON.stringify(value), nowIso(), nowIso()]
    );
  }
}

describe("transaction matching", () => {
  beforeEach(() => {
    resetDb();
  });

  it("scores an identical property address highly, but not enough to auto-link alone", () => {
    seedTransaction("txn-a", [["PROPERTY_ADDRESS", "123 Main Street"]]);

    const result = findBestTransactionMatch(ORG, [fact("PROPERTY_ADDRESS", "123 Main Street")]);

    expect(result.transaction?.id).toBe("txn-a");
    expect(result.score).toBe(45);
    // Deliberately below the 60-point threshold: in title work the SAME
    // property legitimately has multiple transactions over time (a sale,
    // then a refinance years later). An address alone therefore flags a
    // duplicate candidate for review rather than merging automatically.
    expect(result.isStrongMatch).toBe(false);
  });

  it("normalizes address suffixes so 'Street' and 'St.' score as the same address", () => {
    seedTransaction("txn-a", [["PROPERTY_ADDRESS", "123 Main Street"]]);

    const result = findBestTransactionMatch(ORG, [fact("PROPERTY_ADDRESS", "123 Main St.")]);

    expect(result.score).toBe(45); // matched despite the differing suffix/punctuation
  });

  it("REGRESSION: does NOT merge two people who share a full name but nothing else", () => {
    // This is the bug that produced a single merged transaction for two
    // unrelated 'Robert Johnson' files during manual testing.
    seedTransaction("txn-elm", [
      ["PROPERTY_ADDRESS", "55 Elm Street"],
      ["BUYER_NAME", "Robert Johnson"],
      ["FILE_NUMBER", "FN-6010"],
    ]);

    const result = findBestTransactionMatch(ORG, [
      fact("PROPERTY_ADDRESS", "900 Birch Avenue"),
      fact("BUYER_NAME", "Robert Johnson"),
      fact("FILE_NUMBER", "FN-7712"),
    ]);

    // A name match alone scores 15 — enough to flag as a possible duplicate
    // for human review, but nowhere near the 60-point auto-link threshold.
    expect(result.isStrongMatch).toBe(false);
    expect(result.score).toBeLessThan(60);
    expect(result.score).toBeGreaterThanOrEqual(15);
  });

  it("does not link on a shared closing location alone", () => {
    seedTransaction("txn-a", [["CLOSING_LOCATION", "Cherry Hill office"]]);

    const result = findBestTransactionMatch(ORG, [fact("CLOSING_LOCATION", "Cherry Hill office")]);

    // Half the agency's closings happen at the same office; that is not
    // evidence two emails concern the same transaction.
    expect(result.isStrongMatch).toBe(false);
  });

  it("REGRESSION: repeated identical facts do not inflate the match score", () => {
    // Duplicate facts arriving from a repeatedly-found search result used to
    // be counted once each, letting weak evidence cross the threshold.
    seedTransaction("txn-a", [["BUYER_NAME", "Jane Doe"]]);

    const single = findBestTransactionMatch(ORG, [fact("BUYER_NAME", "Jane Doe")]);
    const repeated = findBestTransactionMatch(ORG, [
      fact("BUYER_NAME", "Jane Doe"),
      fact("BUYER_NAME", "Jane Doe"),
      fact("BUYER_NAME", "Jane Doe"),
      fact("BUYER_NAME", "Jane Doe"),
      fact("BUYER_NAME", "Jane Doe"),
    ]);

    expect(repeated.score).toBe(single.score);
    expect(repeated.isStrongMatch).toBe(false);
  });

  it("matches on file number, which is a strong identifier by itself", () => {
    seedTransaction("txn-a", [["FILE_NUMBER", "FN-2201"]]);
    const result = findBestTransactionMatch(ORG, [fact("FILE_NUMBER", "FN-2201")]);
    expect(result.isStrongMatch).toBe(false); // 50 < 60 on its own
    expect(result.score).toBe(50);
  });

  it("combines address plus file number into a confident match", () => {
    seedTransaction("txn-a", [
      ["PROPERTY_ADDRESS", "123 Main Street"],
      ["FILE_NUMBER", "FN-2201"],
    ]);
    const result = findBestTransactionMatch(ORG, [
      fact("PROPERTY_ADDRESS", "123 Main Street"),
      fact("FILE_NUMBER", "FN-2201"),
    ]);
    expect(result.score).toBe(95);
    expect(result.isStrongMatch).toBe(true);
  });

  it("returns no match against an empty database", () => {
    const result = findBestTransactionMatch(ORG, [fact("PROPERTY_ADDRESS", "1 Nowhere Rd")]);
    expect(result.transaction).toBeNull();
    expect(result.score).toBe(0);
  });
});
