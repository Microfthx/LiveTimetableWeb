import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { EventData } from "../types/timetable";
import { demoData } from "../data/demo";
import {
  getCurrentPerformance,
  getEffectiveTime,
  getNextPerformance,
  getPerformanceProgress,
  getPerformanceStatus,
} from "./time";
import {
  parseEventJson,
  parseEventJsonDetailed,
  validateCrop,
  validateEventData,
} from "./validation";
import { posterRatioDifference, revokeRuntimeImages } from "./poster";
import { OCR_PROMPT } from "../constants/ocrPrompt";

const at = (hour: number, minute: number) => new Date(2026, 9, 1, hour, minute);

describe("performance timeline", () => {
  const data: EventData = { ...demoData, delay_minutes: 15 };

  it("applies delay without rewriting the original schedule", () => {
    expect(data.groups[1].start_time).toBe("14:10");
    expect(getEffectiveTime(data, data.groups[1])!.start.getHours()).toBe(14);
    expect(getEffectiveTime(data, data.groups[1])!.start.getMinutes()).toBe(25);
  });

  it("finds live and next performances on effective boundaries", () => {
    expect(getCurrentPerformance(data, at(14, 24))?.name).toBe("FZI*TWO");
    expect(getCurrentPerformance(data, at(14, 25))?.name).toBe("羽冬蓝海");
    expect(getNextPerformance(data, at(14, 25))?.name).toBe("FZING");
    expect(getPerformanceStatus(data, data.groups[0], at(14, 25))).toBe(
      "finished",
    );
  });

  it("calculates progress and clamps it before and after a show", () => {
    const group = data.groups[1];
    expect(getPerformanceProgress(data, group, at(14, 41))).toMatchObject({
      elapsedMinutes: 16,
      durationMinutes: 20,
      remainingMinutes: 4,
      percent: 80,
    });
    expect(getPerformanceProgress(data, group, at(14, 0)).percent).toBe(0);
    expect(getPerformanceProgress(data, group, at(15, 0)).percent).toBe(100);
  });

  it("shows no live group during an intermission", () => {
    const gap: EventData = {
      ...data,
      delay_minutes: 0,
      groups: [
        { ...data.groups[0], end_time: "14:20" },
        { ...data.groups[1], start_time: "14:30", end_time: "14:50" },
      ],
    };
    expect(getCurrentPerformance(gap, at(14, 25))).toBeUndefined();
    expect(getNextPerformance(gap, at(14, 25))?.name).toBe("羽冬蓝海");
  });

  it("uses the event start as an anchor for next-day performances", () => {
    const night: EventData = {
      ...data,
      event: { ...data.event, start_time: "23:00" },
      delay_minutes: 0,
      groups: [
        { ...data.groups[0], start_time: "23:50", end_time: "00:10" },
        { ...data.groups[1], start_time: "00:15", end_time: "00:35" },
      ],
    };
    expect(getEffectiveTime(night, night.groups[0])!.end.getDate()).toBe(2);
    expect(getEffectiveTime(night, night.groups[1])!.start.getDate()).toBe(2);
    expect(getCurrentPerformance(night, new Date(2026, 9, 2, 0, 5))?.name).toBe(
      "FZI*TWO",
    );
  });
});

