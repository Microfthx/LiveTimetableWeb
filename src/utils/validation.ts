import type {
  CropRegion,
  EventData,
  IdolGroup,
  PosterInfo,
} from "../types/timetable.js";
import { getGroupWindow, parseTime } from "./time.js";

export class ImportError extends Error {}

const EMPTY_CROP: CropRegion = { x: 0, y: 0, width: 0, height: 0 };

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ImportError(`${label} 必须是对象。`);
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim())
    throw new ImportError(`${label} 不能为空，请先核对 OCR 结果。`);
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function clock(value: unknown, label: string, allowEmpty = false): string {
  if (allowEmpty && value === "") return "";
  if (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new ImportError(
      `${label} 请使用 HH:mm（24 小时制），或留空等待人工核对。`,
    );
  }
  return value;
}

export function validateCrop(value: unknown): {
  crop: CropRegion;
  warning?: string;
} {
  if (value === undefined) return { crop: { ...EMPTY_CROP } };
  if (!value || typeof value !== "object" || Array.isArray(value))
    return { crop: { ...EMPTY_CROP }, warning: "图片裁剪区域不是对象" };
  const raw = value as Record<string, unknown>;
  const fields = ["x", "y", "width", "height"] as const;
  if (
    fields.some(
      (field) =>
        typeof raw[field] !== "number" ||
        !Number.isFinite(raw[field]) ||
        raw[field] < 0 ||
        raw[field] > 1,
    )
  ) {
    return {
      crop: { ...EMPTY_CROP },
      warning: "图片裁剪坐标必须在 0 到 1 之间",
    };
  }
  const crop = raw as unknown as CropRegion;
  if (crop.x === 0 && crop.y === 0 && crop.width === 0 && crop.height === 0)
    return { crop: { ...EMPTY_CROP } };
  if (
    crop.width <= 0 ||
    crop.height <= 0 ||
    crop.x + crop.width > 1.001 ||
    crop.y + crop.height > 1.001
  ) {
    return {
      crop: { ...EMPTY_CROP },
      warning: "图片裁剪区域无效或超出海报范围",
    };
  }
  return {
    crop: { x: crop.x, y: crop.y, width: crop.width, height: crop.height },
  };
}

function posterInfo(value: unknown): PosterInfo {
  if (value === undefined) return { width: 0, height: 0 };
  const raw = object(value, "poster");
  const width = raw.width;
  const height = raw.height;
  if (
    typeof width !== "number" ||
    typeof height !== "number" ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 0 ||
    height < 0 ||
    (width === 0) !== (height === 0)
  ) {
    throw new ImportError(
      "poster.width 和 poster.height 必须同时为 0，或同时为正整数。",
    );
  }
  return { width, height };
}

