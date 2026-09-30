import { createHash, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { join } from "node:path";
import { demoData } from "../src/data/demo.js";
import type { EventData } from "../src/types/timetable.js";
import { validateEventData } from "../src/utils/validation.js";

const MAX_BODY_BYTES = 25 * 1024 * 1024;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const IMAGE_TYPES = {
  "image/webp": "webp",
  "image/jpeg": "jpg",
  "image/png": "png",
} as const;

type SharedState = {
  revision: number;
  data: EventData;
  images: Record<string, string>;
};

type Snapshot = SharedState & { requires_auth: boolean };

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function json(response: ServerResponse, status: number, value: unknown) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(body);
}

async function bodyJson(request: IncomingMessage): Promise<unknown> {
  if (!request.headers["content-type"]?.startsWith("application/json")) {
    throw new HttpError(415, "请求必须使用 application/json。");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "上传内容过大。");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "JSON 格式错误。");
  }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "请求数据必须是对象。");
  }
  return value as Record<string, unknown>;
}

function authenticated(request: IncomingMessage, token: string): boolean {
  if (!token) return true;
  const supplied = request.headers["x-admin-token"];
  if (typeof supplied !== "string") return false;
  const expected = Buffer.from(token);
  const actual = Buffer.from(supplied);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function checkedImage(value: unknown): { bytes: Buffer; extension: string } {
  if (typeof value !== "string") throw new HttpError(400, "图片数据格式无效。");
  const match =
    /^data:(image\/(?:webp|jpeg|png));base64,([A-Za-z0-9+/]+={0,2})$/.exec(
      value,
    );
  if (!match) throw new HttpError(400, "图片必须是 WebP、JPEG 或 PNG。 ");
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) {
    throw new HttpError(413, "单张团体图片不能超过 2 MB。");
  }
  const mime = match[1] as keyof typeof IMAGE_TYPES;
  const valid =
    (mime === "image/webp" &&
      bytes.toString("ascii", 0, 4) === "RIFF" &&
      bytes.toString("ascii", 8, 12) === "WEBP") ||
    (mime === "image/jpeg" && bytes[0] === 0xff && bytes[1] === 0xd8) ||
    (mime === "image/png" &&
      bytes.toString("hex", 0, 8) === "89504e470d0a1a0a");
  if (!valid) throw new HttpError(400, "图片内容与格式不符。");
  return { bytes, extension: IMAGE_TYPES[mime] };
}

