import { ReactNode } from "react";

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border bg-surface px-6 py-5">
      <div>
        <h1 className="font-serif-head text-[20px] font-semibold text-ink">{title}</h1>
        {subtitle && <p className="mt-0.5 text-[13px] text-ink-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Panel({ title, children, className = "" }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-sm border border-border bg-surface ${className}`}>
      {title && (
        <div className="border-b border-border px-4 py-2.5 text-[12px] font-semibold uppercase tracking-wide text-ink-muted">
          {title}
        </div>
      )}
      <div>{children}</div>
    </div>
  );
}

export function StatTile({ label, value, tone = "neutral" }: { label: string; value: string | number; tone?: "neutral" | "review" | "danger" | "confirmed" }) {
  const toneClass =
    tone === "review" ? "text-review" : tone === "danger" ? "text-danger" : tone === "confirmed" ? "text-confirmed" : "text-ink";
  return (
    <div className="rounded-sm border border-border bg-surface px-4 py-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">{label}</div>
      <div className={`mt-1 font-serif-head text-[26px] font-semibold ${toneClass}`}>{value}</div>
    </div>
  );
}

export function EmptyState({ message }: { message: string }) {
  return <div className="px-4 py-10 text-center text-[13px] text-ink-muted">{message}</div>;
}
