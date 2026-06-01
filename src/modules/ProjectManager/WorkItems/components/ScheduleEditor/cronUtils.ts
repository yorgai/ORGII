export type ScheduleFrequency = "daily" | "weekday" | "weekly" | "monthly";

export interface CronParts {
  frequency: ScheduleFrequency;
  dayOfWeek?: number;
  dayOfMonth?: number;
  hour: number;
  minute: number;
}

const WEEKDAY_NAMES_KEYS = [
  "common:schedule.days.sun",
  "common:schedule.days.mon",
  "common:schedule.days.tue",
  "common:schedule.days.wed",
  "common:schedule.days.thu",
  "common:schedule.days.fri",
  "common:schedule.days.sat",
];

export function buildCron(parts: CronParts): string {
  const { frequency, dayOfWeek, dayOfMonth, hour, minute } = parts;
  switch (frequency) {
    case "daily":
      return `${minute} ${hour} * * *`;
    case "weekday":
      return `${minute} ${hour} * * 1-5`;
    case "weekly":
      return `${minute} ${hour} * * ${dayOfWeek ?? 1}`;
    case "monthly":
      return `${minute} ${hour} ${dayOfMonth ?? 1} * *`;
  }
}

export function parseCron(cron: string): CronParts | null {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return null;

  const [minStr, hourStr, dom, , dow] = parts;
  const minute = Number(minStr);
  const hour = Number(hourStr);

  if (isNaN(minute) || isNaN(hour)) return null;

  if (dow === "1-5" && dom === "*") {
    return { frequency: "weekday", hour, minute };
  }
  if (dom === "*" && /^\d$/.test(dow)) {
    return { frequency: "weekly", dayOfWeek: Number(dow), hour, minute };
  }
  if (dom === "*" && dow === "*") {
    return { frequency: "daily", hour, minute };
  }
  if (/^\d{1,2}$/.test(dom) && dow === "*") {
    return { frequency: "monthly", dayOfMonth: Number(dom), hour, minute };
  }

  return null;
}

export function cronToHumanReadable(
  cron: string,
  t: (key: string, opts?: Record<string, unknown>) => string
): string {
  const parsed = parseCron(cron);
  if (!parsed) return cron;

  const timeStr = `${String(parsed.hour).padStart(2, "0")}:${String(parsed.minute).padStart(2, "0")}`;

  switch (parsed.frequency) {
    case "daily":
      return t("common:schedule.humanReadable.daily", { time: timeStr });
    case "weekday":
      return t("common:schedule.humanReadable.weekday", { time: timeStr });
    case "weekly": {
      const dayKey = WEEKDAY_NAMES_KEYS[parsed.dayOfWeek ?? 1];
      const dayName = t(dayKey);
      return t("common:schedule.humanReadable.weekly", {
        day: dayName,
        time: timeStr,
      });
    }
    case "monthly":
      return t("common:schedule.humanReadable.monthly", {
        day: parsed.dayOfMonth ?? 1,
        time: timeStr,
      });
  }
}
