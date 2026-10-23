import { describe, expect, it } from "vitest";
import { createTranslator } from "../../i18n/i18n";
import { frequencyLabel, nextLabel, weekdays } from "./schedule-time";
import type { ScheduleInput } from "./schedules-api";

const zh = createTranslator("zh");
const en = createTranslator("en");
const item: ScheduleInput = {
  title: "Digest",
  prompt: "Find papers",
  workspace_id: "project",
  destination: "new",
  research_id: null,
  frequency: "daily",
  local_time: "09:00",
  weekday: 0,
  interval_hours: 4,
  timezone: "Asia/Singapore",
  paused: false,
};

describe("schedule labels", () => {
  it("formats all three recurrences in both languages", () => {
    expect(frequencyLabel(item, zh)).toBe("每天 09:00");
    expect(frequencyLabel({ ...item, frequency: "weekly" }, zh)).toBe(
      "每星期一 09:00",
    );
    expect(frequencyLabel({ ...item, frequency: "interval" }, en)).toBe(
      "Every 4 hours",
    );
    expect(weekdays("en")[6]).toBe("Sunday");
  });
  it("uses the saved local zone across UTC date boundaries", () => {
    const now = new Date("2026-10-22T18:00:00Z");
    expect(nextLabel("2026-10-23T01:00:00Z", item.timezone, en, now)).toBe(
      "Today 09:00",
    );
    expect(nextLabel("2026-10-24T01:00:00Z", item.timezone, zh, now)).toBe(
      "明天 09:00",
    );
  });
  it("keeps tomorrow a calendar day across DST and year boundaries", () => {
    expect(
      nextLabel(
        "2026-03-08T13:00:00Z",
        "America/New_York",
        en,
        new Date("2026-03-08T04:30:00Z"),
      ),
    ).toBe("Tomorrow 09:00");
    expect(
      nextLabel(
        "2027-01-01T01:00:00Z",
        item.timezone,
        en,
        new Date("2026-12-31T12:00:00Z"),
      ),
    ).toBe("Tomorrow 09:00");
  });
  it("shows a date when the run is later than tomorrow", () => {
    const label = nextLabel(
      "2026-10-26T01:00:00Z",
      item.timezone,
      en,
      new Date("2026-10-23T01:00:00Z"),
    );
    expect(label).toContain("26");
    expect(label).toContain("09:00");
    expect(label).not.toContain("Tomorrow");
  });
});
