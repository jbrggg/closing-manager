import "./helpers/test-db";
import { describe, it, expect } from "vitest";
import { unwrapForwarded, isOurAddress, directionFor, parseSentDate } from "@/lib/email/forwarded";

// A forwarded email lies about who sent it. Without unwrapping, two things
// break silently: direction (everything looks INCOMING) and the body (the real
// message gets filed as quoted history the AI never reads).
//
// The fixtures below are the two shapes that actually arrive: Outlook, which
// starts a bare header block, and Gmail, which prints a banner first.

const OUTLOOK_FORWARD = `Jaydon,
Please send this out.

From: Jamie Catalano <jamie@1gmortgage.com>
Sent: Thursday, July 30, 2026 3:37 PM
To: KEYSTONE Refi <refi@keystonetitleagency.com>
Cc: Info <info@keystonetitleagency.com>
Subject: Re: Invitation to SAP - Whitfield, 214 Delmar Ave

Are we good on this? Marta will be there at 4:30Pm -she has package?`;

const GMAIL_FORWARD = `FYI

---------- Forwarded message ---------
From: Cadence Whitlock <cwhitlock@northfi.com>
Date: Thu, Jul 30, 2026 at 11:05 AM
Subject: VETRANO CC2026041173/FILE#ALT26-518R
To: KEYSTONE Purchase <purchase@keystonetitleagency.com>

Note- This loan is not yet in closing.`;

const NOT_A_FORWARD = `Hi Nicole,

Thank you so much for helping out with this. Per our phone call, we were
expecting Fidelity to indemnify us. From what I understand they will not.

Thank you,
Dana`;

describe("recognising a forward", () => {
  it("reads the original sender out of an Outlook forward", () => {
    const result = unwrapForwarded(OUTLOOK_FORWARD);
    expect(result.isForwarded).toBe(true);
    expect(result.original?.from).toBe("jamie@1gmortgage.com");
  });

  it("reads the original sender out of a Gmail forward", () => {
    const result = unwrapForwarded(GMAIL_FORWARD);
    expect(result.isForwarded).toBe(true);
    expect(result.original?.from).toBe("cwhitlock@northfi.com");
  });

  it("captures who it originally went to, including Cc", () => {
    const result = unwrapForwarded(OUTLOOK_FORWARD);
    expect(result.original?.to).toContain("refi@keystonetitleagency.com");
    expect(result.original?.to).toContain("info@keystonetitleagency.com");
  });

  it("captures the original subject", () => {
    expect(unwrapForwarded(OUTLOOK_FORWARD).original?.subject).toContain("Whitfield");
  });

  it("separates the forwarder's own note from the message", () => {
    const result = unwrapForwarded(OUTLOOK_FORWARD);
    expect(result.forwarderNote).toContain("Please send this out");
    expect(result.forwarderNote).not.toContain("Marta");
  });

  it("REGRESSION: keeps the whole forwarded message in the body", () => {
    // splitQuotedText would have cut everything after the first From: line
    // into quoted history, which the AI never reads. On a forward that IS the
    // message — the AI would have seen "Jaydon, Please send this out."
    const result = unwrapForwarded(OUTLOOK_FORWARD);
    expect(result.body).toContain("Marta will be there at 4:30Pm");
    expect(result.body).toContain("Are we good on this?");
  });
});

describe("refusing to guess", () => {
  it("does not treat an ordinary email as a forward", () => {
    const result = unwrapForwarded(NOT_A_FORWARD);
    expect(result.isForwarded).toBe(false);
    expect(result.original).toBeUndefined();
  });

  it("ignores prose that merely starts with the word From", () => {
    const result = unwrapForwarded("From what I understand they will not indemnify.\n\nThanks");
    expect(result.isForwarded).toBe(false);
  });

  it("needs more than a From: line alone before it believes a header block", () => {
    // One line with an address in it is not a forward — it could be a
    // signature or a quoted fragment.
    const result = unwrapForwarded("Please contact From: someone@example.com if needed.");
    expect(result.isForwarded).toBe(false);
  });

  it("handles an empty body without throwing", () => {
    expect(unwrapForwarded("").isForwarded).toBe(false);
    expect(unwrapForwarded("").body).toBe("");
  });
});

