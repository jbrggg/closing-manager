import { NextResponse } from "next/server";
import { all } from "@/lib/db";
import { ensureSeeded } from "@/lib/ensure-seeded";
import { requireApiSession } from "@/lib/auth/guard";

export async function GET(req: Request) {
  const auth = await requireApiSession();
  if (auth.failed) return auth.response;

  await ensureSeeded();
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status"); // PENDING | APPROVED | REJECTED | ALL — defaults to PENDING

  const items = all<any>(
    `SELECT ri.*, p.proposalType, p.payload, p.confidence, p.fieldConfidence, p.sourceEmailIds, p.status as proposalStatus
     FROM ReviewItem ri JOIN AIProposal p ON p.id = ri.proposalId
     WHERE ? = 'ALL' OR ri.status = ?
     ORDER BY ri.createdAt DESC`,
    [status ?? "PENDING", status ?? "PENDING"]
  );

  const enriched = items.map((it) => {
    const txn = it.transactionId
      ? all<any>(`SELECT * FROM TransactionRecord WHERE id = ?`, [it.transactionId])[0]
      : null;
    const address = it.transactionId
      ? all<any>(
          `SELECT structuredValue FROM ExtractedFact WHERE transactionId = ? AND factType = 'PROPERTY_ADDRESS' AND status = 'CURRENT' LIMIT 1`,
          [it.transactionId]
        )[0]
      : null;
    return {
      ...it,
      payload: JSON.parse(it.payload),
      fieldConfidence: JSON.parse(it.fieldConfidence),
      sourceEmailIds: JSON.parse(it.sourceEmailIds),
      duplicateCandidates: it.duplicateCandidates ? JSON.parse(it.duplicateCandidates) : null,
      transactionStatus: txn?.status ?? null,
      propertyAddress: address ? JSON.parse(address.structuredValue) : null,
    };
  });

  return NextResponse.json({ reviewItems: enriched });
}
