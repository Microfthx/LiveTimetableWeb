import type {
  EventData,
  IdolGroup,
  PerformanceStatus,
} from "../types/timetable.js";

const DAY_MINUTES = 1440;
const MINUTE_MS = 60_000;

export function parseTime(time: string): number {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return Number.NaN;
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

export function formatTime(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * MINUTE_MS);
}

function eventMidnight(data: EventData): Date {
  const [year, month, day] = data.event.date.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function getGroupWindow(
  data: EventData,
  group: IdolGroup,
  effective = true,
): { start: Date; end: Date } | null {
  if (!group.start_time || !group.end_time) return null;
  const anchor = parseTime(data.event.start_time ?? "00:00");
  let startMinute = parseTime(group.start_time);
  if (startMinute < anchor) startMinute += DAY_MINUTES;
  let endMinute = parseTime(group.end_time);
  if (endMinute < parseTime(group.start_time)) endMinute += DAY_MINUTES;
  if (endMinute <= startMinute) endMinute += DAY_MINUTES;
  const base = eventMidnight(data);
  const delay = effective ? data.delay_minutes : 0;
  return {
    start: addMinutes(base, startMinute + delay),
    end: addMinutes(base, endMinute + delay),
  };
}

export function getEffectiveTime(
  data: EventData,
  group: IdolGroup,
): { start: Date; end: Date } | null {
  return getGroupWindow(data, group, true);
}

export function getCurrentPerformance(
  data: EventData,
  now: Date,
): IdolGroup | undefined {
  return data.groups.find((group) => {
    const window = getEffectiveTime(data, group);
    return !!window && now >= window.start && now < window.end;
  });
}

export function getNextPerformance(
  data: EventData,
  now: Date,
): IdolGroup | undefined {
  return data.groups.find((group) => {
    const window = getEffectiveTime(data, group);
    return !!window && window.start > now;
  });
}

export function getPerformanceStatus(
  data: EventData,
  group: IdolGroup,
  now: Date,
  nextId?: string,
): PerformanceStatus {
  const window = getEffectiveTime(data, group);
  if (!window) return "unscheduled";
  const { start, end } = window;
  if (now >= end) return "finished";
  if (now >= start) return "live";
  if (group.id === nextId) return "next";
  return "upcoming";
}

export function getPerformanceProgress(
  data: EventData,
  group: IdolGroup,
  now: Date,
) {
  const window = getEffectiveTime(data, group);
  if (!window)
    return {
      durationMinutes: 0,
      elapsedMinutes: 0,
      remainingMinutes: 0,
      percent: 0,
    };
  const { start, end } = window;
  const durationMinutes = Math.max(
    1,
    Math.round((end.getTime() - start.getTime()) / MINUTE_MS),
  );
  const rawElapsed = (now.getTime() - start.getTime()) / MINUTE_MS;
  const elapsedMinutes = Math.min(
    durationMinutes,
    Math.max(0, Math.floor(rawElapsed)),
  );
  const remainingMinutes = Math.max(
    0,
    Math.ceil((end.getTime() - now.getTime()) / MINUTE_MS),
  );
  const percent = Math.min(
    100,
    Math.max(0, (rawElapsed / durationMinutes) * 100),
  );
  return { durationMinutes, elapsedMinutes, remainingMinutes, percent };
}

export function minutesUntil(date: Date, now: Date): number {
  return Math.max(0, Math.ceil((date.getTime() - now.getTime()) / MINUTE_MS));
}
