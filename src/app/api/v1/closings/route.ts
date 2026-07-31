import { NextResponse } from "next/server";
import { all } from "@/lib/db";
import { ensureSeeded } from "@/lib/ensure-seeded";
import { requireApiSession } from "@/lib/auth/guard";

export async function GET() {
  const auth = await requireApiSession();
  if (auth.failed) return auth.response;

  await ensureSeeded();
  const closings = all<any>(`SELECT * FROM ClosingEvent ORDER BY createdAt DESC`);

  const enriched = closings.map((c) => {
    const txn = all<any>(`SELECT * FROM TransactionRecord WHERE id = ?`, [c.transactionId])[0];
    const address = all<any>(
      `SELECT structuredValue FROM ExtractedFact WHERE transactionId = ? AND factType = 'PROPERTY_ADDRESS' AND status = 'CURRENT' LIMIT 1`,
      [c.transactionId]
    )[0];
    const buyer = all<any>(
      `SELECT structuredValue FROM ExtractedFact WHERE transactionId = ? AND factType = 'BUYER_NAME' AND status = 'CURRENT' LIMIT 1`,
      [c.transactionId]
    )[0];
    return {
      ...c,
      date: c.date ? JSON.parse(c.date) : null,
      transactionStatus: txn?.status ?? null,
      propertyAddress: address ? JSON.parse(address.structuredValue) : null,
      buyerName: buyer ? JSON.parse(buyer.structuredValue) : null,
    };
  });

  return NextResponse.json({ closings: enriched });
}
