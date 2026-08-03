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

// Each tone carries a border as well as a fill. Colour alone is not a signal —
// roughly one man in twelve cannot separate the green chip from the amber one,
// and every chip also spells out its status in words for the same reason.
const TONE_CLASSES: Record<Tone, string> = {
  confirmed: "bg-confirmed-bg text-confirmed border-confirmed",
  tentative: "bg-tentative-bg text-tentative border-tentative",
  review: "bg-review-bg text-review border-review",
  danger: "bg-danger-bg text-danger border-danger",
  info: "bg-info-bg text-info border-info",
  neutral: "bg-neutral-bg text-neutral border-neutral",
};

export function StatusChip({ status, label }: { status: string; label?: string }) {
  const tone = STATUS_TONE[status] ?? "neutral";
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-3 py-1 text-[0.9375rem] font-bold ${TONE_CLASSES[tone]}`}
    >
      {label ?? titleCaseEnum(status)}
    </span>
  );
}

export function ConfidencePill({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const tone: Tone = pct >= 80 ? "confirmed" : pct >= 55 ? "tentative" : "danger";
  // The word matters more than the number to someone who does not think in
  // percentages, so say both.
  const word = pct >= 80 ? "Sure" : pct >= 55 ? "Fairly sure" : "Unsure";
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 py-1 text-[0.9375rem] font-semibold ${TONE_CLASSES[tone]}`}
      title={`The AI was ${pct}% confident about this`}
    >
      <span>{word}</span>
      <span className="font-mono-data opacity-80">{pct}%</span>
    </span>
  );
}
