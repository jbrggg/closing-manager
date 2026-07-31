"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { StatusChip } from "@/components/ui/status-chip";
import { titleCaseEnum } from "@/lib/format";

interface Rule {
  id: string;
  actionType: string;
  enabled: number;
  minConfidence: number;
}

export function AutomationRules({ initialRules }: { initialRules: Rule[] }) {
  const router = useRouter();
  const [rules, setRules] = useState(initialRules);
  const [pending, startTransition] = useTransition();

  const anyEnabled = rules.some((r) => r.enabled);

  function update(actionType: string, patch: { enabled?: boolean; minConfidence?: number }) {
    startTransition(async () => {
      const res = await fetch("/api/v1/settings/automation", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actionType, ...patch }),
      });
      if (res.ok) {
        const { rule } = await res.json();
        setRules((prev) => prev.map((r) => (r.actionType === actionType ? rule : r)));
        router.refresh();
      }
    });
  }

  return (
    <div>
      <div className="border-b border-border px-4 py-3 text-[13px]">
        <div className="flex items-center gap-2">
          <StatusChip
            status={anyEnabled ? "TENTATIVE" : "PENDING"}
            label={anyEnabled ? "Phase 2 — Selective automation" : "Phase 1 — Approval only"}
          />
        </div>
        <p className="mt-2 text-ink-muted">
          {anyEnabled
            ? "At least one action type will now be applied automatically when the AI's confidence clears its threshold — with no human in the loop for that action. Every auto-approval is still written to the audit trail and labeled as rule-triggered."
            : "Every AI proposal is routed to the review queue. Nothing becomes a live record without a human decision. Enable a rule below to activate Phase 2 automation for that action type."}
        </p>
      </div>

      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-border bg-paper text-left text-[11px] uppercase tracking-wide text-ink-muted">
            <th className="px-4 py-2 font-medium">Action type</th>
            <th className="px-4 py-2 font-medium">Min confidence</th>
            <th className="px-4 py-2 font-medium text-right">Automation</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rules.map((r) => (
            <tr key={r.id}>
              <td className="px-4 py-2.5 font-medium text-ink">{titleCaseEnum(r.actionType)}</td>
              <td className="px-4 py-2.5">
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.01}
                  defaultValue={r.minConfidence}
                  disabled={pending}
                  onBlur={(e) => {
                    const v = Number(e.target.value);
                    if (!Number.isNaN(v) && v !== r.minConfidence) update(r.actionType, { minConfidence: v });
                  }}
                  className="w-20 rounded-sm border border-border bg-paper px-2 py-1 font-mono-data text-[12px]"
                />
              </td>
              <td className="px-4 py-2.5 text-right">
                <button
                  disabled={pending}
                  onClick={() => update(r.actionType, { enabled: !r.enabled })}
                  className={`rounded-sm border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide disabled:opacity-50 ${
                    r.enabled
                      ? "border-tentative bg-tentative-bg text-tentative"
                      : "border-border bg-surface text-ink-muted hover:text-ink"
                  }`}
                >
                  {r.enabled ? "Enabled" : "Disabled"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
