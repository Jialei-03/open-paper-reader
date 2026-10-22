import type { Translator } from "../../i18n/i18n";
import type { ScheduleInput } from "./schedules-api";

export function weekdays(locale: string) {
  const formatter = new Intl.DateTimeFormat(locale, {
    weekday: "long",
    timeZone: "UTC",
  });
  return Array.from({ length: 7 }, (_, day) =>
    formatter.format(new Date(Date.UTC(2024, 0, 1 + day))),
  );
}

export function frequencyLabel(item: ScheduleInput, { t, locale }: Translator) {
  if (item.frequency === "interval")
    return t("schedules.everyHours", { count: item.interval_hours });
  if (item.frequency === "weekly")
    return t("schedules.everyWeek", {
      day: weekdays(locale)[item.weekday],
      time: item.local_time,
    });
  return t("schedules.everyDay", { time: item.local_time });
}

export function nextLabel(
  at: string,
  zone: string,
  { t, locale }: Translator,
  now = new Date(),
) {
  const date = new Date(at);
  const key = (value: Date) => {
    const parts = new Intl.DateTimeFormat("en", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(value);
    return ["year", "month", "day"]
      .map((part) => parts.find((p) => p.type === part)!.value)
      .join("-");
  };
  const today = key(now);
  const tomorrow = new Date(`${today}T00:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const day = key(date);
  const clock = new Intl.DateTimeFormat(locale, {
    timeZone: zone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
  if (day === today) return `${t("schedules.today")} ${clock}`;
  if (day === tomorrow.toISOString().slice(0, 10))
    return `${t("schedules.tomorrow")} ${clock}`;
  return new Intl.DateTimeFormat(locale, {
    timeZone: zone,
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}