describe("original send time", () => {
  it("reads a fully-specified date", () => {
    const result = unwrapForwarded(OUTLOOK_FORWARD);
    expect(result.original?.sentAt).toBeDefined();
    expect(result.original?.sentAt?.slice(0, 10)).toBe("2026-07-30");
  });

  it("REFUSES a date with no year rather than guessing today", () => {
    // Date.parse("Thursday") returns today. A wrong date on the settlement
    // board is the failure this whole project keeps guarding against.
    expect(parseSentDate("Thursday")).toBeUndefined();
    expect(parseSentDate("Thursday at 10")).toBeUndefined();
    expect(parseSentDate(undefined)).toBeUndefined();
  });

  it("keeps the raw text even when it will not parse", () => {
    const result = unwrapForwarded(OUTLOOK_FORWARD.replace("Thursday, July 30, 2026 3:37 PM", "Thursday"));
    expect(result.original?.sentRaw).toBe("Thursday");
    expect(result.original?.sentAt).toBeUndefined();
  });
});

describe("whose address is it", () => {
  const env = { ORG_EMAIL_DOMAINS: "keystonetitleagency.com, ktagroup.com" };

  it("recognises our own domain", () => {
    expect(isOurAddress("refi@keystonetitleagency.com", env)).toBe(true);
    expect(isOurAddress("PURCHASE@KeystoneTitleAgency.com", env)).toBe(true);
  });

  it("recognises a second domain the office uses", () => {
    expect(isOurAddress("mwebb@ktagroup.com", env)).toBe(true);
  });

  it("does not claim an outside address", () => {
    expect(isOurAddress("jamie@1gmortgage.com", env)).toBe(false);
  });

  it("does not match on a lookalike domain", () => {
    expect(isOurAddress("someone@notkeystonetitleagency.com", env)).toBe(false);
  });

  it("supports a single address on a different domain", () => {
    const withAddress = { ORG_EMAIL_ADDRESSES: "dana@somewhereelse.com" };
    expect(isOurAddress("dana@somewhereelse.com", withAddress)).toBe(true);
    expect(isOurAddress("other@somewhereelse.com", withAddress)).toBe(false);
  });

  it("is not fooled by a non-address", () => {
    expect(isOurAddress("", env)).toBe(false);
    expect(isOurAddress("not an address", env)).toBe(false);
  });
});

describe("direction, which is the whole point", () => {
  const env = { ORG_EMAIL_DOMAINS: "keystonetitleagency.com" };
  const testMailbox = "closing.manager.test@gmail.com";

  it("REGRESSION: a forward of OUR OWN email is OUTGOING, not INCOMING", () => {
    // This is the bug. Forwarded to a test inbox, the envelope sender is the
    // forwarder, so the old rule made every message INCOMING — and the AI
    // hunted our own sent mail for requests and raised tasks from it.
    const ourEmail = `see attached

From: KEYSTONE Refi <refi@keystonetitleagency.com>
Sent: Wednesday, July 29, 2026 4:14 PM
To: Prashanth Kadam <pkadam@vanguardclosings.com>
Subject: RE: Title Review

Please see attached.`;

    const direction = directionFor(
      { fromAddress: "jaydon.personal@gmail.com", unwrapped: unwrapForwarded(ourEmail) },
      testMailbox,
      env
    );
    expect(direction).toBe("OUTGOING");
  });

  it("a forward of an outside email is INCOMING", () => {
    const direction = directionFor(
      { fromAddress: "jaydon.personal@gmail.com", unwrapped: unwrapForwarded(OUTLOOK_FORWARD) },
      testMailbox,
      env
    );
    expect(direction).toBe("INCOMING");
  });

  it("a message that is not a forward still uses its own sender", () => {
    expect(
      directionFor({ fromAddress: "refi@keystonetitleagency.com" }, testMailbox, env)
    ).toBe("OUTGOING");
    expect(
      directionFor({ fromAddress: "jamie@1gmortgage.com" }, testMailbox, env)
    ).toBe("INCOMING");
  });

  it("falls back to the connected mailbox when the office addresses are not configured", () => {
    const noEnv = {};
    expect(directionFor({ fromAddress: "me@work.com" }, "me@work.com", noEnv)).toBe("OUTGOING");
    expect(directionFor({ fromAddress: "them@other.com" }, "me@work.com", noEnv)).toBe("INCOMING");
  });

  it("returns undefined rather than guessing when there is nothing to go on", () => {
    expect(directionFor({ fromAddress: "" }, "", {})).toBeUndefined();
  });
});
