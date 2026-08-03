-- Runtime schema (SQLite) mirroring prisma/schema.prisma.
-- IDs are TEXT (uuid). Timestamps are ISO 8601 TEXT. Enums are TEXT with app-level validation.

CREATE TABLE IF NOT EXISTS Organization (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'America/New_York',
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS Office (
  id TEXT PRIMARY KEY,
  organizationId TEXT NOT NULL,
  name TEXT NOT NULL,
  address TEXT,
  businessHours TEXT,
  isDefault INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS AppUser (
  id TEXT PRIMARY KEY,
  organizationId TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'STAFF',
  passwordHash TEXT,
  isActive INTEGER NOT NULL DEFAULT 1,
  lastLoginAt TEXT,
  createdAt TEXT NOT NULL
);

-- Opaque server-side sessions. The cookie holds a random token only; all
-- authority lives in this row, so revoking access is a DELETE (no
-- self-contained JWT that stays valid until expiry).
CREATE TABLE IF NOT EXISTS Session (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  tokenHash TEXT NOT NULL UNIQUE,
  expiresAt TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  userAgent TEXT
);

CREATE INDEX IF NOT EXISTS idx_session_user ON Session(userId);

CREATE TABLE IF NOT EXISTS EmailAccount (
  id TEXT PRIMARY KEY,
  organizationId TEXT NOT NULL,
  providerType TEXT NOT NULL DEFAULT 'MOCK',
  emailAddress TEXT NOT NULL,
  connected INTEGER NOT NULL DEFAULT 1,
  lastSyncedAt TEXT,
  -- OAuth material, encrypted at rest with AES-256-GCM (src/lib/auth/crypto.ts).
  -- Never store raw tokens.
  accessTokenEnc TEXT,
  refreshTokenEnc TEXT,
  tokenExpiresAt TEXT,
  providerAccountId TEXT,
  -- Microsoft Graph delta link for incremental sync (opaque URL).
  deltaLink TEXT,
  lastSyncError TEXT,
  -- What the last sync run did ("4 fetched, 4 processed"), and when it ended.
  -- Shown on the dashboard so a scheduled sync can be seen to be alive even
  -- when the mailbox is quiet and nothing new arrived.
  -- NOTE: these two are also listed in ADDITIVE_COLUMNS in src/lib/db.ts, which
  -- is what adds them to a database that already exists. Keep both in step.
  lastSyncSummary TEXT,
  lastSyncFinishedAt TEXT
);

CREATE TABLE IF NOT EXISTS EmailThread (
  id TEXT PRIMARY KEY,
  emailAccountId TEXT NOT NULL,
  subject TEXT NOT NULL,
  participants TEXT NOT NULL,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS EmailMessage (
  id TEXT PRIMARY KEY,
  threadId TEXT NOT NULL,
  providerMsgId TEXT NOT NULL,
  fromAddress TEXT NOT NULL,
  toAddresses TEXT NOT NULL,
  subject TEXT NOT NULL,
  bodyText TEXT NOT NULL,
  direction TEXT NOT NULL,
  sentAt TEXT NOT NULL,
  quotedText TEXT
);

CREATE TABLE IF NOT EXISTS EmailAttachment (
  id TEXT PRIMARY KEY,
  messageId TEXT NOT NULL,
  filename TEXT NOT NULL,
  mimeType TEXT NOT NULL,
  sizeBytes INTEGER NOT NULL,
  -- Where the bytes actually live. NULL means we recorded that a file was
  -- attached but never held it - true for everything ingested before document
  -- storage existed. See src/lib/storage/.
  storageKey TEXT,
  -- SHA-256 of the bytes. Two attachments with the same hash ARE the same
  -- document, which is how "is the HUD they approved the one we sent?"
  -- becomes a comparison rather than an opinion.
  sha256 TEXT
);

CREATE TABLE IF NOT EXISTS Person (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  role TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS Company (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS Property (
  id TEXT PRIMARY KEY,
  rawAddress TEXT NOT NULL,
  normalizedAddress TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS TransactionRecord (
  id TEXT PRIMARY KEY,
  organizationId TEXT NOT NULL,
  officeId TEXT,
  propertyId TEXT,
  fileNumber TEXT,
  loanNumber TEXT,
  transactionType TEXT,
  status TEXT NOT NULL DEFAULT 'POTENTIAL',
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS TransactionParticipant (
  id TEXT PRIMARY KEY,
  transactionId TEXT NOT NULL,
  personId TEXT,
  companyId TEXT,
  participantRole TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ExtractedFact (
  id TEXT PRIMARY KEY,
  transactionId TEXT,
  factType TEXT NOT NULL,
  structuredValue TEXT NOT NULL,
  sourceEmailId TEXT NOT NULL,
  sourceThreadId TEXT NOT NULL,
  sourceTimestamp TEXT NOT NULL,
  sourceSender TEXT NOT NULL,
  evidenceSummary TEXT NOT NULL,
  confidence REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'CURRENT',
  supersedesId TEXT,
  extractedAt TEXT NOT NULL,
  modelVersion TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ClosingEvent (
  id TEXT PRIMARY KEY,
  transactionId TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PROPOSED',
  date TEXT,
  time TEXT,
  timezone TEXT NOT NULL DEFAULT 'America/New_York',
  location TEXT,
  locationTBD INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ClosingEventRevision (
  id TEXT PRIMARY KEY,
  closingEventId TEXT NOT NULL,
  changedFields TEXT NOT NULL,
  reason TEXT,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS Task (
  id TEXT PRIMARY KEY,
  transactionId TEXT,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'normal',
  status TEXT NOT NULL DEFAULT 'OPEN',
  assignedUserId TEXT,
  requester TEXT,
  dueAt TEXT,
  dueIsInferred INTEGER NOT NULL DEFAULT 0,
  waitingCondition TEXT,
  sourceEmailId TEXT,
  confidence REAL NOT NULL,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS TaskDependency (
  id TEXT PRIMARY KEY,
  taskId TEXT NOT NULL,
  triggerDescription TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS TaskCompletionEvidence (
  id TEXT PRIMARY KEY,
  taskId TEXT NOT NULL,
  evidenceEmailId TEXT,
  summary TEXT NOT NULL,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS AIProposal (
  id TEXT PRIMARY KEY,
  transactionId TEXT,
  proposalType TEXT NOT NULL,
  payload TEXT NOT NULL,
  confidence REAL NOT NULL,
  fieldConfidence TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PROPOSED',
  idempotencyKey TEXT NOT NULL UNIQUE,
  sourceEmailIds TEXT NOT NULL,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ReviewItem (
  id TEXT PRIMARY KEY,
  transactionId TEXT,
  proposalId TEXT NOT NULL UNIQUE,
  reviewType TEXT NOT NULL,
  reason TEXT NOT NULL,
  conflictingEvidence TEXT,
  duplicateCandidates TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',
  createdAt TEXT NOT NULL,
  decidedAt TEXT,
  decidedByUserId TEXT
);

-- An email joined to a file on the strength of the property address alone.
--
-- Address agreement scores 45 against a strong-match threshold of 60, so this
-- is NOT a strong match and must never be treated as settled: the same property
-- legitimately carries more than one transaction over time (a sale, then a
-- refinance). The office's decision (2026-07-31) is that a bare address match
-- should still put the email on the file rather than start a second one, and
-- raise a warning that the file number is missing.
--
-- movedFactIds / movedProposalIds record exactly what was written under the
-- link, so rejecting it moves those rows back out onto a fresh file. Same
-- shape as TransactionMerge, for the same reason: nothing is undoable unless
-- you wrote down what you did.
CREATE TABLE IF NOT EXISTS ProvisionalMatch (
  id TEXT PRIMARY KEY,
  transactionId TEXT NOT NULL,
  sourceEmailId TEXT NOT NULL,
  reason TEXT NOT NULL,
  movedFactIds TEXT NOT NULL,
  movedProposalIds TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  createdAt TEXT NOT NULL,
  decidedAt TEXT,
  decidedByUserId TEXT
);

CREATE TABLE IF NOT EXISTS AIProcessingJob (
  id TEXT PRIMARY KEY,
  emailMessageId TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  startedAt TEXT,
  finishedAt TEXT,
  errorText TEXT
);

CREATE TABLE IF NOT EXISTS AuditEvent (
  id TEXT PRIMARY KEY,
  organizationId TEXT NOT NULL,
  eventType TEXT NOT NULL,
  entityType TEXT,
  entityId TEXT,
  summary TEXT NOT NULL,
  detail TEXT,
  actorType TEXT NOT NULL,
  actorId TEXT,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS Notification (
  id TEXT PRIMARY KEY,
  userId TEXT,
  message TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS AutomationRule (
  id TEXT PRIMARY KEY,
  actionType TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  minConfidence REAL NOT NULL DEFAULT 0.95
);

-- Office policy knobs (roadmap D2). Key/value so a new knob doesn't need a
-- schema change; every value is validated in src/lib/services/office-rules.ts
-- before it is written or used.
CREATE TABLE IF NOT EXISTS OfficeSetting (
  organizationId TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  PRIMARY KEY (organizationId, key)
);

-- Record of one transaction merged into another (roadmap D1). Keeps every
-- moved row id so an incorrect merge can be reversed exactly; nothing is ever
-- deleted by a merge.
CREATE TABLE IF NOT EXISTS TransactionMerge (
  id TEXT PRIMARY KEY,
  organizationId TEXT NOT NULL,
  primaryTransactionId TEXT NOT NULL,
  secondaryTransactionId TEXT NOT NULL,
  -- JSON: { "TableName": ["rowId", ...] }
  movedRowIds TEXT NOT NULL,
  -- JSON array of ExtractedFact ids marked SUPERSEDED by this merge
  supersededFactIds TEXT NOT NULL,
  -- JSON array of TransactionRecord columns the primary inherited
  inheritedFields TEXT NOT NULL,
  explanation TEXT,
  mergedByUserId TEXT,
  mergedAt TEXT NOT NULL,
  reversedAt TEXT,
  reversedByUserId TEXT
);

CREATE INDEX IF NOT EXISTS idx_fact_transaction ON ExtractedFact(transactionId);
CREATE INDEX IF NOT EXISTS idx_task_transaction ON Task(transactionId);
CREATE INDEX IF NOT EXISTS idx_closing_transaction ON ClosingEvent(transactionId);
CREATE INDEX IF NOT EXISTS idx_review_status ON ReviewItem(status);
CREATE INDEX IF NOT EXISTS idx_message_thread ON EmailMessage(threadId);
