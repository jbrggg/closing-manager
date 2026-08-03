"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { StatusChip, ConfidencePill } from "@/components/ui/status-chip";
import { EmptyState } from "@/components/ui/layout-primitives";
import { formatDateTime } from "@/lib/format";

type Filter = "ALL" | "OPEN" | "WAITING" | "OVERDUE" | "COMPLETED";

export function TaskTable({ tasks }: { tasks: any[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [filter, setFilter] = useState<Filter>("ALL");

  const filtered = tasks.filter((t) => {
    if (filter === "ALL") return true;
    if (filter === "WAITING") return t.status === "WAITING_INTERNALLY" || t.status === "WAITING_EXTERNALLY";
    if (filter === "OPEN") return t.status === "OPEN" || t.status === "IN_PROGRESS";
    if (filter === "OVERDUE") return t.dueAt && new Date(t.dueAt) < new Date() && t.status !== "COMPLETED";
    if (filter === "COMPLETED") return t.status === "COMPLETED";
    return true;
  });

  function act(taskId: string, action: "complete" | "reopen") {
    startTransition(async () => {
      await fetch(`/api/v1/tasks/${taskId}/${action}`, { method: "POST" });
      router.refresh();
    });
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {(["ALL", "OPEN", "WAITING", "OVERDUE", "COMPLETED"] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-sm border px-2.5 py-1 text-[0.9375rem] font-medium uppercase tracking-wide ${
              filter === f ? "border-ink bg-ink text-paper" : "border-border bg-surface text-ink-muted hover:text-ink"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-sm border border-border bg-surface">
        {filtered.length === 0 ? (
          <EmptyState message="No tasks match this filter." />
        ) : (
          <table className="w-full text-[1.0625rem]">
            <thead>
              <tr className="border-b border-border bg-paper text-left text-[0.9375rem] uppercase tracking-wide text-ink-muted">
                <th className="px-4 py-2.5 font-medium">Task</th>
                <th className="px-4 py-2.5 font-medium">Category</th>
                <th className="px-4 py-2.5 font-medium">Priority</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Due</th>
                <th className="px-4 py-2.5 font-medium">Confidence</th>
                <th className="px-4 py-2.5 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {filtered.map((t) => (
                <tr key={t.id} className="hover:bg-paper">
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-ink">{t.title}</div>
                    {t.propertyAddress && (
                      <Link href={`/transactions/${t.transactionId}`} className="text-[0.9375rem] text-info underline">
                        {t.propertyAddress}
                      </Link>
                    )}
                    {t.waitingCondition && (
                      <div className="mt-0.5 text-[0.9375rem] text-tentative">Waiting: {t.waitingCondition}</div>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-ink-muted">{t.category}</td>
                  <td className="px-4 py-2.5 text-ink-muted capitalize">{t.priority}</td>
                  <td className="px-4 py-2.5"><StatusChip status={t.status} /></td>
                  <td className="px-4 py-2.5 text-ink-muted">
                    {formatDateTime(t.dueAt)}
                    {Boolean(t.dueIsInferred) && <span className="ml-1 text-[0.875rem] text-tentative">(inferred)</span>}
                  </td>
                  <td className="px-4 py-2.5"><ConfidencePill value={t.confidence} /></td>
                  <td className="px-4 py-2.5 text-right">
                    {t.status === "COMPLETED" ? (
                      <button
                        disabled={pending}
                        onClick={() => act(t.id, "reopen")}
                        className="text-[0.9375rem] font-medium text-info underline disabled:opacity-50"
                      >
                        Reopen
                      </button>
                    ) : (
                      <button
                        disabled={pending}
                        onClick={() => act(t.id, "complete")}
                        className="text-[0.9375rem] font-medium text-confirmed underline disabled:opacity-50"
                      >
                        Mark complete
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
