// Shared enums / row shapes matching db/schema.sql and prisma/schema.prisma.

export type TransactionStatus =
  | "POTENTIAL"
  | "SCHEDULING"
  | "TENTATIVE"
  | "CONFIRMED"
  | "RESCHEDULED"
  | "CANCELLED"
  | "COMPLETED"
  | "ARCHIVED"
  | "NEEDS_REVIEW"
  /** Merged into another transaction. The row is kept, never deleted, so any
   *  audit entry or evidence link pointing at it stays valid. See
   *  src/lib/services/merge.ts. */
  | "MERGED";

export type ClosingStatus =
  | "PROPOSED"
  | "TENTATIVE"
  | "CONFIRMED"
  | "RESCHEDULED"
  | "CANCELLED"
  | "COMPLETED";

export type TaskStatus =
  | "OPEN"
  | "IN_PROGRESS"
  | "WAITING_INTERNALLY"
  | "WAITING_EXTERNALLY"
  | "NEEDS_REVIEW"
  | "COMPLETED"
  | "CANCELLED"
  | "OVERDUE";

export type ProposalStatus =
  | "PROPOSED"
  | "AUTO_APPROVED"
  | "HUMAN_APPROVED"
  | "HUMAN_REJECTED"
  | "REVERSED"
  | "FAILED";

export type ProposalType =
  | "CLOSING_CREATE"
  | "CLOSING_RESCHEDULE"
  | "CLOSING_CANCEL"
  | "TASK_CREATE"
  | "TASK_COMPLETE"
  | "TRANSACTION_MERGE";

export type FactType =
  | "PROPERTY_ADDRESS"
  | "BUYER_NAME"
  | "SELLER_NAME"
  | "LENDER_NAME"
  | "ATTORNEY_NAME"
  | "REALTOR_NAME"
  | "CLOSING_DATE"
  | "CLOSING_TIME"
  | "CLOSING_LOCATION"
  | "FILE_NUMBER"
  | "LOAN_NUMBER"
  | "DEADLINE"
  | "REQUEST"
  | "MILESTONE"
  | "OTHER";

export interface EmailMessageRow {
  id: string;
  threadId: string;
  providerMsgId: string;
  fromAddress: string;
  toAddresses: string; // JSON
  subject: string;
  bodyText: string;
  direction: "INCOMING" | "OUTGOING";
  sentAt: string;
  quotedText: string | null;
}

export interface EmailThreadRow {
  id: string;
  emailAccountId: string;
  subject: string;
  participants: string; // JSON
  createdAt: string;
}

export interface TransactionRow {
  id: string;
  organizationId: string;
  officeId: string | null;
  propertyId: string | null;
  fileNumber: string | null;
  loanNumber: string | null;
  transactionType: string | null;
  status: TransactionStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ExtractedFactRow {
  id: string;
  transactionId: string | null;
  factType: FactType;
  structuredValue: string; // JSON
  sourceEmailId: string;
  sourceThreadId: string;
  sourceTimestamp: string;
  sourceSender: string;
  evidenceSummary: string;
  confidence: number;
  status: "CURRENT" | "SUPERSEDED";
  supersedesId: string | null;
  extractedAt: string;
  modelVersion: string;
}

export interface ClosingEventRow {
  id: string;
  transactionId: string;
  status: ClosingStatus;
  date: string | null;
  time: string | null;
  timezone: string;
  location: string | null;
  locationTBD: number;
  createdAt: string;
}

export interface TaskRow {
  id: string;
  transactionId: string | null;
  title: string;
  category: string;
  priority: string;
  status: TaskStatus;
  assignedUserId: string | null;
  requester: string | null;
  dueAt: string | null;
  dueIsInferred: number;
  waitingCondition: string | null;
  sourceEmailId: string | null;
  confidence: number;
  createdAt: string;
}

export interface AIProposalRow {
  id: string;
  transactionId: string | null;
  proposalType: ProposalType;
  payload: string; // JSON
  confidence: number;
  fieldConfidence: string; // JSON
  status: ProposalStatus;
  idempotencyKey: string;
  sourceEmailIds: string; // JSON array
  createdAt: string;
}

export interface ReviewItemRow {
  id: string;
  transactionId: string | null;
  proposalId: string;
  reviewType: string;
  reason: string;
  conflictingEvidence: string | null;
  duplicateCandidates: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED";
  createdAt: string;
  decidedAt: string | null;
  decidedByUserId: string | null;
}

export interface AuditEventRow {
  id: string;
  organizationId: string;
  eventType: string;
  entityType: string | null;
  entityId: string | null;
  summary: string;
  detail: string | null;
  actorType: "AI" | "HUMAN" | "SYSTEM";
  actorId: string | null;
  createdAt: string;
}

export interface TransactionMergeRow {
  id: string;
  organizationId: string;
  primaryTransactionId: string;
  secondaryTransactionId: string;
  /** JSON: { "TableName": ["rowId", ...] } */
  movedRowIds: string;
  /** JSON array of ExtractedFact ids marked SUPERSEDED by this merge. */
  supersededFactIds: string;
  /** JSON array of TransactionRecord columns the primary inherited. */
  inheritedFields: string;
  explanation: string | null;
  mergedByUserId: string | null;
  mergedAt: string;
  reversedAt: string | null;
  reversedByUserId: string | null;
}
