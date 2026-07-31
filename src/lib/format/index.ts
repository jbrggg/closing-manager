export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return String(iso);
  return dt.toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return String(iso);
  return dt.toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "—";
  const dt = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = dt - now;
  const diffMin = Math.round(diffMs / 60000);
  const abs = Math.abs(diffMin);
  if (abs < 60) return `${diffMin <= 0 ? abs + "m ago" : "in " + abs + "m"}`;
  const diffHr = Math.round(diffMin / 60);
  if (Math.abs(diffHr) < 24) return `${diffHr <= 0 ? Math.abs(diffHr) + "h ago" : "in " + diffHr + "h"}`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay <= 0 ? Math.abs(diffDay) + "d ago" : "in " + diffDay + "d"}`;
}

export function displayFactValue(factType: string, value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "object") {
    const v = value as any;
    if (v.dayOfWeek) return capitalize(v.dayOfWeek);
    if (v.raw) return String(v.raw);
    return JSON.stringify(v);
  }
  return String(value);
}

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function titleCaseEnum(s: string): string {
  return s
    .toLowerCase()
    .split("_")
    .map(capitalize)
    .join(" ");
}
