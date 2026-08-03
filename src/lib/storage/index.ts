import type { DocumentStore } from "./provider";
import { LocalDocumentStore } from "./local-store";

// -----------------------------------------------------------------------------
// Document-store factory.
//
// Callers ask for `getDocumentStore()` rather than constructing a store, so
// moving to S3 or Supabase Storage at deployment time (roadmap C2) is a new
// file plus a case here — no calling code changes.
//
// Only local disk exists today. A cloud store should be added when there is a
// real deployment to put it in, not before: an S3 adapter nobody can test
// against a real bucket is the same kind of unverified code as the Outlook
// adapter, and this project already has one of those.
// -----------------------------------------------------------------------------

let cached: DocumentStore | null = null;

export function getDocumentStore(): DocumentStore {
  if (cached) return cached;

  const configured = (process.env.STORAGE_PROVIDER ?? "local").toLowerCase();
  if (configured !== "local") {
    console.warn(
      `[storage] STORAGE_PROVIDER="${configured}" is not implemented — falling back to local disk. ` +
        "Only 'local' exists today; see src/lib/storage/index.ts."
    );
  }

  cached = new LocalDocumentStore();
  return cached;
}

/** Tests use this to point at a throwaway folder. */
export function setDocumentStore(store: DocumentStore | null): void {
  cached = store;
}

export type { DocumentStore, StoredDocument } from "./provider";
export { LocalDocumentStore } from "./local-store";