describe("OCR JSON validation", () => {
  it("sorts unsorted groups while keeping their original time fields", () => {
    const raw = {
      ...demoData,
      groups: [demoData.groups[2], demoData.groups[0], demoData.groups[1]],
    };
    const parsed = parseEventJson(JSON.stringify(raw));
    expect(parsed.groups.map((group) => group.id)).toEqual([
      "group_001",
      "group_002",
      "group_003",
    ]);
    expect(parsed.groups[1].start_time).toBe("14:10");
  });

  it("rejects malformed times and leaves missing images empty", () => {
    const raw = {
      ...demoData,
      groups: [{ ...demoData.groups[0], start_time: "25:00" }],
    };
    expect(() => validateEventData(raw)).toThrow("HH:mm");
    const withoutImage = {
      ...demoData,
      groups: [
        { id: "one", name: "One", start_time: "14:00", end_time: "14:10" },
      ],
    };
    expect(validateEventData(withoutImage).groups[0].image_base64).toBe("");
  });

  it("normalizes first-version data without poster or crop", () => {
    const old = {
      ...demoData,
      poster: undefined,
      groups: [
        {
          id: "old",
          name: "旧团体",
          start_time: "14:00",
          end_time: "14:10",
          image_base64: "YQ==",
          image_mime: "image/png",
        },
      ],
    };
    const normalized = validateEventData(old);
    expect(normalized.poster).toEqual({ width: 0, height: 0 });
    expect(normalized.groups[0].crop).toEqual({
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    });
    expect(normalized.groups[0].image_base64).toBe("YQ==");
  });

  it("accepts fenced JSON but rejects broken syntax without changing data", () => {
    const fenced = `\`\`\`json\n${JSON.stringify(demoData)}\n\`\`\``;
    expect(parseEventJson(fenced).event.title).toBe(demoData.event.title);
    expect(() => parseEventJson('{"schema_version":"1.0" "event":{}}')).toThrow(
      "JSON 格式错误",
    );
  });

  it("warns about an invalid crop and keeps the other groups", () => {
    const input = {
      ...demoData,
      groups: [
        {
          ...demoData.groups[0],
          crop: { x: 0.9, y: 0.2, width: 0.3, height: 0.2 },
        },
        demoData.groups[1],
      ],
    };
    const result = parseEventJsonDetailed(JSON.stringify(input));
    expect(result.data.groups).toHaveLength(2);
    expect(result.data.groups[0].crop?.width).toBe(0);
    expect(result.warnings.join(" ")).toContain("裁剪区域无效");
    expect(
      validateCrop({ x: 0, y: 0, width: 0, height: 0 }).warning,
    ).toBeUndefined();
  });

  it("allows missing group time and leaves it out of live calculations", () => {
    const input = {
      ...demoData,
      groups: [{ ...demoData.groups[0], start_time: "", end_time: "" }],
    };
    const result = parseEventJsonDetailed(JSON.stringify(input));
    expect(result.warnings.join(" ")).toContain("时间不完整");
    expect(getCurrentPerformance(result.data, at(14, 5))).toBeUndefined();
    expect(
      getPerformanceStatus(result.data, result.data.groups[0], at(14, 5)),
    ).toBe("unscheduled");
  });

  it("compares poster aspect ratio rather than exact pixels", () => {
    const data = { ...demoData, poster: { width: 690, height: 976 } };
    const matching = { file: {} as File, url: "", width: 1380, height: 1952 };
    expect(posterRatioDifference(data, matching)).toBe(0);
    expect(
      posterRatioDifference(data, { ...matching, width: 1952 })!,
    ).toBeGreaterThan(0.05);
  });

  it("keeps the fixed OCR prompt aligned with poster crop fields", () => {
    expect(OCR_PROMPT).toContain('"schema_version": "1.0"');
    expect(OCR_PROMPT).toContain('"poster": {');
    expect(OCR_PROMPT).toContain('"crop": {');
    expect(OCR_PROMPT).toContain("只输出合法 JSON。");
    const mirror = readFileSync(
      new URL("../../json生成prompt.txt", import.meta.url),
      "utf8",
    );
    expect(mirror.replace(/\r\n/g, "\n").trim()).toBe(
      OCR_PROMPT.replace(/\r\n/g, "\n").trim(),
    );
  });

  it("revokes runtime image URLs when an activity is replaced", () => {
    const revoke = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => {});
    revokeRuntimeImages({
      group_001: "blob:test-one",
      group_002: "blob:test-two",
    });
    expect(revoke).toHaveBeenCalledWith("blob:test-one");
    expect(revoke).toHaveBeenCalledWith("blob:test-two");
    revoke.mockRestore();
  });
});
