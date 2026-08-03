import Link from "next/link";
import { all } from "@/lib/db";
import { ensureSeeded } from "@/lib/ensure-seeded";
import { PageHeader, Panel, EmptyState } from "@/components/ui/layout-primitives";
import { StatusChip } from "@/components/ui/status-chip";
import { displayFactValue } from "@/lib/format";
import { requirePageSession } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

export default async function BoardPage() {
  await requirePageSession();
  await ensureSeeded();
  const closings = all<any>(`SELECT * FROM ClosingEvent ORDER BY createdAt ASC`);

  const enriched = closings.map((c) => {
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
      dateValue: c.date ? JSON.parse(c.date) : null,
      propertyAddress: address ? JSON.parse(address.structuredValue) : "Address pending",
      buyerName: buyer ? JSON.parse(buyer.structuredValue) : "Buyer pending",
    };
  });

  const grouped = new Map<string, typeof enriched>();
  for (const c of enriched) {
    const key = displayFactValue("CLOSING_DATE", c.dateValue);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(c);
  }

  return (
    <div>
      <PageHeader
        title="Settlement Board"
        subtitle="All closings across offices — tentative and confirmed shown distinctly. Mock data grouped by proposed/confirmed day."
      />
      <div className="space-y-4 px-6 py-6">
        {grouped.size === 0 ? (
          <Panel>
            <EmptyState message="No closings yet — approve a closing proposal in the review queue to see it here." />
          </Panel>
        ) : (
          Array.from(grouped.entries()).map(([day, items]) => (
            <Panel key={day} title={day}>
              <div className="grid grid-cols-1 divide-y divide-line md:grid-cols-2 md:divide-x md:divide-y-0 lg:grid-cols-3">
                {items.map((c) => (
                  <Link
                    key={c.id}
                    href={`/transactions/${c.transactionId}`}
                    className="block px-4 py-3 text-[1.0625rem] hover:bg-paper"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-ink">{c.propertyAddress}</span>
                      <StatusChip status={c.status} />
                    </div>
                    <div className="mt-1 text-ink-muted">{c.buyerName}</div>
                    <div className="mt-1 flex items-center gap-2 text-[0.9375rem] text-ink-muted">
                      <span>{c.time ?? "Time TBD"}</span>
                      <span>·</span>
                      <span>{c.locationTBD ? "Location TBD" : c.location ?? "Location TBD"}</span>
                    </div>
                  </Link>
                ))}
              </div>
            </Panel>
          ))
        )}
      </div>
    </div>
  );
}
