import { randomUUID } from "node:crypto";
import { run, nowIso } from "@/lib/db";

export function recordAudit(params: {
  organizationId: string;
  eventType: string;
  entityType?: string;
  entityId?: string;
  summary: string;
  detail?: unknown;
  actorType: "AI" | "HUMAN" | "SYSTEM";
  actorId?: string;
}) {
  run(
    `INSERT INTO AuditEvent (id, organizationId, eventType, entityType, entityId, summary, detail, actorType, actorId, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      randomUUID(),
      params.organizationId,
      params.eventType,
      params.entityType ?? null,
      params.entityId ?? null,
      params.summary,
      params.detail ? JSON.stringify(params.detail) : null,
      params.actorType,
      params.actorId ?? null,
      nowIso(),
    ]
  );
}
