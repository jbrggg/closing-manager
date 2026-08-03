// -----------------------------------------------------------------------------
// DOCUMENT STORAGE
//
// Until now the app recorded that a file was attached — filename, type, size —
// and threw the file away. For a title agency that is most of the job missing:
// the HUD, the CPL, the commitment, the search package and the payoff letter
// ARE the work. A closing record that links to "Commitment.pdf" and cannot
// produce it is a filing cabinet full of empty folders.
//
// Same shape as EmailProvider and AIProvider: an interface plus a factory, so
// moving from local disk to S3 or Supabase Storage later is a config change
// rather than a rewrite. Deployment (roadmap C2) is exactly when that swap
// happens, and it should not require touching any calling code.
//
// CONTENT-ADDRESSED ON PURPOSE. Documents are stored under the SHA-256 of
// their bytes. In this mailbox the same commitment PDF gets forwarded five
// times across a thread; content addressing means it is stored once, and two
// emails carrying the identical file provably carry the identical file. That
// last part matters for evidence: "is the HUD the lender approved the same one
// we sent?" becomes a hash comparison rather than an opinion.
// -----------------------------------------------------------------------------

export interface StoredDocument {
  /** SHA-256 of the file's bytes, lowercase hex. The identity of the document. */
  sha256: string;
  /** Where the store put it. Opaque to callers — only the store interprets it. */
  storageKey: string;
  sizeBytes: number;
  /** True when these exact bytes were already held, so nothing new was written. */
  deduplicated: boolean;
}

export interface DocumentStore {
  /** Human-readable name of the backing store, for the settings screen. */
  readonly kind: string;

  /**
   * Put a document in the store and return its identity.
   *
   * Must be idempotent: storing the same bytes twice writes once and returns
   * `deduplicated: true` the second time.
   */
  put(bytes: Buffer, filename: string): Promise<StoredDocument>;

  /** Fetch a document back. Returns null when the key is unknown. */
  get(storageKey: string): Promise<Buffer | null>;

  /** True when the store holds this key. Cheaper than `get` for existence checks. */
  has(storageKey: string): Promise<boolean>;

  /**
   * Total bytes held, for the settings screen. Returns null when the store
   * cannot answer cheaply (a cloud bucket, for instance).
   */
  sizeOnDisk(): Promise<number | null>;
}
