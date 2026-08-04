import { describe, it, expect } from "vitest";
import {
  redact,
  redactSensitive,
  containsSensitiveData,
  isValidRoutingNumber,
  passesLuhn,
} from "@/lib/security/redact";

// The first block is the important one. A redactor that eats loan numbers
// would silently break transaction matching — a file or loan number is worth
// 50 points against a 60-point threshold, more than a property address. That
// failure would surface as "the AI got worse", which is the hardest kind of
// bug to trace back to its cause.

describe("SAFETY: ordinary business numbers must survive untouched", () => {
  it("leaves a loan number alone", () => {
    const s = "Loan number 401299876 is clear to close.";
    expect(redact(s)).toBe(s);
  });

  it("leaves a loan number alone even when it satisfies the routing checksum", () => {
    // 021000021 is a real, checksum-valid routing number. Labelled as a loan
    // number, it must still be left alone: the label wins over the arithmetic.
    expect(isValidRoutingNumber("021000021")).toBe(true);
    const s = "Loan 021000021 was funded this morning.";
    expect(redact(s)).toBe(s);
  });

  it("leaves file, order and policy numbers alone", () => {
    const s = "File 25-104427, order 998877665, policy 123456789012.";
    expect(redact(s)).toBe(s);
  });

  it("leaves a bare nine-digit number alone with no context at all", () => {
    const s = "Reference 021000021 for your records.";
    expect(redact(s)).toBe(s);
  });

  it("leaves dates, dollar amounts and phone numbers alone", () => {
    const s = "Closing 08/15/2026 at 2:00pm, $342,150.00, call 610-555-0142.";
    expect(redact(s)).toBe(s);
  });

  it("leaves an ordinary email body completely unchanged", () => {
    const s =
      "Please confirm the closing for 214 Delmar Street is still set for Thursday. " +
      "We have the commitment but are waiting on the payoff. File 25-104427.";
    expect(redact(s)).toBe(s);
  });
});

describe("routing numbers", () => {
  it("masks one when the checksum passes and the context says bank", () => {
    const out = redact("Wire to ABA routing 021000021 for settlement.");
    expect(out).toContain("[routing ending 0021]");
    expect(out).not.toContain("021000021");
  });

  it("keeps the last four so a human can still confirm it", () => {
    expect(redact("Bank routing 021000021")).toContain("0021");
  });

  it("ignores a nine-digit number that fails the checksum, even near bank words", () => {
    const s = "Wire routing 123456789 was quoted.";
    expect(isValidRoutingNumber("123456789")).toBe(false);
    expect(redact(s)).toBe(s);
  });
});

describe("account numbers", () => {
  it("masks a labelled account number", () => {
    const out = redact("Beneficiary account 8841200397 at First Keystone.");
    expect(out).toContain("[ending 0397]");
    expect(out).not.toContain("8841200397");
  });

  it("masks the short form", () => {
    expect(redact("Acct #4471002856")).toContain("[ending 2856]");
  });

  it("leaves an escrow account reference alone", () => {
    const s = "Escrow no. 55512 and file account 9987001.";
    expect(redact(s)).toBe(s);
  });
});

describe("social security numbers", () => {
  it("masks the dashed form", () => {
    expect(redact("Borrower SSN 123-45-6789.")).toBe("Borrower SSN [SSN redacted].");
  });

  it("masks an explicitly labelled undashed one", () => {
    expect(redact("Social Security Number: 123456789")).toContain("[SSN redacted]");
  });
});

describe("payment cards", () => {
  it("masks a number that passes Luhn", () => {
    expect(passesLuhn("4111111111111111")).toBe(true);
    const out = redact("Card 4111111111111111 on file.");
    expect(out).toContain("[card ending 1111]");
    expect(out).not.toContain("4111111111111111");
  });

  it("ignores a long number that fails Luhn", () => {
    const s = "Tracking 4111111111111112 shipped.";
    expect(passesLuhn("4111111111111112")).toBe(false);
    expect(redact(s)).toBe(s);
  });
});

describe("reporting what was found", () => {
  it("names the categories without ever repeating the values", () => {
    const r = redactSensitive("ABA routing 021000021 and SSN 123-45-6789");
    expect(r.found.sort()).toEqual(["routing", "ssn"]);
    expect(r.found.join(" ")).not.toContain("021000021");
  });

  it("reports each category once however many times it appears", () => {
    const r = redactSensitive("SSN 123-45-6789 and SSN 987-65-4321");
    expect(r.found).toEqual(["ssn"]);
  });

  it("flags text that needs a warning shown next to it", () => {
    expect(containsSensitiveData("Wire to ABA routing 021000021")).toBe(true);
    expect(containsSensitiveData("Closing Thursday at 2pm, file 25-104427")).toBe(false);
  });
});

describe("handling nothing gracefully", () => {
  it("survives null, undefined and empty input", () => {
    expect(redact(null)).toBe("");
    expect(redact(undefined)).toBe("");
    expect(redact("")).toBe("");
    expect(containsSensitiveData(null)).toBe(false);
  });
});

describe("a realistic wire instruction block", () => {
  const WIRE = [
    "Wiring instructions for settlement:",
    "Bank: First Keystone National",
    "ABA routing: 021000021",
    "Beneficiary account 8841200397",
    "Reference: file 25-104427, 214 Delmar Street",
  ].join("\n");

  it("masks the bank details", () => {
    const out = redact(WIRE);
    expect(out).not.toContain("021000021");
    expect(out).not.toContain("8841200397");
  });

  it("keeps the file number and address, because matching depends on them", () => {
    const out = redact(WIRE);
    expect(out).toContain("25-104427");
    expect(out).toContain("214 Delmar Street");
  });
});
