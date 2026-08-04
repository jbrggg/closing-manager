import { all } from "@/lib/db";
import { ensureSeeded } from "@/lib/ensure-seeded";
import { PageHeader, Panel, EmptyState } from "@/components/ui/layout-primitives";
import { formatDateTime, titleCaseEnum } from "@/lib/format";
import { requirePageSession } from "@/lib/auth/guard";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "What The AI Did",
};

export const dynamic = "force-dynamic";

const EVENT_ICON: Record<string, string> = {
  email_processed: "✉",
  search_performed: "🔍",
  transaction_matched: "🔗",
  facts_extracted: "🧾",
  proposal_generated: "✨",
  human_decision: "✓",
  action_executed: "⚙",
  action_reversed: "↺",
  integration_failure: "⚠",
};

export default async function ActivityPage() {
  await requirePageSession();
  await ensureSeeded();
  const events = all<any>(`SELECT * FROM AuditEvent ORDER BY createdAt DESC LIMIT 300`);

  return (
    <div>
      <PageHeader title="AI Activity Log" subtitle="Append-only record of every step the AI took, plus resulting human decisions" />
      <div className="px-6 py-6">
        <Panel>
          {events.length === 0 ? (
            <EmptyState message="No activity recorded yet." />
          ) : (
            <div className="divide-y divide-line">
              {events.map((ev) => (
                <div key={ev.id} className="flex items-start gap-3 px-4 py-3 text-[1.0625rem]">
                  <span className="mt-0.5 text-[1.125rem]">{EVENT_ICON[ev.eventType] ?? "•"}</span>
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-ink">{titleCaseEnum(ev.eventType)}</span>
                      <span
                        className={`rounded-sm px-1.5 py-0.5 text-[0.875rem] font-semibold uppercase ${
                          ev.actorType === "AI"
                            ? "bg-info-bg text-info"
                            : ev.actorType === "HUMAN"
                            ? "bg-confirmed-bg text-confirmed"
                            : "bg-neutral-bg text-neutral"
                        }`}
                      >
                        {ev.actorType}
                      </span>
                    </div>
                    <p className="mt-1 text-ink-muted">{ev.summary}</p>
                    <p className="mt-1 text-[0.9375rem] text-ink-muted">{formatDateTime(ev.createdAt)}</p>
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
