import "./helpers/test-db";
import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { run } from "@/lib/db";
import { withAttachmentText, withAttachmentTextOne } from "@/lib/documents/augment";
import { EmailMessageRow } from "@/types/models";

// The point of the whole attachment feature: an email that says "see attached"
// and nothing else must still give the AI something to read.

function message(id: string, body: string): EmailMessageRow {
  return {
    id,
    threadId: "t1",
    subject: "Closing docs",
    bodyText: body,
    fromAddress: "closer@lender.com",
    toAddresses: '["refi@keystone.com"]',
    direction: "INCOMING",
    sentAt: "2026-08-01T10:00:00Z",
  } as unknown as EmailMessageRow;
}

function attach(
  messageId: string,
  filename: string,
  text: string | null,
  status = "EXTRACTED"
) {
  run(
    `INSERT INTO EmailAttachment (id, messageId, filename, mimeType, sizeBytes, extractedText, extractionStatus)
     VALUES (?, ?, ?, 'application/pdf', 100, ?, ?)`,
    [randomUUID(), messageId, filename, text, status]
  );
}

beforeEach(() => {
  run(`DELETE FROM EmailAttachment`);
});

describe("giving the AI the document text", () => {
  it("appends it to the body the AI reads", () => {
    attach("m1", "HUD.pdf", "Cash to close $12,410.22");
    const [out] = withAttachmentText([message("m1", "See attached.")]);

    expect(out.bodyText).toContain("See attached.");
    expect(out.bodyText).toContain("Cash to close $12,410.22");
  });

  it("names the document, so a fact can be traced back to it", () => {
    attach("m1", "HUD-214-Delmar.pdf", "closing 08/15/2026");
    const [out] = withAttachmentText([message("m1", "See attached.")]);
    expect(out.bodyText).toContain("HUD-214-Delmar.pdf");
  });

  it("recovers a closing date that exists only inside the document", () => {
    // The exact case this feature was built for.
    attach("m1", "settlement.pdf", "File 25-104427 closing 08/15/2026 at 2:00 PM");
    const [out] = withAttachmentText([message("m1", "See attached, thanks.")]);
    expect(out.bodyText).toContain("08/15/2026");
    expect(out.bodyText).toContain("25-104427");
  });

  it("includes several documents on one message", () => {
    attach("m1", "CD.pdf", "loan estimate figures");
    attach("m1", "CPL.pdf", "closing protection letter");
    const [out] = withAttachmentText([message("m1", "Two files attached.")]);
    expect(out.bodyText).toContain("loan estimate figures");
    expect(out.bodyText).toContain("closing protection letter");
  });
});

describe("leaving things alone when there is nothing to add", () => {
  it("returns a message with no attachments completely unchanged", () => {
    const original = message("m1", "Is Thursday still good?");
    const [out] = withAttachmentText([original]);
    expect(out).toBe(original);
  });

  it("ignores a scanned document with no text layer", () => {
    attach("m1", "scan.pdf", null, "EMPTY");
    const original = message("m1", "See attached.");
    expect(withAttachmentText([original])[0].bodyText).toBe("See attached.");
  });

  it("ignores an attachment that failed to parse", () => {
    attach("m1", "broken.pdf", null, "FAILED");
    expect(withAttachmentTextOne(message("m1", "Body")).bodyText).toBe("Body");
  });

  it("ignores an unsupported format", () => {
    attach("m1", "photo.png", null, "UNSUPPORTED");
    expect(withAttachmentTextOne(message("m1", "Body")).bodyText).toBe("Body");
  });

  it("handles an empty list", () => {
    expect(withAttachmentText([])).toEqual([]);
  });
});

describe("across a thread", () => {
  it("attaches each document to its own message and no other", () => {
    attach("m1", "first.pdf", "text of the first document");
    attach("m2", "second.pdf", "text of the second document");

    const out = withAttachmentText([message("m1", "one"), message("m2", "two")]);

    expect(out[0].bodyText).toContain("text of the first document");
    expect(out[0].bodyText).not.toContain("text of the second document");
    expect(out[1].bodyText).toContain("text of the second document");
    expect(out[1].bodyText).not.toContain("text of the first document");
  });

  it("does not mutate the message it was given", () => {
    attach("m1", "HUD.pdf", "some text");
    const original = message("m1", "See attached.");
    withAttachmentText([original]);
    expect(original.bodyText).toBe("See attached.");
  });
});
