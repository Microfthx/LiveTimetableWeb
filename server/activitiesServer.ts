import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";
import type { ActivityRecord } from "../src/types/activity.js";
import { validateEventData } from "../src/utils/validation.js";

const MAX_BODY_BYTES = 45 * 1024 * 1024;
const MAX_POSTER_BYTES = 25 * 1024 * 1024;
const SESSION_SECONDS = 180 * 24 * 60 * 60;
const IMAGE_TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as const;
const ID_PATTERN = "[a-f0-9-]{36}";

interface StoredActivity extends Omit<ActivityRecord, "posterUrl"> {
  posterFilename?: string;
}

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

function sendJson(response: ServerResponse, status: number, value: unknown, extra: Record<string, string> = {}) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...extra,
  });
  response.end(JSON.stringify(value));
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "请求数据必须是对象。");
  return value as Record<string, unknown>;
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  if (!request.headers["content-type"]?.startsWith("application/json")) throw new HttpError(415, "请求必须使用 application/json。");
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > MAX_BODY_BYTES) throw new HttpError(413, "上传内容过大。");
    chunks.push(chunk);
  }
  try { return object(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
  catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "JSON 格式错误。");
  }
}

function cityFrom(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 80) throw new HttpError(400, "活动城市不能为空，且不能超过 80 个字符。");
  return value.trim();
}

function checkedEvent(value: unknown) {
  try { return validateEventData(value); }
  catch (error) { throw new HttpError(400, error instanceof Error ? error.message : "活动 JSON 无效。"); }
}

