import { describe, it, expect } from "vitest";
import { extractDocumentText, asAttachmentContext, MAX_TEXT_CHARS } from "@/lib/documents/extract-text";

// A minimal but genuinely valid PDF carrying one line of text. Built by hand
// rather than committed as a binary fixture so that what is being parsed is
// visible in the test itself.
function makePdf(line: string): Buffer {
  const content = `BT /F1 12 Tf 72 720 Td (${line}) Tj ET`;
  const objects = [
    "<</Type/Catalog/Pages 2 0 R>>",
    "<</Type/Pages/Kids[3 0 R]/Count 1>>",
    "<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>",
    `<</Length ${content.length}>>stream\n${content}\nendstream`,
    "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefAt = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xrefAt}\n%%EOF`;

  return Buffer.from(pdf, "latin1");
}

describe("reading a PDF", () => {
  it("pulls the text out", async () => {
    const r = await extractDocumentText(makePdf("Closing set for August 15 2026"), "HUD.pdf");
    expect(r.status).toBe("EXTRACTED");
    expect(r.text).toContain("Closing set for August 15 2026");
  });

  it("reports how many pages it read", async () => {
    const r = await extractDocumentText(makePdf("one page"), "CD.pdf");
    expect(r.pageCount).toBe(1);
  });

  it("recovers the kind of fact that only ever lives in the document", async () => {
    // The whole reason this module exists: the covering email says "see
    // attached" and the closing date is inside the settlement statement.
    const r = await extractDocumentText(
      makePdf("File 25-104427 214 Delmar Street closing 08/15/2026 at 2:00 PM"),
      "settlement.pdf"
    );
    expect(r.text).toContain("25-104427");
    expect(r.text).toContain("214 Delmar Street");
    expect(r.text).toContain("08/15/2026");
  });
});

describe("a PDF with no text layer", () => {
  it("is reported as EMPTY, not as a failure", async () => {
    // This is the scanned-document case. It is not an error — it is the
    // measurement that decides whether OCR is ever worth building, so it must
    // be distinguishable from a parse failure.
    const r = await extractDocumentText(makePdf(""), "scan.pdf");
    expect(r.status).toBe("EMPTY");
    expect(r.text).toBe("");
  });
});

describe("formats it cannot read", () => {
  it("reports an image as unsupported rather than failing", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const r = await extractDocumentText(png, "scan.png", "image/png");
    expect(r.status).toBe("UNSUPPORTED");
  });

  it("trusts the bytes over the file extension", async () => {
    // An attachment named .pdf that is not one must be reported honestly
    // rather than crashing the parser.
    const notReallyPdf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const r = await extractDocumentText(notReallyPdf, "invoice.pdf");
    expect(r.status).toBe("UNSUPPORTED");
  });

  it("reports a corrupt PDF as failed and keeps the reason", async () => {
    const broken = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.from("garbage not a pdf")]);
    const r = await extractDocumentText(broken, "broken.pdf");
    expect(r.status).toBe("FAILED");
    expect(r.error).toBeTruthy();
  });

  it("reports an empty file as failed", async () => {
    const r = await extractDocumentText(Buffer.alloc(0), "nothing.pdf");
    expect(r.status).toBe("FAILED");
  });
});

describe("plain text attachments", () => {
  it("reads a .txt file", async () => {
    const r = await extractDocumentText(Buffer.from("Payoff good through 08/20."), "payoff.txt");
    expect(r.status).toBe("EXTRACTED");
    expect(r.text).toBe("Payoff good through 08/20.");
  });

  it("reads a CSV by mime type", async () => {
    const r = await extractDocumentText(Buffer.from("a,b\n1,2"), "fees", "text/csv");
    expect(r.status).toBe("EXTRACTED");
  });
});

describe("very long documents", () => {
  it("truncates rather than swamping the model, and says so", async () => {
    const huge = Buffer.from("word ".repeat(MAX_TEXT_CHARS));
    const r = await extractDocumentText(huge, "policy.txt");
    expect(r.truncated).toBe(true);
    expect(r.text.length).toBeLessThanOrEqual(MAX_TEXT_CHARS);
  });
});

describe("handing the text to the AI", () => {
  it("labels it so a fact can be traced to the document it came from", () => {
    const ctx = asAttachmentContext("HUD-214-Delmar.pdf", "Cash to close $12,410.22");
    expect(ctx).toContain("HUD-214-Delmar.pdf");
    expect(ctx).toContain("Cash to close $12,410.22");
    // The model must be able to tell document text from email body text.
    expect(ctx).toMatch(/attached document/i);
  });
});
