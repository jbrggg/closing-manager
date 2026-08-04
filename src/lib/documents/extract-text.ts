/**
 * READING TEXT OUT OF ATTACHED DOCUMENTS
 *
 * WHY THIS EXISTS
 *
 * Of the 21 real emails collected as test cases, 16 reference an attachment.
 * Until now the application recorded that a document existed and read nothing
 * from it — which means that whenever the closing date lived in the attached
 * settlement statement rather than in the covering note, the AI was being
 * marked wrong for failing to know something it was never shown.
 *
 * That matters beyond the missed fact: it corrupts the accuracy scorecard.
 * Tuning prompts against a missing-input problem cannot work, because no
 * wording change can recover information that was never in the context.
 *
 * WHAT THIS DOES NOT DO
 *
 * There is no OCR here, deliberately. Documents from lenders, underwriters and
 * title production systems are generated digitally and carry a real text
 * layer; OCR is for scans and faxes. It is a heavy dependency and it
 * introduces character-level errors into loan numbers and dollar figures,
 * which is precisely where errors are least acceptable.
 *
 * Instead, a document whose text layer is empty is recorded as EMPTY rather
 * than treated as a failure. Counting those over a few weeks of real mail is
 * what should decide whether OCR is ever worth adding — a decision currently
 * nobody has the evidence to make.
 */

/** Beyond this, text is truncated. A 300-page policy must not swamp the model. */
export const MAX_TEXT_CHARS = 120_000;

export type ExtractionStatus =
  /** Text was found. */
  | "EXTRACTED"
  /** A readable format, but no text inside — almost certainly a scan. */
  | "EMPTY"
  /** A format this cannot read at all (images, spreadsheets, archives). */
  | "UNSUPPORTED"
  /** Corrupt, encrypted, or otherwise broken. */
  | "FAILED";

export interface ExtractedDocument {
  status: ExtractionStatus;
  /** Empty string unless status is EXTRACTED. */
  text: string;
  pageCount: number | null;
  /** Present when status is FAILED — for the activity log, not for the user. */
  error?: string;
  truncated: boolean;
}

function looksLikePdf(bytes: Buffer): boolean {
  // Trust the bytes, not the filename. An attachment called .pdf that isn't
  // one should be reported honestly rather than crashing the parser.
  return bytes.subarray(0, 5).toString("latin1") === "%PDF-";
}

const TEXT_LIKE = /^(?:text\/|application\/(?:json|xml|csv))/i;

/**
 * Collapse the whitespace soup that PDF text extraction produces.
 *
 * Extracted PDF text arrives with per-glyph spacing artefacts and ragged line
 * breaks. Left alone it wastes model context and makes evidence quotes look
 * mangled to whoever reads them in the review queue.
 */
function tidy(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t ]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function extractDocumentText(
  bytes: Buffer,
  filename: string,
  mimeType?: string
): Promise<ExtractedDocument> {
  const empty = { text: "", pageCount: null, truncated: false };

  if (!bytes || bytes.length === 0) {
    return { status: "FAILED", error: "The file was empty.", ...empty };
  }

  // --- plain text ------------------------------------------------------------
  if (TEXT_LIKE.test(mimeType ?? "") || /\.(txt|csv|json|xml)$/i.test(filename)) {
    const text = tidy(bytes.toString("utf-8"));
    return {
      status: text ? "EXTRACTED" : "EMPTY",
      text: text.slice(0, MAX_TEXT_CHARS),
      pageCount: null,
      truncated: text.length > MAX_TEXT_CHARS,
    };
  }

  // --- pdf -------------------------------------------------------------------
  if (looksLikePdf(bytes)) {
    try {
      // Imported lazily so that the parser — which is large — is only loaded
      // by processes that actually meet a PDF. Tests and the dev server that
      // never touch one pay nothing for it.
      const { getDocumentProxy, extractText } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(bytes));
      const { totalPages, text } = await extractText(pdf, { mergePages: true });

      const tidied = tidy(Array.isArray(text) ? text.join("\n") : text);
      if (!tidied) {
        // A PDF with pages but no text layer is a scan. This is the number
        // that decides whether OCR is ever worth building.
        return { status: "EMPTY", text: "", pageCount: totalPages ?? null, truncated: false };
      }
      return {
        status: "EXTRACTED",
        text: tidied.slice(0, MAX_TEXT_CHARS),
        pageCount: totalPages ?? null,
        truncated: tidied.length > MAX_TEXT_CHARS,
      };
    } catch (err) {
      // Encrypted and malformed PDFs are ordinary in a mailbox. Losing the
      // email because one attachment would not open is not acceptable.
      return {
        status: "FAILED",
        error: err instanceof Error ? err.message : String(err),
        ...empty,
      };
    }
  }

  return { status: "UNSUPPORTED", ...empty };
}

/**
 * Format extracted text for the AI, clearly marked as coming from a document.
 *
 * The model must be able to tell "the lender wrote this in the email" from
 * "this appeared inside an attached settlement statement". Both are evidence;
 * they are not equally direct, and a fact's provenance should be able to name
 * the document it came from.
 */
export function asAttachmentContext(filename: string, text: string): string {
  return `\n\n--- Text of attached document "${filename}" ---\n${text}\n--- end of "${filename}" ---`;
}
