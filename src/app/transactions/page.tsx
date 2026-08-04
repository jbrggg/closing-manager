import Link from "next/link";
import { all } from "@/lib/db";
import { ensureSeeded } from "@/lib/ensure-seeded";
import { PageHeader, EmptyState } from "@/components/ui/layout-primitives";
import { StatusChip } from "@/components/ui/status-chip";
import { formatRelative } from "@/lib/format";
import { requirePageSession } from "@/lib/auth/guard";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Files",
};

export const dynamic = "force-dynamic";

export default async function TransactionsPage() {
  await requirePageSession();
  await ensureSeeded();
  const transactions = all<any>(`SELECT * FROM TransactionRecord ORDER BY updatedAt DESC`);

  const enriched = transactions.map((t) => {
    const address = all<any>(
      `SELECT structuredValue FROM ExtractedFact WHERE transactionId = ? AND factType = 'PROPERTY_ADDRESS' AND status = 'CURRENT' LIMIT 1`,
      [t.id]
    )[0];
    const buyer = all<any>(
      `SELECT structuredValue FROM ExtractedFact WHERE transactionId = ? AND factType = 'BUYER_NAME' AND status = 'CURRENT' LIMIT 1`,
      [t.id]
    )[0];
    const closing = all<any>(`SELECT * FROM ClosingEvent WHERE transactionId = ? ORDER BY createdAt DESC LIMIT 1`, [t.id])[0];
    const openTasks = all<{ c: number }>(
      `SELECT COUNT(*) as c FROM Task WHERE transactionId = ? AND status NOT IN ('COMPLETED','CANCELLED')`,
      [t.id]
    )[0]?.c ?? 0;
    const reviewCount = all<{ c: number }>(
      `SELECT COUNT(*) as c FROM ReviewItem WHERE transactionId = ? AND status = 'PENDING'`,
      [t.id]
    )[0]?.c ?? 0;

    return {
      ...t,
      propertyAddress: address ? JSON.parse(address.structuredValue) : "Pending",
      buyerName: buyer ? JSON.parse(buyer.structuredValue) : "Pending",
      closingDate: closing?.date ? JSON.parse(closing.date) : null,
      closingTime: closing?.time ?? null,
      openTasks,
      reviewCount,
    };
  });

  return (
    <div>
      <PageHeader title="Transactions" subtitle={`${enriched.length} operational transaction record(s)`} />
      <div className="px-6 py-6">
        {enriched.length === 0 ? (
          <EmptyState message="No transactions yet." />
        ) : (
          <div className="overflow-hidden rounded-sm border border-border bg-surface">
            <table className="w-full text-[1.0625rem]">
              <thead>
                <tr className="border-b border-border bg-paper text-left text-[0.9375rem] uppercase tracking-wide text-ink-muted">
                  <th className="px-4 py-2.5 font-medium">Property</th>
                  <th className="px-4 py-2.5 font-medium">Buyer</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Closing</th>
                  <th className="px-4 py-2.5 font-medium">Open tasks</th>
                  <th className="px-4 py-2.5 font-medium">Review</th>
                  <th className="px-4 py-2.5 font-medium">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {enriched.map((t) => (
                  <tr key={t.id} className="hover:bg-paper">
                    <td className="px-4 py-2.5">
                      <Link href={`/transactions/${t.id}`} className="font-medium text-ink hover:underline">
                        {t.propertyAddress}
                      </Link>
                      <div className="font-mono-data text-[0.9375rem] text-ink-muted">{t.id.slice(0, 8)}</div>
                    </td>
                    <td className="px-4 py-2.5 text-ink-muted">{t.buyerName}</td>
                    <td className="px-4 py-2.5">
                      <StatusChip status={t.status} />
                    </td>
                    <td className="px-4 py-2.5 text-ink-muted">
                      {t.closingDate ? `${t.closingDate.dayOfWeek ?? t.closingDate}` : "—"}
                      {t.closingTime ? ` · ${t.closingTime}` : ""}
                    </td>
                    <td className="px-4 py-2.5 text-ink-muted">{t.openTasks}</td>
                    <td className="px-4 py-2.5">
                      {t.reviewCount > 0 ? (
                        <span className="font-semibold text-review">{t.reviewCount}</span>
                      ) : (
                        <span className="text-ink-muted">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-ink-muted">{formatRelative(t.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
