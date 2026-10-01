import type { ActivityRecord } from "../types/activity";
import { parseTime } from "./time";

export type ActivityBucket = "today" | "tomorrow" | "upcoming" | "ended";
export type TodayStatus = "not-started" | "live" | "ended" | "unknown";

export function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function bucketFor(activity: ActivityRecord, now: Date): ActivityBucket {
  const today = localDateKey(now);
  const tomorrow = localDateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  const date = activity.data.event.date;
  if (date === today) return "today";
  if (date === tomorrow) return "tomorrow";
  return date < today ? "ended" : "upcoming";
}

export function startMinute(activity: ActivityRecord): number {
  const eventStart = parseTime(activity.data.event.start_time ?? "");
  if (Number.isFinite(eventStart)) return eventStart;
  const groups = activity.data.groups.map((group) => parseTime(group.start_time)).filter(Number.isFinite);
  return groups.length ? Math.min(...groups) : Infinity;
}

export function todayStatus(activity: ActivityRecord, now: Date): TodayStatus {
  if (bucketFor(activity, now) !== "today") return "unknown";
  const anchor = parseTime(activity.data.event.start_time ?? "");
  const starts: number[] = [];
  const ends: number[] = [];
  for (const group of activity.data.groups) {
    const start = parseTime(group.start_time);
    const end = parseTime(group.end_time);
    if (Number.isFinite(start)) starts.push(start + (Number.isFinite(anchor) && start < anchor ? 1440 : 0));
    if (Number.isFinite(end)) {
      let adjusted = end;
      if (Number.isFinite(start) && end <= start) adjusted += 1440;
      else if (Number.isFinite(anchor) && end < anchor) adjusted += 1440;
      ends.push(adjusted);
    }
  }
  if (starts.length) {
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const first = midnight + Math.min(...starts) * 60_000;
    if (now.getTime() < first) return "not-started";
    if (ends.length) return now.getTime() >= midnight + Math.max(...ends) * 60_000 ? "ended" : "live";
    return "unknown";
  }
  const start = startMinute(activity);
  if (!Number.isFinite(start)) return "unknown";
  const currentMinute = now.getHours() * 60 + now.getMinutes();
  return currentMinute < start ? "not-started" : "unknown";
}

export function classifyActivities(activities: ActivityRecord[], now: Date, city = "") {
  const result: Record<ActivityBucket, ActivityRecord[]> = { today: [], tomorrow: [], upcoming: [], ended: [] };
  for (const activity of activities) {
    if (city && activity.city !== city) continue;
    result[bucketFor(activity, now)].push(activity);
  }
  const byStart = (a: ActivityRecord, b: ActivityRecord) => startMinute(a) - startMinute(b) || a.data.event.title.localeCompare(b.data.event.title);
  result.today.sort(byStart);
  result.tomorrow.sort(byStart);
  result.upcoming.sort((a, b) => a.data.event.date.localeCompare(b.data.event.date) || byStart(a, b));
  result.ended.sort((a, b) => b.data.event.date.localeCompare(a.data.event.date) || startMinute(b) - startMinute(a));
  return result;
}

export function displayDate(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  const calendar = new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric" }).format(date);
  const weekday = new Intl.DateTimeFormat("zh-CN", { weekday: "short" }).format(date);
  return `${calendar} · ${weekday}`;
}
