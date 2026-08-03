import "./helpers/test-db";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { LocalDocumentStore } from "@/lib/storage";
import { parseEml } from "@/lib/email/eml";

// The app used to record that a file was attached and throw the file away. For
// a title agency that is most of the job missing — the HUD, the CPL and the
// commitment ARE the work.

let root: string;
let store: LocalDocumentStore;

beforeEach(() => {
  root = path.join(os.tmpdir(), `cm-store-${randomUUID().slice(0, 8)}`);
  store = new LocalDocumentStore(root);
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("storing and getting a document back", () => {
  it("round-trips a file byte for byte", async () => {
    const bytes = Buffer.from("%PDF-1.4 a settlement statement");
    const doc = await store.put(bytes, "HUD.pdf");

    expect(await store.get(doc.storageKey)).toEqual(bytes);
  });

  it("names a document by the hash of its contents", async () => {
    const doc = await store.put(Buffer.from("hello"), "a.txt");
    // sha256("hello")
    expect(doc.sha256).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
    expect(doc.storageKey).toBe(`local:${doc.sha256}`);
  });

  it("stores the same document once, however many emails carry it", async () => {
    // The same commitment PDF gets forwarded five times across one thread.
    const pdf = Buffer.from("%PDF-1.4 the commitment");
    const first = await store.put(pdf, "Commitment.pdf");
    const second = await store.put(pdf, "Commitment_FINAL_v2.pdf");

    expect(first.deduplicated).toBe(false);
    expect(second.deduplicated).toBe(true);
    expect(second.sha256).toBe(first.sha256);
    expect(await store.sizeOnDisk()).toBe(pdf.length);
  });

  it("gives different documents different identities", async () => {
    const a = await store.put(Buffer.from("version one"), "HUD.pdf");
    const b = await store.put(Buffer.from("version two"), "HUD.pdf");
    expect(a.sha256).not.toBe(b.sha256);
  });

  it("reports what it holds, for the settings screen", async () => {
    expect(await store.sizeOnDisk()).toBe(0);
    await store.put(Buffer.from("12345"), "a.txt");
    expect(await store.sizeOnDisk()).toBe(5);
  });
});

describe("refusing bad input", () => {
  it("will not store an empty file", async () => {
    await expect(store.put(Buffer.alloc(0), "empty.pdf")).rejects.toThrow(/empty/i);
  });

  it("will not store something absurdly large", async () => {
    const huge = Buffer.alloc(51 * 1024 * 1024);
    await expect(store.put(huge, "huge.pdf")).rejects.toThrow(/over the/i);
  });

  it("returns null for a key it does not hold", async () => {
    expect(await store.get(`local:${"a".repeat(64)}`)).toBeNull();
  });

  it("SECURITY: refuses a key that is not a hash, so a path cannot escape the store", async () => {
    // A crafted key must never be joined onto the storage root.
    expect(await store.get("local:../../../etc/passwd")).toBeNull();
    expect(await store.get("../../secrets")).toBeNull();
    expect(await store.has("local:not-a-hash")).toBe(false);
  });
});

describe("pulling documents out of a real email", () => {
  const WITH_ATTACHMENT = [
    "From: closer@lender.com",
    "To: refi@keystonetitleagency.com",
    "Subject: Closing Documents Attached",
    'Content-Type: multipart/mixed; boundary="BOUND1"',
    "",
    "--BOUND1",
    'Content-Type: text/plain; charset="UTF-8"',
    "",
    "Please see attached balanced HUD.",
    "",
    "--BOUND1",
    'Content-Type: application/pdf; name="HUD-214-Delmar.pdf"',
    'Content-Disposition: attachment; filename="HUD-214-Delmar.pdf"',
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from("%PDF-1.4 settlement statement").toString("base64"),
    "",
    "--BOUND1--",
  ].join("\n");

  it("keeps the attachment instead of discarding it", () => {
    const mail = parseEml(WITH_ATTACHMENT);
    expect(mail.attachments).toHaveLength(1);
    expect(mail.attachments[0].filename).toBe("HUD-214-Delmar.pdf");
    expect(mail.attachments[0].mimeType).toBe("application/pdf");
    expect(mail.attachments[0].bytes.toString()).toContain("settlement statement");
  });

  it("still reads the body correctly alongside the attachment", () => {
    expect(parseEml(WITH_ATTACHMENT).body).toContain("Please see attached balanced HUD.");
  });

  it("stores what it found", async () => {
    const mail = parseEml(WITH_ATTACHMENT);
    const doc = await store.put(mail.attachments[0].bytes, mail.attachments[0].filename);
    expect((await store.get(doc.storageKey))?.toString()).toContain("settlement statement");
  });

  it("ignores an inline signature logo — that is not a document", () => {
    const withLogo = [
      "From: a@b.com",
      "To: c@d.com",
      "Subject: hi",
      'Content-Type: multipart/mixed; boundary="B"',
      "",
      "--B",
      "Content-Type: text/plain",
      "",
      "Thanks,",
      "",
      "--B",
      'Content-Type: image/png; name="logo.png"',
      'Content-Disposition: inline; filename="logo.png"',
      "Content-Transfer-Encoding: base64",
      "",
      Buffer.from("PNGDATA").toString("base64"),
      "",
      "--B--",
    ].join("\n");

    expect(parseEml(withLogo).attachments).toHaveLength(0);
  });

  it("an email with no attachments reports none rather than throwing", () => {
    expect(parseEml("From: a@b.com\nSubject: x\n\nplain text").attachments).toEqual([]);
  });
});
