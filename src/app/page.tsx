import Link from "next/link";
import { all, get } from "@/lib/db";
import { ensureSeeded } from "@/lib/ensure-seeded";
import { PageHeader, Panel, StatTile, EmptyState, ActionLink } from "@/components/ui/layout-primitives";
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

  // A title office thinks in property addresses, never in record ids. This
  // list used to read "e4ef9b12" — technically true and completely useless.
  // Pull the address across so each row says what it is about, and fall back
  // to the file number before ever showing an id.
  const changedTransactions = all<any>(
    `SELECT t.id, t.status, t.updatedAt, t.fileNumber, p.rawAddress
       FROM TransactionRecord t
       LEFT JOIN Property p ON p.id = t.propertyId
      ORDER BY t.updatedAt DESC
      LIMIT 6`
  );

  function transactionLabel(t: { rawAddress?: string | null; fileNumber?: string | null }) {
    if (t.rawAddress) return t.rawAddress;
    if (t.fileNumber) return `File ${t.fileNumber}`;
    return "Address not identified yet";
  }

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="Everything that needs your attention today"
        actions={<ResetSeedButton />}
      />

      {/* Tiles are links. A number you can see but not follow is a dead end. */}
      <div className="grid grid-cols-1 gap-4 px-8 py-7 sm:grid-cols-2 xl:grid-cols-3">
        <StatTile
          label="Waiting for you to review"
          value={reviewCount}
          tone={reviewCount > 0 ? "review" : "neutral"}
          href="/review"
          hint={reviewCount > 0 ? "The AI cannot act until you decide" : "Nothing pending — you are caught up"}
        />
        <StatTile
          label="Closings not yet confirmed"
          value={tentativeClosings}
          tone={tentativeClosings > 0 ? "tentative" : "neutral"}
          href="/board"
          hint={tentativeClosings > 0 ? "Missing a date, a time, or a place" : "All closings are confirmed"}
        />
        <StatTile
          label="Closings confirmed"
          value={confirmedClosings}
          tone={confirmedClosings > 0 ? "confirmed" : "neutral"}
          href="/board"
          hint="Date, time and place all agreed"
        />
        <StatTile
          label="New tasks to pick up"
          value={openTasks}
          tone={openTasks > 0 ? "info" : "neutral"}
          href="/tasks"
          hint="Nobody has started these yet"
        />
        <StatTile
          label="Waiting on someone outside"
          value={waitingTasks}
          tone="neutral"
          href="/tasks"
          hint="Lender, underwriter, broker or buyer"
        />
        <StatTile
          label="Closings moved"
          value={reschedules}
          tone={reschedules > 0 ? "tentative" : "neutral"}
          href="/board"
          hint="Rescheduled from their original date"
        />
      </div>

      <div className="grid grid-cols-1 gap-5 px-8 pb-8 xl:grid-cols-2">
        <Panel title="Your mailbox">
          <div className="divide-y-2 divide-line">
            {emailAccounts.map((acct) => (
              <div key={acct.id} className="px-6 py-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="text-[1.125rem] font-semibold text-ink">{acct.emailAddress}</div>
                  <StatusChip
                    status={acct.lastSyncError ? "CANCELLED" : acct.connected ? "CONFIRMED" : "CANCELLED"}
                    label={acct.lastSyncError ? "Needs attention" : acct.connected ? "Connected" : "Disconnected"}
                  />
                </div>
                <div className="mt-1.5 text-[1.0625rem] text-ink-muted">
                  {acct.providerType === "MOCK"
                    ? "Practice data — your real mailbox is not connected yet"
                    : `Provider: ${acct.providerType}`}
                </div>

                {/* Sync health. A scheduled sync that quietly stopped running
                    looks exactly like a quiet mailbox, so "when did it last
                    finish" has to be visible even when nothing new arrived. */}
                {acct.lastSyncError ? (
                  <p className="mt-4 rounded-lg border-2 border-danger bg-danger-bg p-4 text-[1.0625rem] font-medium text-danger">
                    The last check for new mail failed: {acct.lastSyncError}
                  </p>
                ) : acct.lastSyncFinishedAt ? (
                  <p className="mt-4 text-[1.0625rem] text-ink-muted">
                    Last checked {formatRelative(acct.lastSyncFinishedAt)}
                    {acct.lastSyncSummary ? ` — ${acct.lastSyncSummary}` : ""}
                  </p>
                ) : acct.providerType !== "MOCK" ? (
                  <p className="mt-4 text-[1.0625rem] text-ink-muted">Has not checked for mail yet.</p>
                ) : null}
              </div>
            ))}
            {emailAccounts.length === 0 && <EmptyState message="No mailbox connected yet." />}
          </div>
        </Panel>

        <Panel title="Files changed recently">
          {changedTransactions.length === 0 ? (
            <EmptyState message="No files yet." />
          ) : (
            <div className="divide-y-2 divide-line">
              {changedTransactions.map((t) => (
                <Link
                  key={t.id}
                  href={`/transactions/${t.id}`}
                  className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 hover:bg-brand-soft"
                >
                  <div className="min-w-0">
                    <div className="text-[1.125rem] font-semibold text-ink">{transactionLabel(t)}</div>
                    <div className="text-[1rem] text-ink-muted">
                      {t.fileNumber && t.rawAddress ? `File ${t.fileNumber} · ` : ""}
                      Updated {formatRelative(t.updatedAt)}
                    </div>
                  </div>
                  <StatusChip status={t.status} />
                </Link>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <div className="px-8 pb-12">
        <Panel title="What the AI did recently">
          {recentActivity.length === 0 ? (
            <EmptyState message="The AI has not done anything yet." />
          ) : (
            <>
              <div className="divide-y-2 divide-line">
                {recentActivity.map((ev) => (
                  <div key={ev.id} className="flex items-start gap-4 px-6 py-4">
                    {/* Who acted, said in a word rather than a coloured dot. */}
                    <span
                      className={`mt-0.5 shrink-0 rounded-md border px-2.5 py-1 text-[0.875rem] font-bold ${
                        ev.actorType === "AI"
                          ? "border-info bg-info-bg text-info"
                          : ev.actorType === "HUMAN"
                            ? "border-confirmed bg-confirmed-bg text-confirmed"
                            : "border-neutral bg-neutral-bg text-neutral"
                      }`}
                    >
                      {ev.actorType === "AI" ? "AI" : ev.actorType === "HUMAN" ? "You" : "System"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[1.0625rem] text-ink">{ev.summary}</div>
                      <div className="text-[1rem] text-ink-muted">
                        {titleCaseEnum(ev.eventType)} · {formatDateTime(ev.createdAt)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="border-t-2 border-line px-6 py-4">
                <ActionLink href="/activity">See the full history →</ActionLink>
              </div>
            </>
          )}
        </Panel>
      </div>
    </div>
  );
}
