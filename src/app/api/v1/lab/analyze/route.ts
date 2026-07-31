import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { all, get, run, nowIso } from "@/lib/db";
import { requireApiSession } from "@/lib/auth/guard";
import { processEmailMessage } from "@/lib/ai/process-email";
import { getActiveAIProvider } from "@/lib/ai";

// Powers the Email Test Lab page (/lab). Takes a pasted email, runs the
// real pipeline over it, then reports back exactly what the AI understood —
// facts, confidence, transaction match, and proposed actions — so a
// non-technical user can judge accuracy without reading a database.

const bodySchema = z.object({
  subject: z.string().min(1, "Subject is required"),
  body: z.string().min(1, "Email body is required"),
  fromAddress: z.string().min(3).default("someone@example.com"),
  direction: z.enum(["INCOMING", "OUTGOING"]).default("INCOMING"),
  sentAt: z.string().optional(),
});

export async function POST(req: Request) {
  const auth = await requireApiSession();
  if (auth.failed) return auth.response;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 }
    );
  }
  const { subject, body, fromAddress, direction } = parsed.data;

  const account = get<{ id: string; emailAddress: string }>(
    `SELECT id, emailAddress FROM EmailAccount ORDER BY providerType = 'MOCK' DESC LIMIT 1`
  );
  if (!account) {
    return NextResponse.json(
      { error: "No mailbox found. Reset the demo data from the Dashboard first." },
      { status: 400 }
    );
  }

  const threadId = `lab-t-${randomUUID().slice(0, 8)}`;
  const messageId = `lab-m-${randomUUID().slice(0, 8)}`;
  const sentAt = parsed.data.sentAt ?? nowIso();

  run(`INSERT INTO EmailThread (id, emailAccountId, subject, participants, createdAt) VALUES (?, ?, ?, ?, ?)`, [
    threadId,
    account.id,
    subject,
    JSON.stringify([fromAddress, account.emailAddress]),
    sentAt,
  ]);

  run(
    `INSERT INTO EmailMessage (id, threadId, providerMsgId, fromAddress, toAddresses, subject, bodyText, direction, sentAt, quotedText)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    [
      messageId,
      threadId,
      `lab-${messageId}`,
      direction === "INCOMING" ? fromAddress : account.emailAddress,
      JSON.stringify(direction === "INCOMING" ? [account.emailAddress] : [fromAddress]),
      subject,
      body,
      direction,
      sentAt,
    ]
  );

  const provider = getActiveAIProvider();
  const engine = {
    modelVersion: provider.modelVersion,
    isRealAI: !provider.modelVersion.startsWith("rule-based"),
  };

  try {
    await processEmailMessage(messageId);
  } catch (err) {
    return NextResponse.json(
      { error: `The AI failed while reading this email: ${String(err instanceof Error ? err.message : err)}` },
      { status: 500 }
    );
  }

  // Report back what actually happened, reading from the same tables the
  // rest of the app uses — no separate "demo" path.
  const facts = all<any>(
    `SELECT factType, structuredValue, confidence, evidenceSummary, transactionId
     FROM ExtractedFact WHERE sourceEmailId = ? ORDER BY confidence DESC`,
    [messageId]
  ).map((f) => ({
    factType: f.factType,
    value: JSON.parse(f.structuredValue),
    confidence: f.confidence,
    evidenceSummary: f.evidenceSummary,
    transactionId: f.transactionId,
  }));

  const transactionId = facts[0]?.transactionId ?? null;

  const proposals = all<any>(
    `SELECT p.id, p.proposalType, p.payload, p.confidence, p.fieldConfidence, ri.reviewType, ri.reason, ri.id as reviewItemId
     FROM AIProposal p LEFT JOIN ReviewItem ri ON ri.proposalId = p.id
     WHERE p.sourceEmailIds LIKE ? ORDER BY p.createdAt DESC`,
    [`%${messageId}%`]
  ).map((p) => ({
    id: p.id,
    reviewItemId: p.reviewItemId,
    proposalType: p.proposalType,
    payload: JSON.parse(p.payload),
    confidence: p.confidence,
    fieldConfidence: JSON.parse(p.fieldConfidence),
    reviewType: p.reviewType,
    reason: p.reason,
  }));

  const auditTrail = all<any>(
    `SELECT eventType, summary FROM AuditEvent WHERE entityId = ? OR entityId = ? ORDER BY createdAt ASC`,
    [messageId, transactionId]
  );

  let transaction = null;
  if (transactionId) {
    const txn = get<any>(`SELECT id, status, createdAt FROM TransactionRecord WHERE id = ?`, [transactionId]);
    const address = get<any>(
      `SELECT structuredValue FROM ExtractedFact WHERE transactionId = ? AND factType = 'PROPERTY_ADDRESS' AND status = 'CURRENT' LIMIT 1`,
      [transactionId]
    );
    const wasExisting = txn ? new Date(txn.createdAt).getTime() < new Date(sentAt).getTime() - 1000 : false;
    transaction = {
      id: transactionId,
      status: txn?.status ?? null,
      propertyAddress: address ? JSON.parse(address.structuredValue) : null,
      linkedToExisting: wasExisting,
    };
  }

  const searchedMailbox = auditTrail.some((e) => e.eventType === "search_performed");

  return NextResponse.json({
    ok: true,
    engine,
    messageId,
    facts,
    proposals,
    transaction,
    searchedMailbox,
    auditTrail,
  });
}
