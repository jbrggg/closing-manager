import { get, run, nowIso } from "@/lib/db";

// -----------------------------------------------------------------------------
// Office defaults — the rules that decide when a task is due when the email
// itself doesn't say (roadmap D2).
//
// These used to live in a module-level object that reset on every restart, so
// any change an admin made was silently lost. They are now stored in the
// OfficeSetting table and cached in memory for the life of the process.
//
// Why a key/value table rather than columns on Organization: these are policy
// knobs that get added and removed as the office learns what it wants, and a
// new knob shouldn't need a schema migration. Every value is validated on the
// way in, so a bad write can't produce a nonsensical due date.
// -----------------------------------------------------------------------------

export interface OfficeDefaults {
  timezone: string;
  statusUpdateDueHours: number;
  urgentLenderDueHours: number;
  closingTodayDueMinutes: number;
  routineDocumentDueNextBusinessDay: boolean;
  businessHours: { start: string; end: string };
}

const FALLBACK: OfficeDefaults = {
  timezone: "America/New_York",
  statusUpdateDueHours: 4,
  urgentLenderDueHours: 1,
  closingTodayDueMinutes: 30,
  routineDocumentDueNextBusinessDay: true,
  businessHours: { start: "09:00", end: "17:00" },
};

const ORG_ID = "org-demo";
const SETTING_KEY = "officeDefaults";

let cache: OfficeDefaults | null = null;

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Coerce whatever is stored (or submitted) into a sane OfficeDefaults.
 * Anything missing or out of range falls back rather than throwing — a
 * corrupted settings row must not take down task creation.
 */
export function normalizeOfficeDefaults(input: unknown): OfficeDefaults {
  const raw = (input ?? {}) as Partial<OfficeDefaults>;
  const positive = (v: unknown, fallback: number, max: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 && n <= max ? n : fallback;
  };
  const bh = (raw.businessHours ?? {}) as { start?: string; end?: string };

  return {
    timezone:
      typeof raw.timezone === "string" && raw.timezone.includes("/") ? raw.timezone : FALLBACK.timezone,
    statusUpdateDueHours: positive(raw.statusUpdateDueHours, FALLBACK.statusUpdateDueHours, 24 * 14),
    urgentLenderDueHours: positive(raw.urgentLenderDueHours, FALLBACK.urgentLenderDueHours, 24 * 14),
    closingTodayDueMinutes: positive(raw.closingTodayDueMinutes, FALLBACK.closingTodayDueMinutes, 60 * 24),
    routineDocumentDueNextBusinessDay:
      typeof raw.routineDocumentDueNextBusinessDay === "boolean"
        ? raw.routineDocumentDueNextBusinessDay
        : FALLBACK.routineDocumentDueNextBusinessDay,
    businessHours: {
      start: typeof bh.start === "string" && TIME_RE.test(bh.start) ? bh.start : FALLBACK.businessHours.start,
      end: typeof bh.end === "string" && TIME_RE.test(bh.end) ? bh.end : FALLBACK.businessHours.end,
    },
  };
}

/** Read the office defaults, loading them from the database on first use. */
export function getOfficeDefaults(): OfficeDefaults {
  if (cache) return cache;

  let stored: unknown = null;
  try {
    const row = get<{ value: string }>(
      `SELECT value FROM OfficeSetting WHERE organizationId = ? AND key = ?`,
      [ORG_ID, SETTING_KEY]
    );
    if (row) stored = JSON.parse(row.value);
  } catch {
    // Table missing or value unparseable — fall back rather than crash. The
    // next successful save repairs it.
    stored = null;
  }

  cache = normalizeOfficeDefaults(stored ?? FALLBACK);
  return cache;
}

/** Persist a partial update. Returns the full, validated result. */
export function saveOfficeDefaults(patch: Partial<OfficeDefaults>): OfficeDefaults {
  const current = getOfficeDefaults();
  const merged = normalizeOfficeDefaults({
    ...current,
    ...patch,
    businessHours: { ...current.businessHours, ...(patch.businessHours ?? {}) },
  });

  run(
    `INSERT INTO OfficeSetting (organizationId, key, value, updatedAt) VALUES (?, ?, ?, ?)
     ON CONFLICT(organizationId, key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt`,
    [ORG_ID, SETTING_KEY, JSON.stringify(merged), nowIso()]
  );

  cache = merged;
  return merged;
}

/** Drop the in-process cache. Tests and the demo reset use this. */
export function clearOfficeDefaultsCache(): void {
  cache = null;
}

/**
 * Read-only view kept so existing call sites compile unchanged.
 *
 * NOTE: assigning to this does nothing. Use `saveOfficeDefaults()` to change a
 * value — that is the whole point of D2. Reads go to the database-backed cache.
 */
export const officeDefaults = new Proxy({} as OfficeDefaults, {
  get: (_target, prop) => getOfficeDefaults()[prop as keyof OfficeDefaults],
  set: () => {
    throw new Error(
      "officeDefaults is read-only — call saveOfficeDefaults() so the change survives a restart."
    );
  },
  ownKeys: () => Reflect.ownKeys(getOfficeDefaults()),
  has: (_target, prop) => prop in getOfficeDefaults(),
  getOwnPropertyDescriptor: (_target, prop) => ({
    value: getOfficeDefaults()[prop as keyof OfficeDefaults],
    enumerable: true,
    configurable: true,
  }),
});

const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

export function nextDateForDayName(dayName: string, from = new Date()): Date {
  const target = DAY_NAMES.indexOf(dayName.toLowerCase());
  if (target === -1) return from;
  const result = new Date(from);
  const diff = (target - from.getDay() + 7) % 7 || 7;
  result.setDate(from.getDate() + diff);
  return result;
}

export function addHours(base: Date, hours: number): Date {
  return new Date(base.getTime() + hours * 60 * 60 * 1000);
}

export function inferTaskDueDate(
  category: string,
  priority: string,
  explicitDayName?: string,
  now = new Date()
): { due: Date; isInferred: boolean; label: string } {
  const defaults = getOfficeDefaults();

  if (explicitDayName) {
    return {
      due: nextDateForDayName(explicitDayName, now),
      isInferred: false,
      label: `explicit: ${explicitDayName}`,
    };
  }
  if (priority === "urgent") {
    return {
      due: addHours(now, defaults.urgentLenderDueHours),
      isInferred: true,
      label: `office default: urgent request (${defaults.urgentLenderDueHours}h)`,
    };
  }
  if (category === "Status update") {
    return {
      due: addHours(now, defaults.statusUpdateDueHours),
      isInferred: true,
      label: `office default: status update (${defaults.statusUpdateDueHours}h)`,
    };
  }
  const nextBizDay = new Date(now);
  nextBizDay.setDate(now.getDate() + 1);
  return { due: nextBizDay, isInferred: true, label: "office default: next business day" };
}
