import { NextResponse } from "next/server";
import { all } from "@/lib/db";
import { ensureSeeded } from "@/lib/ensure-seeded";
import { requireApiSession } from "@/lib/auth/guard";

export async function GET() {
  const auth = await requireApiSession();
  if (auth.failed) return auth.response;

  await ensureSeeded();
  const tasks = all<any>(`SELECT * FROM Task ORDER BY createdAt DESC`);
  const enriched = tasks.map((t) => {
    const txn = t.transactionId
      ? all<any>(`SELECT * FROM TransactionRecord WHERE id = ?`, [t.transactionId])[0]
      : null;
    const address = t.transactionId
      ? all<any>(
          `SELECT structuredValue FROM ExtractedFact WHERE transactionId = ? AND factType = 'PROPERTY_ADDRESS' AND status = 'CURRENT' LIMIT 1`,
          [t.transactionId]
        )[0]
      : null;
    return {
      ...t,
      transactionStatus: txn?.status ?? null,
      propertyAddress: address ? JSON.parse(address.structuredValue) : null,
    };
  });
  return NextResponse.json({ tasks: enriched });
}
