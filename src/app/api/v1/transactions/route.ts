import { NextResponse } from "next/server";
import { all } from "@/lib/db";
import { ensureSeeded } from "@/lib/ensure-seeded";
import { requireApiSession } from "@/lib/auth/guard";

const ORG_ID = "org-demo";

export async function GET() {
  const auth = await requireApiSession();
  if (auth.failed) return auth.response;

  await ensureSeeded();

  const transactions = all<any>(`SELECT * FROM TransactionRecord WHERE organizationId = ? ORDER BY updatedAt DESC`, [
    ORG_ID,
  ]);

  const enriched = transactions.map((txn) => {
    const facts = all<any>(
      `SELECT * FROM ExtractedFact WHERE transactionId = ? AND status = 'CURRENT'`,
      [txn.id]
    );
    const factMap: Record<string, any> = {};
    for (const f of facts) {
      if (!factMap[f.factType]) factMap[f.factType] = JSON.parse(f.structuredValue);
    }
    const closing = all<any>(
      `SELECT * FROM ClosingEvent WHERE transactionId = ? ORDER BY createdAt DESC LIMIT 1`,
      [txn.id]
    )[0];
    const openTasks = all<{ c: number }>(
      `SELECT COUNT(*) as c FROM Task WHERE transactionId = ? AND status NOT IN ('COMPLETED','CANCELLED')`,
      [txn.id]
    )[0]?.c ?? 0;
    const reviewCount = all<{ c: number }>(
      `SELECT COUNT(*) as c FROM ReviewItem WHERE transactionId = ? AND status = 'PENDING'`,
      [txn.id]
    )[0]?.c ?? 0;

    return {
      ...txn,
      propertyAddress: factMap.PROPERTY_ADDRESS ?? null,
      buyerName: factMap.BUYER_NAME ?? null,
      sellerName: factMap.SELLER_NAME ?? null,
      closing: closing ?? null,
      openTaskCount: openTasks,
      reviewCount,
    };
  });

  return NextResponse.json({ transactions: enriched });
}
