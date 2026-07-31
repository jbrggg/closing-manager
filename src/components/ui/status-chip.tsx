import { titleCaseEnum } from "@/lib/format";

type Tone = "confirmed" | "tentative" | "review" | "danger" | "info" | "neutral";

const STATUS_TONE: Record<string, Tone> = {
  // Transaction / closing statuses
  POTENTIAL: "neutral",
  SCHEDULING: "info",
  TENTATIVE: "tentative",
  CONFIRMED: "confirmed",
  RESCHEDULED: "tentative",
  CANCELLED: "danger",
  COMPLETED: "confirmed",
  ARCHIVED: "neutral",
  NEEDS_REVIEW: "review",
  PROPOSED: "review",
  // Task statuses
  OPEN: "info",
  IN_PROGRESS: "info",
  WAITING_INTERNALLY: "tentative",
  WAITING_EXTERNALLY: "tentative",
  OVERDUE: "danger",
  // Review / proposal statuses
  PENDING: "review",
  APPROVED: "confirmed",
  REJECTED: "danger",
  HUMAN_APPROVED: "confirmed",
  HUMAN_REJECTED: "danger",
  AUTO_APPROVED: "confirmed",
  FAILED: "danger",
};

const TONE_CLASSES: Record<Tone, string> = {
  confirmed: "bg-confirmed-bg text-confirmed",
  tentative: "bg-tentative-bg text-tentative",
  review: "bg-review-bg text-review",
  danger: "bg-danger-bg text-danger",
  info: "bg-info-bg text-info",
  neutral: "bg-neutral-bg text-neutral",
};

export function StatusChip({ status, label }: { status: string; label?: string }) {
  const tone = STATUS_TONE[status] ?? "neutral";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-sm px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${TONE_CLASSES[tone]}`}
    >
      {label ?? titleCaseEnum(status)}
    </span>
  );
}

export function ConfidencePill({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const tone: Tone = pct >= 80 ? "confirmed" : pct >= 55 ? "tentative" : "danger";
  return (
    <span
      className={`inline-flex items-center rounded-sm px-1.5 py-0.5 text-[11px] font-mono-data font-medium ${TONE_CLASSES[tone]}`}
      title={`${pct}% confidence`}
    >
      {pct}%
    </span>
  );
}
