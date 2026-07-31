import "./helpers/test-db";
import { describe, it, expect, beforeAll } from "vitest";
import {
  mapGraphMessage,
  htmlToPlainText,
  splitQuotedText,
  participantsOf,
  buildGraphSearchQuery,
  GraphMessage,
} from "@/lib/email/graph-mapping";
import { encryptSecret, decryptSecret } from "@/lib/auth/crypto";

// A realistic Graph payload, shaped from Microsoft's documented response.
// This is what lets us test the adapter without a Microsoft tenant.
const sampleGraphMessage: GraphMessage = {
  id: "AAMkAGI2AAA=",
  conversationId: "AAQkAGI2THREAD",
  subject: "123 Main St — Closing",
  body: {
    contentType: "html",
    content:
      "<html><head><style>p{margin:0}</style></head><body><p>Hi team,</p><p>Please send the revised commitment by Friday.</p><p>Thanks,<br>Carla</p></body></html>",
  },
  from: { emailAddress: { name: "Carla Reyes", address: "Carla@ABCRealty.com" } },
  toRecipients: [{ emailAddress: { address: "closings@keystonetitle.com" } }],
  ccRecipients: [{ emailAddress: { address: "atty@hallesq.com" } }],
  receivedDateTime: "2026-07-20T14:02:00Z",
  sentDateTime: "2026-07-20T14:01:00Z",
  hasAttachments: false,
  isDraft: false,
};

describe("Graph message mapping", () => {
  it("maps a Graph message onto our row shape", () => {
    const row = mapGraphMessage(sampleGraphMessage, "closings@keystonetitle.com");

    expect(row.providerMsgId).toBe("AAMkAGI2AAA=");
    expect(row.threadId).toBe("ms-thread-AAQkAGI2THREAD");
    expect(row.subject).toBe("123 Main St — Closing");
    expect(JSON.parse(row.toAddresses)).toEqual(["closings@keystonetitle.com"]);
  });

  it("lowercases addresses so matching is case-insensitive", () => {
    const row = mapGraphMessage(sampleGraphMessage, "closings@keystonetitle.com");
    expect(row.fromAddress).toBe("carla@abcrealty.com");
  });

  it("marks mail from the connected mailbox as OUTGOING", () => {
    const outgoing: GraphMessage = {
      ...sampleGraphMessage,
      from: { emailAddress: { address: "closings@keystonetitle.com" } },
      toRecipients: [{ emailAddress: { address: "carla@abcrealty.com" } }],
    };
    expect(mapGraphMessage(outgoing, "closings@keystonetitle.com").direction).toBe("OUTGOING");
    // Direction drives task-completion detection, so this must be right.
    expect(mapGraphMessage(sampleGraphMessage, "closings@keystonetitle.com").direction).toBe(
      "INCOMING"
    );
  });

  it("converts HTML bodies to readable plain text", () => {
    const row = mapGraphMessage(sampleGraphMessage, "closings@keystonetitle.com");
    expect(row.bodyText).toContain("Please send the revised commitment by Friday.");
    expect(row.bodyText).not.toContain("<p>");
    expect(row.bodyText).not.toContain("margin:0"); // <style> stripped
  });

  it("falls back to a sent/received timestamp", () => {
    const row = mapGraphMessage(sampleGraphMessage, "closings@keystonetitle.com");
    expect(row.sentAt).toBe("2026-07-20T14:01:00Z");
  });

  it("survives a message with missing optional fields", () => {
    const sparse: GraphMessage = { id: "X1" };
    const row = mapGraphMessage(sparse, "closings@keystonetitle.com");
    expect(row.subject).toBe("(no subject)");
    expect(JSON.parse(row.toAddresses)).toEqual([]);
    expect(row.bodyText).toBe("");
  });

  it("collects every participant including cc", () => {
    expect(participantsOf(sampleGraphMessage)).toEqual([
      "carla@abcrealty.com",
      "closings@keystonetitle.com",
      "atty@hallesq.com",
    ]);
  });
});

describe("HTML to text", () => {
  it("turns block tags into line breaks", () => {
    expect(htmlToPlainText("<p>One</p><p>Two</p>")).toBe("One\nTwo");
  });

  it("decodes common entities", () => {
    expect(htmlToPlainText("<p>Smith &amp; Jones &lt;test&gt; &nbsp;done</p>")).toContain(
      "Smith & Jones <test>"
    );
  });

  it("strips scripts entirely", () => {
    expect(htmlToPlainText("<script>alert(1)</script><p>Safe</p>")).toBe("Safe");
  });

  it("collapses excessive blank lines", () => {
    expect(htmlToPlainText("<p>A</p><br><br><br><br><p>B</p>")).toBe("A\n\nB");
  });
});

describe("quoted reply splitting", () => {
  it("separates a new reply from the quoted original", () => {
    const body = "Yes, Friday works.\n\nFrom: Carla Reyes\nSent: Monday\nOriginal question here.";
    const { current, quoted } = splitQuotedText(body);
    expect(current).toBe("Yes, Friday works.");
    expect(quoted).toContain("Original question here.");
  });

  it("handles the 'On ... wrote:' style", () => {
    const body = "Confirmed.\n\nOn Tue, Jul 21, Carla wrote:\n> earlier text";
    const { current, quoted } = splitQuotedText(body);
    expect(current).toBe("Confirmed.");
    expect(quoted).toContain("earlier text");
  });

  it("returns null quoted text when there is no quoted section", () => {
    const { current, quoted } = splitQuotedText("Just a plain message.");
    expect(current).toBe("Just a plain message.");
    expect(quoted).toBeNull();
  });
});

describe("Graph search query building", () => {
  it("quotes identifiers and joins with OR", () => {
    const q = buildGraphSearchQuery({ fileNumber: "FN-2201", personNames: ["John Smith"] });
    expect(q).toContain('"FN-2201"');
    expect(q).toContain('"John Smith"');
    expect(q).toContain(" OR ");
  });

  it("returns an empty string when there is nothing to search for", () => {
    expect(buildGraphSearchQuery({})).toBe("");
  });
});

describe("token encryption at rest", () => {
  beforeAll(() => {
    process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  });

  it("round-trips a secret", () => {
    const token = "eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.fake-refresh-token";
    const encrypted = encryptSecret(token);
    expect(encrypted).not.toContain(token);
    expect(decryptSecret(encrypted)).toBe(token);
  });

  it("produces different ciphertext each time (random IV)", () => {
    expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
  });

  it("returns null for tampered ciphertext rather than garbage", () => {
    const encrypted = encryptSecret("sensitive");
    const parts = encrypted.split(".");
    const tampered = [parts[0], Buffer.from("evil").toString("base64"), parts[2]].join(".");
    expect(decryptSecret(tampered)).toBeNull();
  });

  it("returns null for malformed or absent input", () => {
    expect(decryptSecret(null)).toBeNull();
    expect(decryptSecret("nonsense")).toBeNull();
  });
});
