import "./helpers/test-db";
import { describe, it, expect } from "vitest";
import { addressesMatch } from "@/lib/ai/match";

// Exact equality after normalising cost a real duplicate flag: "1274 Danforth
// Ave" and "1274 Danforth Ave., Jersey City NJ" are obviously the same place
// and scored zero against each other. These pin the looser rule — and, more
// importantly, pin how far it is allowed to go. Invariant 4 is unchanged: a
// shared town or a shared street must still never be enough.

describe("two written addresses describe the same place", () => {
  it("accepts the same address with the town and state appended", () => {
    expect(addressesMatch("1274 Danforth Ave", "1274 Danforth Ave., Jersey City NJ")).toBe(true);
    expect(addressesMatch("1274 Danforth Ave., Jersey City NJ", "1274 Danforth Ave")).toBe(true);
  });

  it("still ignores punctuation, case and street-type spelling", () => {
    expect(addressesMatch("88 Rosewood Street", "88 rosewood st")).toBe(true);
    expect(addressesMatch("3714 LARKIN ST", "3714 Larkin St, Philadelphia PA 19132")).toBe(true);
  });

  it("does not match two different houses on the same street", () => {
    expect(addressesMatch("14 Ridgeview Ct", "914 Ridgeview Ct")).toBe(false);
    expect(addressesMatch("1274 Danforth Ave", "1280 Danforth Ave")).toBe(false);
  });

  it("does not match on the town alone", () => {
    // The single most dangerous false positive: everything the office handles
    // is in the same handful of towns.
    expect(addressesMatch("Jersey City NJ", "1274 Danforth Ave, Jersey City NJ")).toBe(false);
    expect(addressesMatch("Philadelphia PA 19132", "3714 Larkin St, Philadelphia PA 19132")).toBe(false);
  });

  it("does not match a bare street name with no house number", () => {
    expect(addressesMatch("Danforth Ave", "1274 Danforth Ave")).toBe(false);
  });

  it("refuses a single token, which is not an address", () => {
    expect(addressesMatch("Danforth", "Danforth")).toBe(false);
    expect(addressesMatch("1274", "1274 Danforth Ave")).toBe(false);
  });

  it("does not match a longer street name that merely starts the same way", () => {
    // "10 Properties, Philadelphia" is a real blanket-file address in the eval
    // set — it must not swallow every Philadelphia property.
    expect(addressesMatch("10 Properties, Philadelphia", "10 Properties Rd, Philadelphia")).toBe(false);
  });
});
