"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { StatusChip, ConfidencePill } from "@/components/ui/status-chip";
import { EmptyState } from "@/components/ui/layout-primitives";
import { displayFactValue, formatDateTime, titleCaseEnum } from "@/lib/format";

export function ReviewQueue({ initialItems }: { initialItems: any[] }) {
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const [selectedId, setSelectedId] = useState<string | null>(initialItems[0]?.id ?? null);
  const [pending, startTransition] = useTransition();
  const [rejectReason, setRejectReason] = useState("");

  const selected = useMemo(() => items.find((i) => i.id === selectedId) ?? null, [items, selectedId]);

  function decide(action: "approve" | "reject") {
    if (!selected) return;
    startTransition(async () => {
      await fetch(`/api/v1/review-items/${selected.id}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "reject" ? { explanation: rejectReason || undefined } : {}),
      });
      const remaining = items.filter((i) => i.id !== selected.id);
      setItems(remaining);
      setSelectedId(remaining[0]?.id ?? null);
      setRejectReason("");
      router.refresh();
    });
  }

  if (items.length === 0) {
    return (
      <div className="flex-1 px-6 py-10">
        <EmptyState message="Review queue is empty — every AI proposal has been decided." />
      </div>
    );
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Left: queue list */}
      <div className="w-80 shrink-0 overflow-y-auto border-r border-border bg-surface scrollbar-thin">
        {items.map((it) => (
          <button
            key={it.id}
            onClick={() => setSelectedId(it.id)}
            className={`block w-full border-b border-line px-4 py-3 text-left text-[13px] ${
              it.id === selectedId ? "bg-paper" : "hover:bg-paper"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-ink">{titleCaseEnum(it.proposalType)}</span>
              <ConfidencePill value={it.confidence} />
            </div>
            <div className="mt-0.5 text-[11px] text-ink-muted">{it.propertyAddress}</div>
            <div className="mt-1 line-clamp-2 text-[11px] text-ink-muted">{it.reason}</div>
          </button>
        ))}
      </div>

      {/* Right: detail / decision panel */}
      {selected && (
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          <div className="grid grid-cols-1 gap-4 p-6 lg:grid-cols-2">
            <div className="space-y-4">
              <div className="rounded-sm border border-border bg-surface p-4">
                <div className="flex items-center justify-between">
                  <h2 className="font-serif-head text-[16px] font-semibold text-ink">{titleCaseEnum(selected.proposalType)}</h2>
                  <StatusChip status="PENDING" />
                </div>
                <p className="mt-2 text-[13px] text-ink-muted">{selected.reason}</p>
                {selected.transactionId && (
                  <Link href={`/transactions/${selected.transactionId}`} className="mt-2 inline-block text-[12px] text-info underline">
                    View related transaction →
                  </Link>
                )}
              </div>

              <div className="rounded-sm border border-border bg-surface p-4">
                <h3 className="text-[12px] font-semibold uppercase tracking-wide text-ink-muted">Proposed values</h3>
                <dl className="mt-2 space-y-1.5 text-[13px]">
                  {Object.entries(selected.payload).map(([key, value]) => (
                    <div key={key} className="flex items-center justify-between gap-3">
                      <dt className="text-ink-muted">{titleCaseEnum(key)}</dt>
                      <dd className="text-right font-medium text-ink">
                        {typeof value === "boolean" ? (value ? "Yes" : "No") : displayFactValue(key, value)}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>

              <div className="rounded-sm border border-border bg-surface p-4">
                <h3 className="text-[12px] font-semibold uppercase tracking-wide text-ink-muted">Confidence breakdown</h3>
                <dl className="mt-2 space-y-1.5 text-[13px]">
                  {Object.entries(selected.fieldConfidence).map(([key, value]) => (
                    <div key={key} className="flex items-center justify-between gap-3">
                      <dt className="text-ink-muted">{titleCaseEnum(key)}</dt>
                      <dd><ConfidencePill value={value as number} /></dd>
                    </div>
                  ))}
                </dl>
              </div>

              {selected.duplicateTxns?.length > 0 && (
                <div className="rounded-sm border border-review bg-review-bg p-4">
                  <h3 className="text-[12px] font-semibold uppercase tracking-wide text-review">Possible duplicate transaction</h3>
                  <p className="mt-1 text-[12px] text-ink">
                    A similar signal matched an existing transaction, but the evidence was too weak to auto-merge.
                  </p>
                  {selected.duplicateTxns.map((d: any) => (
                    <Link key={d.id} href={`/transactions/${d.id}`} className="mt-1 block text-[12px] text-info underline">
                      Compare with transaction {d.id.slice(0, 8)} ({titleCaseEnum(d.status)}) →
                    </Link>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-4">
              <div className="rounded-sm border border-border bg-surface p-4">
                <h3 className="text-[12px] font-semibold uppercase tracking-wide text-ink-muted">Supporting email</h3>
                <div className="mt-2 space-y-3">
                  {selected.sourceEmails.map((m: any) => (
                    <div key={m.id} className="rounded-sm border border-line bg-paper p-3 text-[12px]">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-ink">{m.subject}</span>
                        <span className="text-[11px] text-ink-muted">{formatDateTime(m.sentAt)}</span>
                      </div>
                      <div className="mt-1 text-[11px] text-ink-muted">
                        {m.direction === "INCOMING" ? `From ${m.fromAddress}` : `To ${JSON.parse(m.toAddresses).join(", ")}`}
                      </div>
                      <p className="mt-2 whitespace-pre-wrap text-ink">{m.bodyText}</p>
                      <Link href={`/email/${m.id}`} className="mt-2 inline-block text-[11px] text-info underline">
                        Open full thread →
                      </Link>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-sm border border-border bg-surface p-4">
                <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-muted">Decision</h3>
                <div className="flex gap-2">
                  <button
                    disabled={pending}
                    onClick={() => decide("approve")}
                    className="flex-1 rounded-sm bg-confirmed px-3 py-2 text-[13px] font-semibold text-white disabled:opacity-50"
                  >
                    Approve
                  </button>
                  <button
                    disabled={pending}
                    onClick={() => decide("reject")}
                    className="flex-1 rounded-sm border border-danger px-3 py-2 text-[13px] font-semibold text-danger disabled:opacity-50"
                  >
                    Reject
                  </button>
                </div>
                <textarea
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="Optional note if rejecting (e.g. why the AI got this wrong)…"
                  className="mt-2 w-full rounded-sm border border-border bg-paper p-2 text-[12px] text-ink placeholder:text-ink-muted"
                  rows={2}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
