// Configurable office defaults (spec: "these defaults should be configurable
// rather than hard-coded"). For the prototype these live as an in-memory
// config object; Settings UI reads/writes the same shape and a later
// iteration would persist this to the Organization/Office tables.

export const officeDefaults = {
  timezone: "America/New_York",
  statusUpdateDueHours: 4,
  urgentLenderDueHours: 1,
  closingTodayDueMinutes: 30,
  routineDocumentDueNextBusinessDay: true,
  businessHours: { start: "09:00", end: "17:00" },
};

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
  if (explicitDayName) {
    return { due: nextDateForDayName(explicitDayName, now), isInferred: false, label: `explicit: ${explicitDayName}` };
  }
  if (priority === "urgent") {
    return {
      due: addHours(now, officeDefaults.urgentLenderDueHours),
      isInferred: true,
      label: `office default: urgent request (${officeDefaults.urgentLenderDueHours}h)`,
    };
  }
  if (category === "Status update") {
    return {
      due: addHours(now, officeDefaults.statusUpdateDueHours),
      isInferred: true,
      label: `office default: status update (${officeDefaults.statusUpdateDueHours}h)`,
    };
  }
  const nextBizDay = new Date(now);
  nextBizDay.setDate(now.getDate() + 1);
  return { due: nextBizDay, isInferred: true, label: "office default: next business day" };
}
