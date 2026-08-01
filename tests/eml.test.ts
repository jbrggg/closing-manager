import "./helpers/test-db";
import { describe, it, expect } from "vitest";
import { parseEml, splitMbox, parseHeaders, decodeEncodedWords } from "@/lib/email/eml";

// Enough of RFC 822 to read real exported mail. The fixtures below are the
// shapes Gmail and Outlook actually produce — folded headers, quoted-printable
// bodies, multipart/alternative, and encoded subject lines.

const SIMPLE = `Message-ID: <CAF123@mail.gmail.com>
Date: Thu, 30 Jul 2026 15:37:00 -0400
From: Jamie Catalano <jamie@1gmortgage.com>
To: KEYSTONE Refi <refi@keystonetitleagency.com>
Cc: Info <info@keystonetitleagency.com>
Subject: Re: Invitation to SAP - Whitfield, 214 Delmar Ave
Content-Type: text/plain; charset="UTF-8"

Are we good on this? Marta will be there at 4:30Pm -she has package?`;

const QUOTED_PRINTABLE = `From: lender@example.com
To: refi@keystonetitleagency.com
Subject: Payoff
Content-Type: text/plain; charset="UTF-8"
Content-Transfer-Encoding: quoted-printable

Please send the payoff for 88 Rosewood =E2=80=94 underwriting is asking. We =
still don't have it.`;

const MULTIPART = `From: closer@bank.com
To: purchase@keystonetitleagency.com
Subject: Closing Documents Attached
Content-Type: multipart/alternative; boundary="000000000000abc"

--000000000000abc
Content-Type: text/plain; charset="UTF-8"

Please see attached balanced HUD.

--000000000000abc
Content-Type: text/html; charset="UTF-8"

<div>Please see attached balanced HUD.</div>
--000000000000abc--`;

const HTML_ONLY = `From: noreply@lender.com
To: info@keystonetitleagency.com
Subject: Notification
Content-Type: text/html; charset="UTF-8"

<html><body><p>Your wire transfer on 07/30/26 was sent.</p></body></html>`;

const FOLDED_HEADERS = `From: someone@example.com
To: refi@keystonetitleagency.com
Subject: Title Rundown Request For: Ramanathan /
 File # ATA24-1067R
Content-Type: text/plain

Please update title.`;

describe("reading a single message", () => {
  it("pulls out sender, recipients and subject", () => {
    const mail = parseEml(SIMPLE);
    expect(mail.from).toBe("jamie@1gmortgage.com");
    expect(mail.to).toEqual(["refi@keystonetitleagency.com"]);
    expect(mail.cc).toEqual(["info@keystonetitleagency.com"]);
    expect(mail.subject).toContain("Whitfield");
  });

  it("keeps the sender's display name", () => {
    expect(parseEml(SIMPLE).fromName).toBe("Jamie Catalano");
  });

  it("parses the date into a real timestamp", () => {
    expect(parseEml(SIMPLE).sentAt?.slice(0, 10)).toBe("2026-07-30");
  });

  it("lists every participant once", () => {
    const mail = parseEml(SIMPLE);
    expect(mail.participants).toHaveLength(3);
  });

  it("reads the body", () => {
    expect(parseEml(SIMPLE).body).toContain("Marta will be there at 4:30Pm");
  });
});

describe("decoding what mail clients actually send", () => {
  it("decodes quoted-printable, including soft line breaks", () => {
    const body = parseEml(QUOTED_PRINTABLE).body;
    expect(body).toContain("88 Rosewood");
    // The soft break mid-sentence must not leave an "=" in the text.
    expect(body).toContain("We still don't have it.");
    expect(body).not.toContain("=\n");
  });

  it("decodes an em dash written as an escape", () => {
    expect(parseEml(QUOTED_PRINTABLE).body).toContain("—");
  });

  it("prefers the plain-text part of a multipart message", () => {
    const body = parseEml(MULTIPART).body;
    expect(body).toContain("Please see attached balanced HUD.");
    expect(body).not.toContain("<div>");
  });

  it("falls back to stripping HTML when there is no plain-text part", () => {
    const body = parseEml(HTML_ONLY).body;
    expect(body).toContain("Your wire transfer on 07/30/26 was sent.");
    expect(body).not.toContain("<p>");
  });

  it("joins a folded header back into one line", () => {
    // Real subject lines wrap. If the continuation is dropped, the file number
    // disappears — and that is the strongest matching signal there is.
    expect(parseEml(FOLDED_HEADERS).subject).toContain("ATA24-1067R");
  });

  it("decodes an encoded-word subject", () => {
    expect(decodeEncodedWords("=?utf-8?Q?Caf=C3=A9?= meeting")).toContain("Café");
    expect(decodeEncodedWords("=?utf-8?B?SGVsbG8=?=")).toBe("Hello");
  });

  it("takes the first Received/From rather than a later duplicate", () => {
    const headers = parseHeaders("From: first@x.com\nFrom: second@y.com");
    expect(headers.from).toBe("first@x.com");
  });
});

describe("splitting an mbox export", () => {
  const MBOX = `From 1234567890@xxx Thu Jul 30 15:37:00 2026
From: a@example.com
To: refi@keystonetitleagency.com
Subject: First

Body one.

From 9876543210@xxx Thu Jul 30 16:00:00 2026
From: b@example.com
To: refi@keystonetitleagency.com
Subject: Second

Body two.`;

  it("splits a Takeout mbox into separate messages", () => {
    const messages = splitMbox(MBOX);
    expect(messages).toHaveLength(2);
    expect(parseEml(messages[0]).subject).toBe("First");
    expect(parseEml(messages[1]).subject).toBe("Second");
  });

  it("does not mistake a From: header for a message separator", () => {
    // "From " with no colon separates messages; "From:" is a header. Getting
    // this wrong shreds every message into fragments.
    const messages = splitMbox(MBOX);
    expect(parseEml(messages[0]).from).toBe("a@example.com");
    expect(parseEml(messages[0]).body).toContain("Body one.");
  });

  it("handles a file with a single message", () => {
    expect(splitMbox(SIMPLE)).toHaveLength(1);
  });
});

describe("not falling over on bad input", () => {
  it("survives a message with no body", () => {
    const mail = parseEml("From: a@b.com\nSubject: Empty");
    expect(mail.from).toBe("a@b.com");
    expect(mail.body).toBe("");
  });

  it("survives a message with no headers", () => {
    expect(() => parseEml("just some text")).not.toThrow();
  });

  it("gives a subject-less message a readable placeholder", () => {
    expect(parseEml("From: a@b.com\n\nhi").subject).toBe("(no subject)");
  });
});
