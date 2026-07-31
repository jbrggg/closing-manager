import "./helpers/test-db";
import { describe, it, expect, beforeEach } from "vitest";
import { run } from "@/lib/db";
import {
  getOfficeDefaults,
  saveOfficeDefaults,
  clearOfficeDefaultsCache,
  normalizeOfficeDefaults,
  inferTaskDueDate,
} from "@/lib/services/office-rules";

// These settings decide when a task is due when the email doesn't say. They
// used to reset on every restart, so an admin's change was silently lost
// (roadmap D2). What matters now: changes stick, and a bad value can never
// produce a nonsensical due date.

beforeEach(() => {
  run(`DELETE FROM OfficeSetting`);
  clearOfficeDefaultsCache();
});

describe("persistence", () => {
  it("returns the shipped defaults when nothing has been saved", () => {
    const d = getOfficeDefaults();
    expect(d.statusUpdateDueHours).toBe(4);
    expect(d.urgentLenderDueHours).toBe(1);
    expect(d.businessHours).toEqual({ start: "09:00", end: "17:00" });
  });

  it("a saved change survives a restart", () => {
    saveOfficeDefaults({ statusUpdateDueHours: 8 });

    // Simulate the process restarting: the in-memory cache is gone, the
    // database is not.
    clearOfficeDefaultsCache();

    expect(getOfficeDefaults().statusUpdateDueHours).toBe(8);
  });

  it("a partial save leaves the other settings alone", () => {
    saveOfficeDefaults({ urgentLenderDueHours: 2 });
    clearOfficeDefaultsCache();

    const d = getOfficeDefaults();
    expect(d.urgentLenderDueHours).toBe(2);
    expect(d.statusUpdateDueHours).toBe(4); // untouched
  });

  it("merges business hours rather than replacing the whole object", () => {
    saveOfficeDefaults({ businessHours: { start: "08:30" } as never });
    clearOfficeDefaultsCache();

    expect(getOfficeDefaults().businessHours).toEqual({ start: "08:30", end: "17:00" });
  });

  it("saving twice keeps one row, not two", () => {
    saveOfficeDefaults({ statusUpdateDueHours: 6 });
    saveOfficeDefaults({ statusUpdateDueHours: 7 });
    clearOfficeDefaultsCache();
    expect(getOfficeDefaults().statusUpdateDueHours).toBe(7);
  });
});

describe("validation — a bad value must never reach a due date", () => {
  it("rejects zero, negative and non-numeric hours", () => {
    for (const bad of [0, -5, "soon", null, undefined, NaN]) {
      expect(normalizeOfficeDefaults({ statusUpdateDueHours: bad }).statusUpdateDueHours).toBe(4);
    }
  });

  it("rejects an absurdly large window", () => {
    expect(normalizeOfficeDefaults({ urgentLenderDueHours: 100000 }).urgentLenderDueHours).toBe(1);
  });

  it("rejects a malformed business-hours time", () => {
    const d = normalizeOfficeDefaults({ businessHours: { start: "9am", end: "25:00" } } as never);
    expect(d.businessHours).toEqual({ start: "09:00", end: "17:00" });
  });

  it("rejects a timezone that isn't an IANA name", () => {
    expect(normalizeOfficeDefaults({ timezone: "EST" }).timezone).toBe("America/New_York");
    expect(normalizeOfficeDefaults({ timezone: "America/Chicago" }).timezone).toBe("America/Chicago");
  });

  it("survives a corrupted row instead of taking task creation down", () => {
    run(`INSERT INTO OfficeSetting (organizationId, key, value, updatedAt) VALUES (?, ?, ?, ?)`, [
      "org-demo",
      "officeDefaults",
      "{ this is not json",
      new Date().toISOString(),
    ]);
    clearOfficeDefaultsCache();

    expect(getOfficeDefaults().statusUpdateDueHours).toBe(4);
  });
});

describe("the settings actually change behaviour", () => {
  it("an urgent task uses the saved window, not the shipped one", () => {
    const now = new Date("2026-07-30T09:00:00.000Z");
    expect(inferTaskDueDate("Other", "urgent", undefined, now).due.toISOString()).toBe(
      "2026-07-30T10:00:00.000Z"
    );

    saveOfficeDefaults({ urgentLenderDueHours: 3 });

    const result = inferTaskDueDate("Other", "urgent", undefined, now);
    expect(result.due.toISOString()).toBe("2026-07-30T12:00:00.000Z");
    expect(result.label).toContain("3h");
  });

  it("an explicit day in the email still beats any office default", () => {
    saveOfficeDefaults({ urgentLenderDueHours: 3 });
    const now = new Date("2026-07-30T09:00:00.000Z"); // a Thursday
    const result = inferTaskDueDate("Other", "urgent", "friday", now);

    expect(result.isInferred).toBe(false);
    expect(result.label).toBe("explicit: friday");
  });
});