export function validateEventDataDetailed(input: unknown): {
  data: EventData;
  warnings: string[];
} {
  const warnings: string[] = [];
  const root = object(input, "JSON 根节点");
  if (root.schema_version !== "1.0")
    throw new ImportError('schema_version 必须是 "1.0"。');
  const rawEvent = object(root.event, "event");
  const title = requiredString(rawEvent.title, "event.title");
  const date = requiredString(rawEvent.date, "event.date");
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!dateMatch) throw new ImportError("event.date 请使用 YYYY-MM-DD。");
  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const parsedDate = new Date(year, month - 1, day);
  if (
    parsedDate.getFullYear() !== year ||
    parsedDate.getMonth() !== month - 1 ||
    parsedDate.getDate() !== day
  )
    throw new ImportError("event.date 不是有效日期。");
  const event = {
    title,
    date,
    venue: optionalString(rawEvent.venue),
    doors_time: optionalString(rawEvent.doors_time)
      ? clock(rawEvent.doors_time, "event.doors_time")
      : undefined,
    start_time: optionalString(rawEvent.start_time)
      ? clock(rawEvent.start_time, "event.start_time")
      : undefined,
  };
  const delay = root.delay_minutes === undefined ? 0 : root.delay_minutes;
  if (
    typeof delay !== "number" ||
    !Number.isInteger(delay) ||
    delay < -1440 ||
    delay > 1440
  )
    throw new ImportError("delay_minutes 必须是 -1440 到 1440 之间的整数。");
  if (!Array.isArray(root.groups) || root.groups.length === 0)
    throw new ImportError("groups 至少需要一个团体。");
  const ids = new Set<string>();
  const groups: IdolGroup[] = root.groups.map(
    (item: unknown, index: number) => {
      const label = `groups[${index}]`;
      const raw = object(item, label);
      const id = requiredString(raw.id, `${label}.id`);
      if (ids.has(id)) throw new ImportError(`团体 id “${id}” 重复。`);
      ids.add(id);
      const name = requiredString(raw.name, `${label}.name`);
      const start_time = clock(raw.start_time, `${label}.start_time`, true);
      const end_time = clock(raw.end_time, `${label}.end_time`, true);
      if (!start_time || !end_time)
        warnings.push(`${name} 的演出时间不完整，已放在待核对区域`);
      if (start_time && end_time) {
        if (start_time === end_time)
          throw new ImportError(`${name} 的结束时间必须晚于开始时间。`);
        let duration = parseTime(end_time) - parseTime(start_time);
        if (duration < 0) duration += 1440;
        if (duration > 720)
          throw new ImportError(
            `${name} 的演出时长不能超过 12 小时，请核对时间。`,
          );
        if (parseTime(end_time) < parseTime(start_time))
          warnings.push(`${name} 的演出跨午夜，请核对结束时间`);
      }
      const image_base64 =
        raw.image_base64 === undefined ? "" : raw.image_base64;
      if (typeof image_base64 !== "string")
        throw new ImportError(`${label}.image_base64 必须是字符串。`);
      const image_mime =
        raw.image_mime === undefined ? "image/jpeg" : raw.image_mime;
      if (
        typeof image_mime !== "string" ||
        !["image/jpeg", "image/png", "image/webp", "image/gif"].includes(
          image_mime,
        )
      )
        throw new ImportError(`${label}.image_mime 不是支持的图片类型。`);
      if (
        image_base64 &&
        (!/^[A-Za-z0-9+/]+={0,2}$/.test(image_base64) ||
          image_base64.length % 4 !== 0)
      )
        throw new ImportError(
          `${label}.image_base64 需要纯 Base64，不含 data: 前缀。`,
        );
      const checkedCrop = validateCrop(raw.crop);
      if (checkedCrop.warning)
        warnings.push(`${name} 的${checkedCrop.warning}，将使用默认图片`);
      return {
        id,
        name,
        start_time,
        end_time,
        image_base64,
        image_mime,
        crop: checkedCrop.crop,
      };
    },
  );
  const data: EventData = {
    schema_version: "1.0",
    event,
    delay_minutes: delay,
    poster: posterInfo(root.poster),
    groups,
  };
  data.groups = groups
    .map((group, index) => ({ group, index }))
    .sort(
      (a, b) =>
        (getGroupWindow(data, a.group, false)?.start.getTime() ?? Infinity) -
          (getGroupWindow(data, b.group, false)?.start.getTime() ?? Infinity) ||
        a.index - b.index,
    )
    .map((item) => item.group);
  return { data, warnings };
}

export function normalizeEventData(input: unknown): EventData {
  return validateEventDataDetailed(input).data;
}

export function validateEventData(input: unknown): EventData {
  return normalizeEventData(input);
}

export function sanitizeJsonInput(input: string): string {
  let value = input.trim();
  if (value.startsWith("```")) value = value.replace(/^```(?:json)?\s*/i, "");
  if (value.endsWith("```")) value = value.replace(/\s*```$/, "");
  return value.trim();
}

export function parseEventJsonDetailed(text: string): {
  data: EventData;
  warnings: string[];
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(sanitizeJsonInput(text));
  } catch {
    throw new ImportError("JSON 格式错误，请确认复制了完整的 OCR 识别结果。");
  }
  return validateEventDataDetailed(parsed);
}

export function parseEventJson(text: string): EventData {
  return parseEventJsonDetailed(text).data;
}
