import { NextResponse } from "next/server";
import { all, get } from "@/lib/db";
import { requireApiSession } from "@/lib/auth/guard";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiSession();
  if (auth.failed) return auth.response;

  const { id } = await params;

  const txn = get<any>(`SELECT * FROM TransactionRecord WHERE id = ?`, [id]);
  if (!txn) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const facts = all<any>(
    `SELECT * FROM ExtractedFact WHERE transactionId = ? ORDER BY extractedAt DESC`,
    [id]
  );
  const closings = all<any>(`SELECT * FROM ClosingEvent WHERE transactionId = ? ORDER BY createdAt ASC`, [id]);
  const tasks = all<any>(`SELECT * FROM Task WHERE transactionId = ? ORDER BY createdAt DESC`, [id]);
  const reviewItems = all<any>(
    `SELECT * FROM ReviewItem WHERE transactionId = ? ORDER BY createdAt DESC`,
    [id]
  );
  const proposals = all<any>(
    `SELECT * FROM AIProposal WHERE transactionId = ? ORDER BY createdAt DESC`,
    [id]
  );
  const auditEvents = all<any>(
    `SELECT * FROM AuditEvent WHERE entityId = ? OR entityId IN (SELECT id FROM ClosingEvent WHERE transactionId = ?) ORDER BY createdAt DESC`,
    [id, id]
  );

  // Related email = union of source emails from facts + proposals
  const emailIds = new Set<string>();
  for (const f of facts) emailIds.add(f.sourceEmailId);
  for (const p of proposals) {
    const ids: string[] = JSON.parse(p.sourceEmailIds);
    ids.forEach((e) => emailIds.add(e));
  }
  const relatedEmail =
    emailIds.size > 0
      ? all<any>(
          `SELECT * FROM EmailMessage WHERE id IN (${Array.from(emailIds).map(() => "?").join(",")}) ORDER BY sentAt ASC`,
          Array.from(emailIds)
        )
      : [];

  // Timeline: merge facts + closings + tasks + audit into chronological events
  const timeline = [
    ...facts.map((f) => ({ type: "fact", at: f.sourceTimestamp, summary: f.evidenceSummary, data: f })),
    ...closings.map((c) => ({ type: "closing", at: c.createdAt, summary: `Closing ${c.status.toLowerCase()}`, data: c })),
    ...tasks.map((t) => ({ type: "task", at: t.createdAt, summary: `Task created: ${t.title}`, data: t })),
  ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  return NextResponse.json({
    transaction: txn,
    facts,
    closings,
    tasks,
    reviewItems,
    proposals,
    relatedEmail,
    timeline,
    auditEvents,
  });
}