export async function createSharedServer(options: {
  dataDir: string;
  writeToken: string;
}) {
  const { dataDir, writeToken } = options;
  await mkdir(dataDir, { recursive: true });
  const statePath = join(dataDir, "state.json");
  let state: SharedState;
  try {
    const saved = record(JSON.parse(await readFile(statePath, "utf8")));
    if (!Number.isSafeInteger(saved.revision) || Number(saved.revision) < 1) {
      throw new Error("Invalid saved revision");
    }
    const images = record(saved.images);
    if (
      Object.values(images).some(
        (value) =>
          typeof value !== "string" ||
          !/^\/api\/images\/\d+\/[a-f0-9]{64}\.(webp|jpg|png)$/.test(value),
      )
    ) {
      throw new Error("Invalid saved images");
    }
    state = {
      revision: Number(saved.revision),
      data: validateEventData(saved.data),
      images: images as Record<string, string>,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    state = { revision: 1, data: validateEventData(demoData), images: {} };
    await writeFile(statePath, JSON.stringify(state), { flag: "wx" });
  }

  let writeQueue: Promise<unknown> = Promise.resolve();
  function exclusive<T>(action: () => Promise<T>): Promise<T> {
    const result = writeQueue.then(action);
    writeQueue = result.catch(() => undefined);
    return result;
  }
  const snapshot = (): Snapshot => ({ ...state, requires_auth: !!writeToken });
  async function save(next: SharedState): Promise<Snapshot> {
    const temporary = join(
      dataDir,
      `state-${process.pid}-${next.revision}.tmp`,
    );
    await writeFile(temporary, JSON.stringify(next));
    await rename(temporary, statePath);
    state = next;
    return snapshot();
  }

  return createServer(async (request, response) => {
    try {
      const path = new URL(request.url ?? "/", "http://localhost").pathname;
      if (request.method === "GET" && path === "/api/health") {
        json(response, 200, { ok: true, revision: state.revision });
        return;
      }
      if (request.method === "GET" && path === "/api/state") {
        json(response, 200, snapshot());
        return;
      }
      if (request.method === "GET" && path === "/api/auth") {
        if (!authenticated(request, writeToken))
          throw new HttpError(401, "管理员密钥不正确。");
        json(response, 200, { ok: true });
        return;
      }
      const imagePath =
        /^\/api\/images\/(\d+)\/([a-f0-9]{64})\.(webp|jpg|png)$/.exec(path);
      if (request.method === "GET" && imagePath) {
        const file = join(
          dataDir,
          "images",
          imagePath[1],
          `${imagePath[2]}.${imagePath[3]}`,
        );
        const contentType =
          imagePath[3] === "jpg" ? "image/jpeg" : `image/${imagePath[3]}`;
        const stream = createReadStream(file);
        stream.on("error", () => {
          if (!response.headersSent)
            json(response, 404, { error: "图片不存在。" });
          else response.destroy();
        });
        stream.on("open", () => {
          response.writeHead(200, {
            "Content-Type": contentType,
            "Cache-Control": "public, max-age=31536000, immutable",
            "X-Content-Type-Options": "nosniff",
          });
          stream.pipe(response);
        });
        return;
      }
      if (!["PUT", "PATCH", "POST"].includes(request.method ?? ""))
        throw new HttpError(404, "接口不存在。");
      if (!authenticated(request, writeToken))
        throw new HttpError(401, "管理员密钥不正确。");
      if (request.method === "PATCH" && path === "/api/delay") {
        const input = record(await bodyJson(request));
        const result = await exclusive(async () => {
          const hasDelta = Number.isInteger(input.delta);
          const hasValue = Number.isInteger(input.value);
          if (hasDelta === hasValue)
            throw new HttpError(400, "请提供 delta 或 value 整数。");
          const delay = hasDelta
            ? state.data.delay_minutes + Number(input.delta)
            : Number(input.value);
          if (delay < -1440 || delay > 1440)
            throw new HttpError(400, "延迟必须在 -1440 到 1440 分钟之间。");
          return save({
            ...state,
            revision: state.revision + 1,
            data: { ...state.data, delay_minutes: delay },
          });
        });
        json(response, 200, result);
        return;
      }
      if (request.method === "PUT" && path === "/api/event") {
        const input = record(await bodyJson(request));
        const result = await exclusive(async () => {
          if (input.revision !== state.revision)
            throw new HttpError(409, "服务器活动已更新，请重新检查导入预览。");
          const data = validateEventData(input.data);
          const rawImages = record(input.images);
          const groupIds = new Set(data.groups.map((group) => group.id));
          const revision = state.revision + 1;
          const imageDir = join(dataDir, "images", String(revision));
          const imageEntries = Object.entries(rawImages);
          if (imageEntries.length > data.groups.length)
            throw new HttpError(400, "团体图片数量无效。");
          const checked = imageEntries.map(([id, raw]) => {
            if (!groupIds.has(id))
              throw new HttpError(400, "团体图片 ID 与活动不一致。");
            return { id, ...checkedImage(raw) };
          });
          await mkdir(imageDir, { recursive: true });
          const images: Record<string, string> = {};
          for (const image of checked) {
            const filename = `${createHash("sha256").update(image.id).digest("hex")}.${image.extension}`;
            await writeFile(join(imageDir, filename), image.bytes, {
              flag: "wx",
            });
            images[image.id] = `/api/images/${revision}/${filename}`;
          }
          return save({ revision, data, images });
        });
        json(response, 200, result);
        return;
      }
      if (request.method === "POST" && path === "/api/reset") {
        const result = await exclusive(() =>
          save({
            revision: state.revision + 1,
            data: validateEventData(demoData),
            images: {},
          }),
        );
        json(response, 200, result);
        return;
      }
      throw new HttpError(404, "接口不存在。");
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      const message = error instanceof Error ? error.message : "服务器错误。";
      if (status === 500) console.error(error);
      if (!response.headersSent)
        json(response, status, {
          error: status === 500 ? "服务器保存失败，请稍后重试。" : message,
        });
    }
  });
}