function posterFrom(value: unknown): { bytes: Buffer; extension: string } {
  if (typeof value !== "string") throw new HttpError(400, "海报数据格式无效。");
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) throw new HttpError(400, "仅支持 JPG、PNG 和 WebP 海报。");
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length || bytes.length > MAX_POSTER_BYTES) throw new HttpError(413, "海报不能超过 25 MB。");
  const mime = match[1] as keyof typeof IMAGE_TYPES;
  const valid = (mime === "image/jpeg" && bytes[0] === 0xff && bytes[1] === 0xd8)
    || (mime === "image/png" && bytes.toString("hex", 0, 8) === "89504e470d0a1a0a")
    || (mime === "image/webp" && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP");
  if (!valid) throw new HttpError(400, "海报内容与格式不符。");
  return { bytes, extension: IMAGE_TYPES[mime] };
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function publicActivity(activity: StoredActivity): ActivityRecord {
  const { posterFilename: _posterFilename, ...rest } = activity;
  void _posterFilename;
  return { ...rest, ...(activity.posterFilename ? { posterUrl: `/api/activities/${activity.id}/poster?v=${encodeURIComponent(activity.updatedAt)}` } : {}) };
}

async function streamImage(response: ServerResponse, filename: string, mime: string, immutable = false) {
  const stream = createReadStream(filename);
  stream.on("error", () => {
    if (!response.headersSent) sendJson(response, 404, { error: "图片不存在。" });
    else response.destroy();
  });
  stream.on("open", () => {
    response.writeHead(200, {
      "Content-Type": mime,
      "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
      "X-Content-Type-Options": "nosniff",
    });
    stream.pipe(response);
  });
}

export async function createActivitiesServer(options: { dataDir: string; adminAccessKey: string; adminSessionSecret: string }) {
  const { dataDir, adminAccessKey, adminSessionSecret } = options;
  if (!adminAccessKey || adminSessionSecret.length < 32) throw new Error("ADMIN_ACCESS_KEY and a 32+ character ADMIN_SESSION_SECRET are required");
  await mkdir(dataDir, { recursive: true });
  const storePath = join(dataDir, "activities.json");
  const posterDir = join(dataDir, "posters");
  await mkdir(posterDir, { recursive: true });
  let activities: StoredActivity[];
  try {
    const saved = JSON.parse(await readFile(storePath, "utf8"));
    if (!Array.isArray(saved)) throw new Error("Invalid activities.json");
    activities = saved.map((item: unknown) => {
      const raw = object(item);
      if (typeof raw.id !== "string" || !new RegExp(`^${ID_PATTERN}$`).test(raw.id)
        || typeof raw.city !== "string" || typeof raw.createdAt !== "string"
        || typeof raw.updatedAt !== "string" || (raw.posterFilename !== undefined && (typeof raw.posterFilename !== "string" || !/^[a-f0-9-]{36}-[a-f0-9-]{36}\.(jpg|png|webp)$/.test(raw.posterFilename)))) {
        throw new Error("Invalid stored activity");
      }
      return { ...raw, data: validateEventData(raw.data) } as unknown as StoredActivity;
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    // The earlier server stored one shared event in state.json. Keep that file intact.
    try {
      const old = object(JSON.parse(await readFile(join(dataDir, "state.json"), "utf8")));
      const now = new Date().toISOString();
      activities = [{
        id: randomUUID(), city: "未设置", data: validateEventData(old.data),
        images: old.images && typeof old.images === "object" && !Array.isArray(old.images) ? old.images as Record<string, string> : {},
        createdAt: now, updatedAt: now,
      }];
    } catch (legacyError) {
      if ((legacyError as NodeJS.ErrnoException).code !== "ENOENT") throw legacyError;
      activities = [];
    }
    await writeFile(storePath, JSON.stringify(activities), { flag: "wx" });
  }

  let queue: Promise<unknown> = Promise.resolve();
  function exclusive<T>(action: () => Promise<T>): Promise<T> {
    const result = queue.then(action);
    queue = result.catch(() => undefined);
    return result;
  }
  async function save(next: StoredActivity[]) {
    const temporary = join(dataDir, `activities-${process.pid}-${randomUUID()}.tmp`);
    await writeFile(temporary, JSON.stringify(next));
    await rename(temporary, storePath);
    activities = next;
  }
  const signature = (value: string) => createHmac("sha256", adminSessionSecret).update(value).digest("base64url");
  const revoked = new Set<string>();
  function sessionId(request: IncomingMessage): string | null {
    const cookie = request.headers.cookie?.split(";").map((part) => part.trim()).find((part) => part.startsWith("admin_session="));
    const token = cookie?.slice("admin_session=".length);
    if (!token) return null;
    const parts = token.split(".");
    if (parts.length !== 3 || !/^\d+$/.test(parts[1]) || Number(parts[1]) <= Date.now() || revoked.has(parts[0])) return null;
    const signed = `${parts[0]}.${parts[1]}`;
    return safeEqual(signature(signed), parts[2]) ? parts[0] : null;
  }
  const cookie = (value: string, maxAge: number, request: IncomingMessage) =>
    `admin_session=${value}; HttpOnly; SameSite=Strict; Path=/api/admin; Max-Age=${maxAge}${request.headers["x-forwarded-proto"] === "https" ? "; Secure" : ""}`;
  const failures = new Map<string, { count: number; until: number }>();
  function requireAdmin(request: IncomingMessage) {
    if (!sessionId(request)) throw new HttpError(401, "需要管理员登录。");
  }
  function requireSafeWrite(request: IncomingMessage) {
    if (request.headers["x-requested-with"] !== "XMLHttpRequest") throw new HttpError(403, "请求来源无效。");
    const origin = request.headers.origin;
    if (origin) {
      const host = request.headers.host?.split(":")[0];
      try {
        const sourceHost = new URL(origin).hostname;
        if (sourceHost !== host && !(sourceHost === "localhost" && host === "127.0.0.1")) throw new Error();
      }
      catch { throw new HttpError(403, "请求来源无效。"); }
    }
  }
  async function writePoster(id: string, value: unknown): Promise<string> {
    const image = posterFrom(value);
    const filename = `${id}-${randomUUID()}.${image.extension}`;
    await writeFile(join(posterDir, filename), image.bytes, { flag: "wx" });
    return filename;
  }
  async function removePoster(filename?: string) {
    if (!filename) return;
    try { await unlink(join(posterDir, filename)); }
    catch (error) { console.error("Poster cleanup failed", error); }
  }

  return createServer(async (request, response) => {
    try {
      const path = new URL(request.url ?? "/", "http://localhost").pathname;
      const method = request.method ?? "GET";
      if (method === "GET" && path === "/api/health") { sendJson(response, 200, { ok: true, activities: activities.length }); return; }
      if (method === "GET" && path === "/api/activities") { sendJson(response, 200, activities.map(publicActivity)); return; }
      const activityPath = new RegExp(`^/api/activities/(${ID_PATTERN})$`).exec(path);
      if (method === "GET" && activityPath) {
        const activity = activities.find((item) => item.id === activityPath[1]);
        if (!activity) throw new HttpError(404, "活动不存在或已被删除。");
        sendJson(response, 200, publicActivity(activity)); return;
      }
      const posterPath = new RegExp(`^/api/activities/(${ID_PATTERN})/poster$`).exec(path);
      if (method === "GET" && posterPath) {
        const activity = activities.find((item) => item.id === posterPath[1]);
        if (!activity?.posterFilename) throw new HttpError(404, "海报不存在。");
        const extension = activity.posterFilename.split(".").pop();
        await streamImage(response, join(posterDir, activity.posterFilename), extension === "jpg" ? "image/jpeg" : `image/${extension}`);
        return;
      }
      // Preserve old published group thumbnails for the migrated activity.
      const oldImagePath = /^\/api\/images\/(\d+)\/([a-f0-9]{64})\.(webp|jpg|png)$/.exec(path);
      if (method === "GET" && oldImagePath) {
        await streamImage(response, join(dataDir, "images", oldImagePath[1], `${oldImagePath[2]}.${oldImagePath[3]}`), oldImagePath[3] === "jpg" ? "image/jpeg" : `image/${oldImagePath[3]}`, true);
        return;
      }
      if (method === "GET" && path === "/api/admin/session") { sendJson(response, 200, { authenticated: !!sessionId(request) }); return; }
      if (method === "POST" && path === "/api/admin/login") {
        requireSafeWrite(request);
        const address = String(request.headers["x-real-ip"] ?? request.socket.remoteAddress ?? "unknown");
        const attempt = failures.get(address);
        if (attempt && attempt.count >= 5 && attempt.until > Date.now()) throw new HttpError(429, "尝试过于频繁，请稍后重试。");
        const input = await readJson(request);
        if (typeof input.key !== "string" || !safeEqual(signature(input.key), signature(adminAccessKey))) {
          const next = attempt && attempt.until > Date.now() ? attempt.count + 1 : 1;
          failures.set(address, { count: next, until: Date.now() + 15 * 60_000 });
          throw new HttpError(401, "管理密钥错误");
        }
        failures.delete(address);
        const id = randomUUID();
        const signed = `${id}.${Date.now() + SESSION_SECONDS * 1000}`;
        sendJson(response, 200, { authenticated: true }, { "Set-Cookie": cookie(`${signed}.${signature(signed)}`, SESSION_SECONDS, request) });
        return;
      }
      if (method === "POST" && path === "/api/admin/logout") {
        requireSafeWrite(request);
        const id = sessionId(request);
        if (id) revoked.add(id);
        sendJson(response, 200, { authenticated: false }, { "Set-Cookie": cookie("", 0, request) }); return;
      }
      if (path.startsWith("/api/admin/")) {
        if (!["POST", "PATCH", "DELETE"].includes(method)) throw new HttpError(404, "接口不存在。");
        requireSafeWrite(request);
        requireAdmin(request);
      }
      if (method === "POST" && path === "/api/admin/activities") {
        const input = await readJson(request);
        const city = cityFrom(input.city);
        const data = checkedEvent(input.data);
        const result = await exclusive(async () => {
          const id = randomUUID();
          const now = new Date().toISOString();
          const filename = input.poster === undefined ? undefined : await writePoster(id, input.poster);
          const activity: StoredActivity = { id, city, data, createdAt: now, updatedAt: now, ...(filename ? { posterFilename: filename } : {}) };
          try { await save([...activities, activity]); }
          catch (error) { await removePoster(filename); throw error; }
          return publicActivity(activity);
        });
        sendJson(response, 201, result); return;
      }
      const adminActivityPath = new RegExp(`^/api/admin/activities/(${ID_PATTERN})$`).exec(path);
      if (method === "PATCH" && adminActivityPath) {
        const input = await readJson(request);
        const city = cityFrom(input.city);
        const data = checkedEvent(input.data);
        const result = await exclusive(async () => {
          const old = activities.find((item) => item.id === adminActivityPath[1]);
          if (!old) throw new HttpError(404, "活动不存在或已被删除。");
          const filename = input.poster === undefined ? undefined : await writePoster(old.id, input.poster);
          const next = { ...old, city, data, updatedAt: new Date().toISOString(), ...(filename ? { posterFilename: filename, images: {} } : {}) };
          try { await save(activities.map((item) => item.id === old.id ? next : item)); }
          catch (error) { await removePoster(filename); throw error; }
          if (filename) await removePoster(old.posterFilename);
          return publicActivity(next);
        });
        sendJson(response, 200, result); return;
      }
      if (method === "DELETE" && adminActivityPath) {
        await exclusive(async () => {
          const old = activities.find((item) => item.id === adminActivityPath[1]);
          if (!old) throw new HttpError(404, "活动不存在或已被删除。");
          await save(activities.filter((item) => item.id !== old.id));
          await removePoster(old.posterFilename);
        });
        sendJson(response, 200, { ok: true }); return;
      }
      throw new HttpError(404, "接口不存在。");
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      if (status === 500) console.error(error);
      if (!response.headersSent) sendJson(response, status, { error: status === 500 ? "服务器操作失败，请稍后重试。" : (error as Error).message });
    }
  });
}
