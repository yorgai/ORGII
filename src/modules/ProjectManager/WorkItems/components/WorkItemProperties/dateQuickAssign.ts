const WEEKDAY_ALIASES = new Map<string, number>([
  ["sun", 0],
  ["sunday", 0],
  ["mon", 1],
  ["monday", 1],
  ["tue", 2],
  ["tues", 2],
  ["tuesday", 2],
  ["wed", 3],
  ["wednesday", 3],
  ["thu", 4],
  ["thur", 4],
  ["thurs", 4],
  ["thursday", 4],
  ["fri", 5],
  ["friday", 5],
  ["sat", 6],
  ["saturday", 6],
]);

const MONTH_ALIASES = new Map<string, number>([
  ["jan", 0],
  ["january", 0],
  ["feb", 1],
  ["february", 1],
  ["mar", 2],
  ["march", 2],
  ["apr", 3],
  ["april", 3],
  ["may", 4],
  ["jun", 5],
  ["june", 5],
  ["jul", 6],
  ["july", 6],
  ["aug", 7],
  ["august", 7],
  ["sep", 8],
  ["sept", 8],
  ["september", 8],
  ["oct", 9],
  ["october", 9],
  ["nov", 10],
  ["november", 10],
  ["dec", 11],
  ["december", 11],
]);

export interface DateQuickAssignSuggestion {
  id: string;
  input: string;
  date: Date;
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number): Date {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + days);
  return nextDate;
}

function addMonths(date: Date, months: number): Date {
  const nextDate = new Date(date);
  nextDate.setMonth(nextDate.getMonth() + months);
  return nextDate;
}

function getLocalDateKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function getNextWeekday(today: Date, targetWeekday: number): Date {
  const currentWeekday = today.getDay();
  const daysUntilTarget = (targetWeekday - currentWeekday + 7) % 7 || 7;
  return addDays(today, daysUntilTarget);
}

function getThisOrNextWeekday(today: Date, targetWeekday: number): Date {
  const currentWeekday = today.getDay();
  const daysUntilTarget = (targetWeekday - currentWeekday + 7) % 7;
  return addDays(today, daysUntilTarget);
}

function getUpcomingMonthDate(
  today: Date,
  monthIndex: number,
  dayOfMonth: number,
  explicitYear?: number
): Date | null {
  const year = explicitYear ?? today.getFullYear();
  const candidate = new Date(year, monthIndex, dayOfMonth);
  if (
    candidate.getFullYear() !== year ||
    candidate.getMonth() !== monthIndex ||
    candidate.getDate() !== dayOfMonth
  ) {
    return null;
  }
  if (!explicitYear && candidate < today) {
    return new Date(year + 1, monthIndex, dayOfMonth);
  }
  return candidate;
}

function parseNumericDate(today: Date, query: string): Date | null {
  const isoMatch = query.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const monthIndex = Number(isoMatch[2]) - 1;
    const dayOfMonth = Number(isoMatch[3]);
    return getUpcomingMonthDate(today, monthIndex, dayOfMonth, year);
  }

  const slashMatch = query.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/);
  if (!slashMatch) return null;

  const first = Number(slashMatch[1]);
  const second = Number(slashMatch[2]);
  const yearInput = slashMatch[3];
  const year = yearInput
    ? Number(yearInput.length === 2 ? `20${yearInput}` : yearInput)
    : undefined;

  return getUpcomingMonthDate(today, first - 1, second, year);
}

function parseMonthDate(today: Date, query: string): Date | null {
  const monthDayMatch = query.match(/^([a-z]+)\s+(\d{1,2})(?:,?\s+(\d{4}))?$/);
  if (monthDayMatch) {
    const monthIndex = MONTH_ALIASES.get(monthDayMatch[1]);
    if (monthIndex === undefined) return null;
    return getUpcomingMonthDate(
      today,
      monthIndex,
      Number(monthDayMatch[2]),
      monthDayMatch[3] ? Number(monthDayMatch[3]) : undefined
    );
  }

  const dayMonthMatch = query.match(/^(\d{1,2})\s+([a-z]+)(?:,?\s+(\d{4}))?$/);
  if (!dayMonthMatch) return null;

  const monthIndex = MONTH_ALIASES.get(dayMonthMatch[2]);
  if (monthIndex === undefined) return null;
  return getUpcomingMonthDate(
    today,
    monthIndex,
    Number(dayMonthMatch[1]),
    dayMonthMatch[3] ? Number(dayMonthMatch[3]) : undefined
  );
}

export function parseDateQuickAssignInput(
  input: string,
  now: Date = new Date()
): Date | null {
  const today = startOfLocalDay(now);
  const query = input.trim().toLowerCase().replace(/\s+/g, " ");
  if (!query) return null;

  if (["today", "tod", "td"].includes(query)) return today;
  if (["tomorrow", "tmr", "tmrw", "tom"].includes(query)) {
    return addDays(today, 1);
  }
  if (["yesterday", "yday"].includes(query)) return addDays(today, -1);
  if (["next week", "1 week", "in 1 week"].includes(query)) {
    return addDays(today, 7);
  }
  if (["next month", "1 month", "in 1 month"].includes(query)) {
    return addMonths(today, 1);
  }
  if (["weekend", "this weekend"].includes(query)) {
    return getNextWeekday(addDays(today, -1), 6);
  }

  const inMatch = query.match(
    /^in\s+(\d+)\s+(day|days|week|weeks|month|months)$/
  );
  if (inMatch) {
    const amount = Number(inMatch[1]);
    const unit = inMatch[2];
    if (unit.startsWith("day")) return addDays(today, amount);
    if (unit.startsWith("week")) return addDays(today, amount * 7);
    return addMonths(today, amount);
  }

  const nextWeekdayMatch = query.match(/^next\s+([a-z]+)$/);
  if (nextWeekdayMatch) {
    const weekday = WEEKDAY_ALIASES.get(nextWeekdayMatch[1]);
    if (weekday !== undefined) return getNextWeekday(today, weekday);
  }

  const weekday = WEEKDAY_ALIASES.get(query);
  if (weekday !== undefined) return getNextWeekday(addDays(today, -1), weekday);

  return parseNumericDate(today, query) ?? parseMonthDate(today, query);
}

export function buildDateQuickAssignSuggestions(
  input: string,
  now: Date = new Date()
): DateQuickAssignSuggestion[] {
  const today = startOfLocalDay(now);
  const trimmedInput = input.trim();
  const parsedDate = parseDateQuickAssignInput(trimmedInput, now);

  if (parsedDate) {
    return [
      {
        id: `parsed-${parsedDate.toISOString()}`,
        input: trimmedInput,
        date: parsedDate,
      },
    ];
  }

  if (trimmedInput) return [];

  const defaultSuggestions: DateQuickAssignSuggestion[] = [
    { id: "today", input: "today", date: today },
    { id: "tomorrow", input: "tomorrow", date: addDays(today, 1) },
    {
      id: "this-friday",
      input: "friday",
      date: getThisOrNextWeekday(today, 5),
    },
    { id: "next-week", input: "next week", date: addDays(today, 7) },
  ];
  const seenLocalDates = new Set<string>();

  return defaultSuggestions.filter((suggestion) => {
    const localDateKey = getLocalDateKey(suggestion.date);
    if (seenLocalDates.has(localDateKey)) return false;
    seenLocalDates.add(localDateKey);
    return true;
  });
}
