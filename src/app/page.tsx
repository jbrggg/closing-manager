import Link from "next/link";
import { all, get } from "@/lib/db";
import { ensureSeeded } from "@/lib/ensure-seeded";
import { PageHeader, Panel, StatTile, EmptyState } from "@/components/ui/layout-primitives";
import { StatusChip } from "@/components/ui/status-chip";
import { ResetSeedButton } from "@/components/ui/reset-seed-button";
import { formatRelative, formatDateTime, titleCaseEnum } from "@/lib/format";
import { requirePageSession } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  await requirePageSession();
  await ensureSeeded();

  const tentativeClosings = get<{ c: number }>(`SELECT COUNT(*) as c FROM ClosingEvent WHERE status = 'TENTATIVE'`)?.c ?? 0;
  const confirmedClosings = get<{ c: number }>(`SELECT COUNT(*) as c FROM ClosingEvent WHERE status = 'CONFIRMED'`)?.c ?? 0;
  const reschedules = get<{ c: number }>(`SELECT COUNT(*) as c FROM ClosingEvent WHERE status = 'RESCHEDULED'`)?.c ?? 0;
  const openTasks = get<{ c: number }>(`SELECT COUNT(*) as c FROM Task WHERE status = 'OPEN'`)?.c ?? 0;
  const waitingTasks = get<{ c: number }>(
    `SELECT COUNT(*) as c FROM Task WHERE status IN ('WAITING_INTERNALLY','WAITING_EXTERNALLY')`
  )?.c ?? 0;
  const reviewCount = get<{ c: number }>(`SELECT COUNT(*) as c FROM ReviewItem WHERE status = 'PENDING'`)?.c ?? 0;

  const emailAccounts = all<any>(`SELECT * FROM EmailAccount`);
  const recentActivity = all<any>(`SELECT * FROM AuditEvent ORDER BY createdAt DESC LIMIT 12`);
  const changedTransactions = all<any>(`SELECT * FROM TransactionRecord ORDER BY updatedAt DESC LIMIT 6`);

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="Operations summary across closings, tasks, and AI review activity"
        actions={<ResetSeedButton />}
      />

      <div className="grid grid-cols-2 gap-3 px-6 py-5 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile label="Tentative closings" value={tentativeClosings} tone="review" />
        <StatTile label="Confirmed closings" value={confirmedClosings} tone="confirmed" />
        <StatTile label="Reschedules" value={reschedules} />
        <StatTile label="New task requests" value={openTasks} />
        <StatTile label="Waiting on outside party" value={waitingTasks} />
        <StatTile label="Review queue" value={reviewCount} tone={reviewCount > 0 ? "review" : "neutral"} />
      </div>

      <div className="grid grid-cols-1 gap-4 px-6 pb-8 lg:grid-cols-3">
        <Panel title="Review queue" className="lg:col-span-1">
          {reviewCount === 0 ? (
            <EmptyState message="Nothing pending review." />
          ) : (
            <div className="px-4 py-4 text-[13px]">
              <p className="text-ink-muted">
                <span className="font-semibold text-review">{reviewCount}</span> item{reviewCount === 1 ? "" : "s"}{" "}
                awaiting approval.
              </p>
              <Link href="/review" className="mt-2 inline-block text-[12px] font-semibold text-info underline">
                Open review queue →
              </Link>
            </div>
          )}
        </Panel>

        <Panel title="Integration status" className="lg:col-span-1">
          <div className="divide-y divide-line">
            {emailAccounts.map((acct) => (
              <div key={acct.id} className="flex items-center justify-between px-4 py-2.5 text-[13px]">
                <div>
                  <div className="font-medium text-ink">{acct.emailAddress}</div>
                  <div className="text-[11px] text-ink-muted">Provider: {acct.providerType} (mock)</div>
                </div>
                <StatusChip status={acct.connected ? "CONFIRMED" : "CANCELLED"} label={acct.connected ? "Connected" : "Disconnected"} />
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Recently changed transactions" className="lg:col-span-1">
          {changedTransactions.length === 0 ? (
            <EmptyState message="No transactions yet." />
          ) : (
            <div className="divide-y divide-line">
              {changedTransactions.map((t) => (
                <Link
                  key={t.id}
                  href={`/transactions/${t.id}`}
                  className="flex items-center justify-between px-4 py-2.5 text-[13px] hover:bg-paper"
                >
                  <div>
                    <div className="font-mono-data text-[11px] text-ink-muted">{t.id.slice(0, 8)}</div>
                    <div className="text-ink-muted">{formatRelative(t.updatedAt)}</div>
                  </div>
                  <StatusChip status={t.status} />
                </Link>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <div className="px-6 pb-10">
        <Panel title="Recent AI activity">
          {recentActivity.length === 0 ? (
            <EmptyState message="No AI activity yet." />
          ) : (
            <div className="divide-y divide-line">
              {recentActivity.map((ev) => (
                <div key={ev.id} className="flex items-start gap-3 px-4 py-2.5 text-[13px]">
                  <span
                    className={`mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
                      ev.actorType === "AI" ? "bg-info" : ev.actorType === "HUMAN" ? "bg-confirmed" : "bg-neutral"
                    }`}
                  />
                  <div className="flex-1">
                    <div className="text-ink">{ev.summary}</div>
                    <div className="text-[11px] text-ink-muted">
                      {titleCaseEnum(ev.eventType)} · {ev.actorType} · {formatDateTime(ev.createdAt)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
