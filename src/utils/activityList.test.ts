import { expect, it } from "vitest";
import { demoData } from "../data/demo";
import type { ActivityRecord } from "../types/activity";
import { classifyActivities, todayStatus } from "./activityList";

const activity = (id: string, date: string, city: string, start: string): ActivityRecord => ({
  id, city, createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z",
  data: { ...demoData, event: { ...demoData.event, date, start_time: start } },
});

it("uses the browser date, sorts each section, and filters one city across tabs", () => {
  const now = new Date(2026, 9, 1, 19, 0);
  const records = [
    activity("a", "2026-10-01", "厦门", "18:00"),
    activity("b", "2026-10-01", "上海", "13:00"),
    activity("c", "2026-10-01", "厦门", "16:30"),
    activity("d", "2026-10-02", "上海", "12:00"),
    activity("e", "2026-10-04", "厦门", "15:00"),
    activity("f", "2026-10-03", "厦门", "12:00"),
    activity("g", "2026-09-29", "上海", "12:00"),
    activity("h", "2026-09-30", "厦门", "12:00"),
  ];
  const all = classifyActivities(records, now);
  expect(all.today.map((item) => item.id)).toEqual(["b", "c", "a"]);
  expect(all.upcoming.map((item) => item.id)).toEqual(["f", "e"]);
  expect(all.ended.map((item) => item.id)).toEqual(["h", "g"]);
  const xiamen = classifyActivities(records, now, "厦门");
  expect(xiamen.today.map((item) => item.id)).toEqual(["c", "a"]);
  expect(xiamen.tomorrow).toHaveLength(0);
  expect(xiamen.upcoming).toHaveLength(2);
  expect(xiamen.ended).toHaveLength(1);
});

it("keeps today's finished event in Today with an ended badge", () => {
  const record = activity("a", "2026-10-01", "厦门", "14:00");
  expect(todayStatus(record, new Date(2026, 9, 1, 23, 0))).toBe("ended");
  expect(classifyActivities([record], new Date(2026, 9, 1, 23, 0)).today).toHaveLength(1);
});
