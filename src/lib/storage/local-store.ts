import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { DocumentStore, StoredDocument } from "./provider";

// -----------------------------------------------------------------------------
// LOCAL DISK DOCUMENT STORE
//
// Files live under `storage/documents/ab/cdef...` — the first two characters of
// the hash become a directory. That fan-out exists because a single folder with
// tens of thousands of entries is slow to list on Windows, and this agency
// generates a lot of documents.
//
// Deliberately NOT in the database. SQLite would happily hold a 4 MB PDF in a
// BLOB, and it would bloat the file, slow every backup, and make the eventual
// Postgres migration far heavier than it needs to be. Documents belong on a
// filesystem or in object storage; the database keeps the pointer.
// -----------------------------------------------------------------------------

/** Reject anything implausible as a single email attachment. */
const MAX_BYTES = 50 * 1024 * 1024;

export class LocalDocumentStore implements DocumentStore {
  readonly kind = "local disk";
  private readonly root: string;

  constructor(root?: string) {
    this.root =
      root ??
      process.env.DOCUMENT_STORAGE_PATH ??
      path.join(process.cwd(), "storage", "documents");
  }

  /** `<root>/ab/abcdef...` — never accepts a caller-supplied path. */
  private pathFor(sha256: string): string {
    // Guard against a malformed hash reaching path.join and escaping the root.
    if (!/^[0-9a-f]{64}$/.test(sha256)) {
      throw new Error(`Not a valid document id: ${sha256.slice(0, 32)}`);
    }
    return path.join(this.root, sha256.slice(0, 2), sha256);
  }

  /** Turn a storage key back into a path, rejecting anything that isn't ours. */
  private resolveKey(storageKey: string): string {
    const match = storageKey.match(/^local:([0-9a-f]{64})$/);
    if (!match) throw new Error(`Not a local storage key: ${storageKey.slice(0, 40)}`);
    return this.pathFor(match[1]);
  }

  async put(bytes: Buffer, filename: string): Promise<StoredDocument> {
    if (bytes.length === 0) throw new Error(`"${filename}" is empty — nothing to store`);
    if (bytes.length > MAX_BYTES) {
      throw new Error(
        `"${filename}" is ${(bytes.length / 1024 / 1024).toFixed(1)} MB, over the ${MAX_BYTES / 1024 / 1024} MB limit`
      );
    }

    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const target = this.pathFor(sha256);
    const storageKey = `local:${sha256}`;

    if (fs.existsSync(target)) {
      return { sha256, storageKey, sizeBytes: bytes.length, deduplicated: true };
    }

    fs.mkdirSync(path.dirname(target), { recursive: true });

    // Write to a temp name then rename. A crash mid-write must not leave a
    // truncated file sitting at a hash that says it is complete — the whole
    // point of content addressing is that the name is a promise about the
    // contents. Rename is atomic on the same volume.
    const temp = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(temp, bytes);
    try {
      fs.renameSync(temp, target);
    } catch (err) {
      // Another process may have won the race and created it first, which is
      // fine — identical bytes by definition.
      fs.rmSync(temp, { force: true });
      if (!fs.existsSync(target)) throw err;
      return { sha256, storageKey, sizeBytes: bytes.length, deduplicated: true };
    }

    return { sha256, storageKey, sizeBytes: bytes.length, deduplicated: false };
  }

  async get(storageKey: string): Promise<Buffer | null> {
    let target: string;
    try {
      target = this.resolveKey(storageKey);
    } catch {
      return null;
    }
    if (!fs.existsSync(target)) return null;
    return fs.readFileSync(target);
  }

  async has(storageKey: string): Promise<boolean> {
    try {
      return fs.existsSync(this.resolveKey(storageKey));
    } catch {
      return false;
    }
  }

  async sizeOnDisk(): Promise<number | null> {
    if (!fs.existsSync(this.root)) return 0;
    let total = 0;
    for (const bucket of fs.readdirSync(this.root)) {
      const dir = path.join(this.root, bucket);
      if (!fs.statSync(dir).isDirectory()) continue;
      for (const file of fs.readdirSync(dir)) {
        total += fs.statSync(path.join(dir, file)).size;
      }
    }
    return total;
  }
}
