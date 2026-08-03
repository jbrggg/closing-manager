"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { StatusChip, ConfidencePill } from "@/components/ui/status-chip";
import { EmptyState } from "@/components/ui/layout-primitives";
import { displayFactValue, formatDateTime, titleCaseEnum } from "@/lib/format";

/** Plain-English names for the tables a merge moves, for the preview panel. */
const LABELS: Record<string, string> = {
  ExtractedFact: "extracted fact",
  Task: "task",
  ClosingEvent: "closing",
  AIProposal: "AI proposal",
  ReviewItem: "review item",
  TransactionParticipant: "party",
};

export function ReviewQueue({ initialItems }: { initialItems: any[] }) {
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const [selectedId, setSelectedId] = useState<string | null>(initialItems[0]?.id ?? null);
  const [pending, startTransition] = useTransition();
  const [rejectReason, setRejectReason] = useState("");

  // Merge is deliberately two steps: ask what would happen, show it, then do
  // it. Filing an email under the wrong property is the worst mistake this app
  // can make, and merging two unrelated files is that mistake at scale.
  const [mergePreview, setMergePreview] = useState<any>(null);
  const [mergeTarget, setMergeTarget] = useState<string | null>(null);
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [mergeDone, setMergeDone] = useState<string | null>(null);

  const selected = useMemo(() => items.find((i) => i.id === selectedId) ?? null, [items, selectedId]);

  function askAboutMerge(duplicateId: string) {
    if (!selected) return;
    setMergeError(null);
    setMergeDone(null);
    setMergeTarget(duplicateId);
    startTransition(async () => {
      const res = await fetch(`/api/v1/transactions/${selected.transactionId}/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secondaryTransactionId: duplicateId, dryRun: true }),
      });
      const json = await res.json();
      if (!res.ok) {
        setMergeError(json.error ?? "Could not work out what merging would do.");
        setMergePreview(null);
        return;
      }
      setMergePreview(json.preview);
    });
  }

  function confirmMerge() {
    if (!selected || !mergeTarget) return;
    startTransition(async () => {
      const res = await fetch(`/api/v1/transactions/${selected.transactionId}/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          secondaryTransactionId: mergeTarget,
          explanation: "Merged from the review queue after comparing both files.",
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setMergeError(json.error ?? "The merge did not go through.");
        return;
      }
      setMergePreview(null);
      setMergeTarget(null);
      setMergeDone(
        `Merged. ${json.movedRows} record(s) moved onto this file` +
          (json.supersededFactIds?.length
            ? `, and ${json.supersededFactIds.length} duplicate or conflicting fact(s) were kept as history rather than deleted.`
            : ".")
      );
      router.refresh();
    });
  }

  function cancelMerge() {
    setMergePreview(null);
    setMergeTarget(null);
    setMergeError(null);
  }

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
            className={`block w-full border-b border-line px-4 py-3 text-left text-[1.0625rem] ${
              it.id === selectedId ? "bg-paper" : "hover:bg-paper"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-ink">{titleCaseEnum(it.proposalType)}</span>
              <ConfidencePill value={it.confidence} />
            </div>
            <div className="mt-0.5 text-[0.9375rem] text-ink-muted">{it.propertyAddress}</div>
            <div className="mt-1 line-clamp-2 text-[0.9375rem] text-ink-muted">{it.reason}</div>
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
                  <h2 className="font-serif-head text-[1.25rem] font-semibold text-ink">{titleCaseEnum(selected.proposalType)}</h2>
                  <StatusChip status="PENDING" />
                </div>
                <p className="mt-2 text-[1.0625rem] text-ink-muted">{selected.reason}</p>
                {selected.transactionId && (
                  <Link href={`/transactions/${selected.transactionId}`} className="mt-2 inline-block text-[1rem] text-info underline">
                    View related transaction →
                  </Link>
                )}
              </div>

              <div className="rounded-sm border border-border bg-surface p-4">
                <h3 className="text-[1rem] font-semibold uppercase tracking-wide text-ink-muted">Proposed values</h3>
                <dl className="mt-2 space-y-1.5 text-[1.0625rem]">
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
                <h3 className="text-[1rem] font-semibold uppercase tracking-wide text-ink-muted">Confidence breakdown</h3>
                <dl className="mt-2 space-y-1.5 text-[1.0625rem]">
                  {Object.entries(selected.fieldConfidence).map(([key, value]) => (
                    <div key={key} className="flex items-center justify-between gap-3">
                      <dt className="text-ink-muted">{titleCaseEnum(key)}</dt>
                      <dd><ConfidencePill value={value as number} /></dd>
                    </div>
                  ))}
                </dl>
              </div>

              {selected.reviewType === "address_only_link" && (
                <div className="rounded-sm border border-danger bg-review-bg p-4">
                  <h3 className="text-[1rem] font-semibold uppercase tracking-wide text-danger">
                    Filed here on the address alone — file number missing
                  </h3>
                  <p className="mt-1 text-[1rem] text-ink">
                    The property address matches this file and nothing else does. The email is already on
                    this file so the work is not lost, but that is weaker evidence than we normally accept:
                    the same property can genuinely have more than one deal over time, such as a sale and a
                    later refinance.
                  </p>
                  <ul className="mt-2 list-disc space-y-1 pl-4 text-[1rem] text-ink">
                    <li>
                      <span className="font-semibold">Approve</span> if it belongs here — then add the file
                      number to this file so the next email links on its own.
                    </li>
                    <li>
                      <span className="font-semibold">Reject</span> if it is a different deal — the email&apos;s
                      details are moved back off this file onto one of their own. Nothing is deleted.
                    </li>
                  </ul>
                </div>
              )}

              {selected.duplicateTxns?.length > 0 && (
                <div className="rounded-sm border border-review bg-review-bg p-4">
                  <h3 className="text-[1rem] font-semibold uppercase tracking-wide text-review">Possible duplicate transaction</h3>
                  <p className="mt-1 text-[1rem] text-ink">
                    A similar signal matched an existing file, but the evidence was too weak to link them
                    automatically. Compare both before deciding — the same property can genuinely have more
                    than one deal over time.
                  </p>

                  {selected.duplicateTxns.map((d: any) => (
                    <div key={d.id} className="mt-2 flex flex-wrap items-center gap-3">
                      <Link href={`/transactions/${d.id}`} className="text-[1rem] text-info underline">
                        Compare with file {d.id.slice(0, 8)} ({titleCaseEnum(d.status)}) →
                      </Link>
                      {d.status !== "MERGED" && (
                        <button
                          type="button"
                          onClick={() => askAboutMerge(d.id)}
                          disabled={pending}
                          className="rounded-sm border border-review px-2 py-1 text-[0.9375rem] font-medium text-review hover:bg-review hover:text-white disabled:opacity-50"
                        >
                          These are the same file — merge
                        </button>
                      )}
                    </div>
                  ))}

                  {mergeError && <p className="mt-3 text-[1rem] text-danger">{mergeError}</p>}
                  {mergeDone && <p className="mt-3 text-[1rem] text-ink">{mergeDone}</p>}

                  {mergePreview && (
                    <div className="mt-3 rounded-sm border border-line bg-paper p-3">
                      <h4 className="text-[1rem] font-semibold text-ink">Before you merge — here is exactly what happens</h4>

                      <ul className="mt-2 list-disc space-y-1 pl-4 text-[1rem] text-ink">
                        {Object.entries(mergePreview.moves as Record<string, number>)
                          .filter(([, n]) => n > 0)
                          .map(([table, n]) => (
                            <li key={table}>
                              {n} {LABELS[table] ?? table}
                              {n === 1 ? "" : "s"} move onto this file
                            </li>
                          ))}
                        {Object.values(mergePreview.moves as Record<string, number>).every((n) => n === 0) && (
                          <li>Nothing to move — the other file has no records on it yet.</li>
                        )}
                        <li>The other file is kept and marked merged. Nothing is deleted.</li>
                        <li>You can undo this afterwards.</li>
                      </ul>

                      {mergePreview.conflicts?.length > 0 && (
                        <div className="mt-3">
                          <p className="text-[1rem] font-semibold text-ink">
                            These details disagree. This file&apos;s version wins; the other is kept as history:
                          </p>
                          <ul className="mt-1 list-disc space-y-1 pl-4 text-[1rem] text-ink-muted">
                            {mergePreview.conflicts.map((c: any) => (
                              <li key={c.factType}>
                                <span className="text-ink">{titleCaseEnum(c.factType)}</span>: keeping{" "}
                                <span className="text-ink">{displayFactValue(c.factType, c.keptValue)}</span>, superseding{" "}
                                {displayFactValue(c.factType, c.supersededValue)}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {mergePreview.warnings?.map((w: string) => (
                        <p key={w} className="mt-3 rounded-sm border border-danger bg-review-bg p-2 text-[1rem] text-danger">
                          {w}
                        </p>
                      ))}

                      <div className="mt-3 flex gap-2">
                        <button
                          type="button"
                          onClick={confirmMerge}
                          disabled={pending}
                          className="rounded-sm bg-review px-3 py-1.5 text-[1rem] font-medium text-white disabled:opacity-50"
                        >
                          {pending ? "Merging…" : "Yes, merge them"}
                        </button>
                        <button
                          type="button"
                          onClick={cancelMerge}
                          disabled={pending}
                          className="rounded-sm border border-border px-3 py-1.5 text-[1rem] text-ink disabled:opacity-50"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-4">
              <div className="rounded-sm border border-border bg-surface p-4">
                <h3 className="text-[1rem] font-semibold uppercase tracking-wide text-ink-muted">Supporting email</h3>
                <div className="mt-2 space-y-3">
                  {selected.sourceEmails.map((m: any) => (
                    <div key={m.id} className="rounded-sm border border-line bg-paper p-3 text-[1rem]">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-ink">{m.subject}</span>
                        <span className="text-[0.9375rem] text-ink-muted">{formatDateTime(m.sentAt)}</span>
                      </div>
                      <div className="mt-1 text-[0.9375rem] text-ink-muted">
                        {m.direction === "INCOMING" ? `From ${m.fromAddress}` : `To ${JSON.parse(m.toAddresses).join(", ")}`}
                      </div>
                      <p className="mt-2 whitespace-pre-wrap text-ink">{m.bodyText}</p>
                      <Link href={`/email/${m.id}`} className="mt-2 inline-block text-[0.9375rem] text-info underline">
                        Open full thread →
                      </Link>
                    </div>
                  ))}
                </div>
              </div>

              {/* THE most-used control in the application. Nothing on the page
                  should be easier to find or harder to mis-click. Stacked
                  rather than side by side so a slip cannot turn a rejection
                  into an approval. */}
              <div className="rounded-lg border-2 border-border bg-surface p-6">
                <h3 className="mb-4 text-[1.25rem] font-bold text-ink">Your decision</h3>
                <div className="flex flex-col gap-3">
                  <button
                    disabled={pending}
                    onClick={() => decide("approve")}
                    className="w-full rounded-lg bg-confirmed px-5 py-4 text-[1.25rem] font-bold text-white hover:bg-brand-hover disabled:opacity-50"
                  >
                    {pending ? "Working…" : "Approve — do this"}
                  </button>
                  <button
                    disabled={pending}
                    onClick={() => decide("reject")}
                    className="w-full rounded-lg border-2 border-danger bg-surface px-5 py-4 text-[1.25rem] font-bold text-danger hover:bg-danger-bg disabled:opacity-50"
                  >
                    Reject — the AI got this wrong
                  </button>
                </div>
                <label className="mt-5 block">
                  <span className="text-[1.0625rem] font-semibold text-ink">
                    If you are rejecting, what did it get wrong? (optional)
                  </span>
                  <textarea
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="For example: this is a different property on the same street."
                    className="mt-2 w-full rounded-lg border-2 border-border bg-paper p-4 text-[1.0625rem] text-ink placeholder:text-ink-muted"
                    rows={3}
                  />
                </label>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
