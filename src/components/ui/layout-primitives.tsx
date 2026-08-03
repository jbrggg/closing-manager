import Link from "next/link";
import { ReactNode } from "react";

/* ---------------------------------------------------------------------------
   SHARED LAYOUT PIECES

   Rebuilt 2026-08-03 alongside the tokens in globals.css. Sizes here are in
   rem so they follow the single font-size on <html>. If the whole app needs
   to get bigger, change that one number — not these.
--------------------------------------------------------------------------- */

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
    <div className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-border bg-surface px-8 py-7">
      <div>
        <h1 className="font-serif-head text-[2rem] font-bold leading-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-1.5 text-[1.0625rem] text-ink-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-3">{actions}</div>}
    </div>
  );
}

export function Panel({
  title,
  children,
  className = "",
}: {
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`overflow-hidden rounded-lg border-2 border-border bg-surface ${className}`}>
      {title && (
        // Was 12px uppercase grey. A heading you have to squint at is not a
        // heading. Now full size, dark, on a tinted band so the eye can find
        // the top of each section instantly.
        <div className="border-b-2 border-border bg-surface-sunken px-6 py-4 text-[1.125rem] font-bold text-ink">
          {title}
        </div>
      )}
      <div>{children}</div>
    </div>
  );
}

type Tone = "neutral" | "review" | "danger" | "confirmed" | "tentative" | "info";

const TILE_TONE: Record<Tone, { face: string; value: string; label: string }> = {
  // A tile only shouts when it has something in it. That is what makes a full
  // review queue jump off the page while an empty one stays quiet.
  neutral: { face: "border-border bg-surface", value: "text-ink", label: "text-ink-muted" },
  confirmed: { face: "border-confirmed bg-confirmed-bg", value: "text-confirmed", label: "text-confirmed" },
  tentative: { face: "border-tentative bg-tentative-bg", value: "text-tentative", label: "text-tentative" },
  review: { face: "border-review bg-review-bg", value: "text-review", label: "text-review" },
  danger: { face: "border-danger bg-danger-bg", value: "text-danger", label: "text-danger" },
  info: { face: "border-info bg-info-bg", value: "text-info", label: "text-info" },
};

export function StatTile({
  label,
  value,
  tone = "neutral",
  href,
  hint,
}: {
  label: string;
  value: string | number;
  tone?: Tone;
  /** Makes the whole tile a link. A big number nobody can click is a tease. */
  href?: string;
  /** One short line under the number, e.g. "3 due today". */
  hint?: string;
}) {
  const t = TILE_TONE[tone];
  const body = (
    <>
      <div className={`text-[1.0625rem] font-semibold leading-snug ${t.label}`}>{label}</div>
      <div className={`mt-2 font-serif-head text-[3rem] font-bold leading-none ${t.value}`}>{value}</div>
      {hint && <div className={`mt-2 text-[0.9375rem] ${t.label}`}>{hint}</div>}
    </>
  );

  const face = `block rounded-lg border-2 px-6 py-5 ${t.face}`;

  if (href) {
    return (
      <Link href={href} className={`${face} transition-shadow hover:shadow-md focus-visible:shadow-md`}>
        {body}
      </Link>
    );
  }
  return <div className={face}>{body}</div>;
}

export function EmptyState({ message }: { message: string }) {
  return <div className="px-6 py-14 text-center text-[1.0625rem] text-ink-muted">{message}</div>;
}

/**
 * A plain, obvious text link. Underlined on purpose: a link that is only a
 * different colour is invisible to a colour-blind reader and easy for
 * everyone else to miss.
 */
export function ActionLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-[2.6rem] items-center text-[1.0625rem] font-semibold text-info underline underline-offset-4 hover:text-brand"
    >
      {children}
    </Link>
  );
}
