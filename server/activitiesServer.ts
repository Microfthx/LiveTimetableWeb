import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, mkdir, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";
import { imageSize } from "image-size";
import sharp from "sharp";
import type { ActivityRecord } from "../src/types/activity.js";
import type { GroupBindings, GroupLibraryRecord } from "../src/types/groupLibrary.js";
import { canonicalGroupName, exactGroupBindings, groupMatchKey } from "../src/utils/groupMatching.js";
import { validateEventData } from "../src/utils/validation.js";
import { AiImportError, recognizeEvent, type AiImage } from "./aiImport.js";
import { createAiJobQueue, type AiJobInput, type AiJobRunner } from "./aiJobs.js";
import { createWeiboStore, fetchWeiboGroupProfile, profileUidFromUrl, WeiboError } from "./weibo.js";

const MAX_BODY_BYTES = 80 * 1024 * 1024;
const MAX_POSTER_BYTES = 25 * 1024 * 1024;
const SESSION_SECONDS = 180 * 24 * 60 * 60;
const IMAGE_TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as const;
const ID_PATTERN = "[a-f0-9-]{36}";

interface StoredActivity extends Omit<ActivityRecord, "posterUrl" | "cropSourceUrl" | "cropSourceSeparate"> {
  posterFilename?: string;
  cropSourceFilename?: string;
}

interface StoredGroup extends Omit<GroupLibraryRecord, "avatarUrl" | "boundActivityCount"> {
  avatarFilename?: string;
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
  const { posterFilename: _posterFilename, cropSourceFilename: _cropSourceFilename, ...rest } = activity;
  void _posterFilename;
  void _cropSourceFilename;
  const posterVersion = activity.posterFilename && createHash("sha256").update(activity.posterFilename).digest("hex").slice(0, 16);
  const cropVersion = (activity.cropSourceFilename || activity.posterFilename)
    && createHash("sha256").update(activity.cropSourceFilename || activity.posterFilename!).digest("hex").slice(0, 16);
  return {
    ...rest,
    ...(posterVersion ? { posterUrl: `/api/activities/${activity.id}/poster?v=${posterVersion}` } : {}),
    ...(posterVersion ? { thumbnailUrl: `/api/activities/${activity.id}/thumbnail?v=${posterVersion}` } : {}),
    ...(cropVersion ? { cropSourceUrl: `/api/activities/${activity.id}/crop-source?v=${cropVersion}` } : {}),
    cropSourceSeparate: !!activity.cropSourceFilename && activity.cropSourceFilename !== activity.posterFilename,
  };
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

export async function createActivitiesServer(options: { dataDir: string; adminAccessKey: string; adminSessionSecret: string; aiJobRunner?: AiJobRunner }) {
  const { dataDir, adminAccessKey, adminSessionSecret } = options;
  if (!adminAccessKey || adminSessionSecret.length < 32) throw new Error("ADMIN_ACCESS_KEY and a 32+ character ADMIN_SESSION_SECRET are required");
  await mkdir(dataDir, { recursive: true });
  const storePath = join(dataDir, "activities.json");
  const posterDir = join(dataDir, "posters");
  await mkdir(posterDir, { recursive: true });
  const thumbnailJobs = new Map<string, Promise<void>>();
  const thumbnailName = (filename: string) => filename.replace(/\.(jpg|png|webp)$/, ".thumb.webp");
  async function ensureThumbnail(filename: string) {
    const target = join(posterDir, thumbnailName(filename));
    try { await access(target); return; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const existing = thumbnailJobs.get(filename);
    if (existing) return existing;
    const job = (async () => {
      const temporary = `${target}-${randomUUID()}.tmp`;
      try {
        await sharp(join(posterDir, filename)).rotate().resize(320, 480, { fit: "inside", withoutEnlargement: true })
          .webp({ quality: 76, effort: 4 }).toFile(temporary);
        await rename(temporary, target);
      } catch (error) {
        try { await unlink(temporary); } catch { /* no temporary file */ }
        throw error;
      }
    })();
    thumbnailJobs.set(filename, job);
    try { await job; } finally { thumbnailJobs.delete(filename); }
  }
  const weiboStore = createWeiboStore(dataDir);
  const aiJobs = await createAiJobQueue(dataDir, options.aiJobRunner ?? ((input, onResponse) => recognizeEvent({
    ...input,
    apiKey: process.env.OPENROUTER_API_KEY,
    normalModel: process.env.OPENROUTER_OCR_MODEL,
    highModel: process.env.OPENROUTER_OCR_MODEL_HIGH,
    timeoutMs: 10 * 60_000,
    onResponse,
  })));
  let activities: StoredActivity[];
  try {
    const saved = JSON.parse(await readFile(storePath, "utf8"));
    if (!Array.isArray(saved)) throw new Error("Invalid activities.json");
    activities = saved.map((item: unknown) => {
      const raw = object(item);
      if (typeof raw.id !== "string" || !new RegExp(`^${ID_PATTERN}$`).test(raw.id)
        || typeof raw.city !== "string" || typeof raw.createdAt !== "string"
        || typeof raw.updatedAt !== "string" || [raw.posterFilename, raw.cropSourceFilename].some((filename) => filename !== undefined && (typeof filename !== "string" || !/^[a-f0-9-]{36}-[a-f0-9-]{36}\.(jpg|png|webp)$/.test(filename)))) {
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
  // Backfill posters saved before thumbnail support without delaying server startup.
  void (async () => {
    for (const filename of new Set(activities.map((item) => item.posterFilename).filter((name): name is string => !!name))) {
      try { await ensureThumbnail(filename); }
      catch (error) { console.error("Poster thumbnail backfill failed", filename, error); }
    }
  })();

  const groupsPath = join(dataDir, "groups.json");
  const groupsDir = join(dataDir, "groups");
  let library: StoredGroup[] = [];
  try {
    const saved = JSON.parse(await readFile(groupsPath, "utf8"));
    if (!Array.isArray(saved)) throw new Error("Invalid groups.json");
    library = saved.map((item: unknown) => {
      const raw = object(item);
      if (typeof raw.id !== "string" || !new RegExp(`^${ID_PATTERN}$`).test(raw.id)
        || typeof raw.name !== "string" || !canonicalGroupName(raw.name)
        || typeof raw.createdAt !== "string" || typeof raw.updatedAt !== "string"
        || (raw.avatarFilename !== undefined && (typeof raw.avatarFilename !== "string" || !/^[a-f0-9-]{36}\.webp$/.test(raw.avatarFilename))))
        throw new Error("Invalid stored group");
      return raw as unknown as StoredGroup;
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
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
  async function saveGroups(next: StoredGroup[]) {
    const temporary = join(dataDir, `groups-${process.pid}-${randomUUID()}.tmp`);
    await writeFile(temporary, JSON.stringify(next));
    await rename(temporary, groupsPath);
    library = next;
  }
  const boundActivityCount = (id: string) => activities.filter((item) => Object.values(item.groupBindings ?? {}).includes(id)).length;
  function publicGroup(group: StoredGroup): GroupLibraryRecord {
    const { avatarFilename: _avatarFilename, ...rest } = group;
    void _avatarFilename;
    return { ...rest,
      ...(group.avatarFilename ? { avatarUrl: `/api/groups/${group.id}/avatar?v=${group.avatarFilename.slice(0, 36)}` } : {}),
      boundActivityCount: boundActivityCount(group.id),
    };
  }
  function groupFields(input: Record<string, unknown>, currentId?: string) {
    const name = typeof input.name === "string" ? canonicalGroupName(input.name) : "";
    if (!name || name.length > 120) throw new HttpError(400, "团体名称不能为空，且不能超过 120 个字符。");
    if (library.some((group) => group.id !== currentId && groupMatchKey(group.name) === groupMatchKey(name)))
      throw new HttpError(409, "团体库中已存在同名团体。");
    let weiboUid = typeof input.weiboUid === "string" ? input.weiboUid.trim() : "";
    const weiboUrl = typeof input.weiboUrl === "string" ? input.weiboUrl.trim() : "";
    if (weiboUrl && !weiboUid) weiboUid = profileUidFromUrl(weiboUrl);
    if (weiboUid && !/^\d{5,20}$/.test(weiboUid)) throw new HttpError(400, "微博 UID 格式无效。");
    if (weiboUrl && profileUidFromUrl(weiboUrl) !== weiboUid)
      throw new HttpError(400, "微博主页链接与 UID 不一致。");
    if (library.some((group) => group.id !== currentId && weiboUid && group.weiboUid === weiboUid))
      throw new HttpError(409, "该微博 UID 已绑定其他团体。");
    const avatarSourceUrl = typeof input.avatarSourceUrl === "string" ? input.avatarSourceUrl.trim().slice(0, 2048) : "";
    return { name, ...(weiboUid ? { weiboUid } : {}), ...(weiboUrl ? { weiboUrl } : {}),
      ...(avatarSourceUrl ? { avatarSourceUrl } : {}) };
  }
  async function avatarBytes(value: unknown): Promise<Buffer | null> {
    if (value === undefined || value === null) return null;
    const source = posterFrom(value);
    try { return await sharp(source.bytes).rotate().resize(512, 512, { fit: "inside", withoutEnlargement: true }).webp({ quality: 85 }).toBuffer(); }
    catch { throw new HttpError(400, "头像无法处理，请上传有效的 JPG、PNG 或 WebP 图片。"); }
  }
  async function writeAvatar(id: string, bytes: Buffer): Promise<string> {
    const filename = `${randomUUID()}.webp`;
    await mkdir(join(groupsDir, id), { recursive: true });
    await writeFile(join(groupsDir, id, filename), bytes, { flag: "wx" });
    return filename;
  }
  function checkedBindings(value: unknown, data: ActivityRecord["data"]): GroupBindings {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "团体绑定格式无效。");
    const validIds = new Set(data.groups.map((group) => group.id));
    const validGroups = new Set(library.map((group) => group.id));
    const result: GroupBindings = {};
    for (const [eventId, libraryId] of Object.entries(value)) {
      if (!validIds.has(eventId) || typeof libraryId !== "string" || !validGroups.has(libraryId))
        throw new HttpError(400, "团体绑定包含无效的活动团体或团体库 ID。");
      result[eventId] = libraryId;
    }
    return result;
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
  async function writePoster(id: string, value: unknown, thumbnail = false): Promise<string> {
    const image = posterFrom(value);
    const filename = `${id}-${randomUUID()}.${image.extension}`;
    await writeFile(join(posterDir, filename), image.bytes, { flag: "wx" });
    if (thumbnail) {
      try { await ensureThumbnail(filename); }
      catch { await removePoster(filename); throw new HttpError(400, "无法处理海报图片，请重新选择有效图片。"); }
    }
    return filename;
  }
  async function removePoster(filename?: string) {
    if (!filename) return;
    try { await thumbnailJobs.get(filename); } catch { /* cleanup continues after a failed render */ }
    for (const name of [filename, thumbnailName(filename)]) {
      try { await unlink(join(posterDir, name)); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") console.error("Poster cleanup failed", error); }
    }
  }
  async function writeActivityImages(id: string, input: Record<string, unknown>) {
    let posterFilename: string | undefined;
    let cropSourceFilename: string | undefined;
    try {
      if (input.poster !== undefined) posterFilename = await writePoster(id, input.poster, true);
      if (input.cropSource !== undefined) {
        cropSourceFilename = input.cropSource === input.poster && posterFilename
          ? posterFilename : await writePoster(id, input.cropSource);
      }
      return { posterFilename, cropSourceFilename };
    } catch (error) {
      await removePoster(posterFilename);
      if (cropSourceFilename !== posterFilename) await removePoster(cropSourceFilename);
      throw error;
    }
  }
  async function removeUnreferenced(old: StoredActivity, next?: StoredActivity) {
    for (const filename of new Set([old.posterFilename, old.cropSourceFilename])) {
      if (filename && filename !== next?.posterFilename && filename !== next?.cropSourceFilename)
        await removePoster(filename);
    }
  }
  const importLimits = new Map<string, { count: number; until: number }>();
  function limitImport(request: IncomingMessage, kind: "weibo" | "ai") {
    const key = `${sessionId(request)}:${kind}`;
    const current = importLimits.get(key);
    if (current && current.until > Date.now() && current.count >= (kind === "ai" ? 10 : 30))
      throw new HttpError(429, "操作过于频繁，请稍后重试。");
    importLimits.set(key, { count: current && current.until > Date.now() ? current.count + 1 : 1, until: Date.now() + 15 * 60_000 });
  }
  async function aiSource(value: unknown): Promise<AiImage | null> {
    if (value === undefined || value === null) return null;
    const source = object(value);
    if (source.kind === "weibo" && typeof source.importId === "string" && typeof source.imageId === "string") {
      const asset = await weiboStore.asset(source.importId, source.imageId);
      return { bytes: asset.bytes, mime: asset.mime, width: asset.width, height: asset.height };
    }
    if (source.kind === "upload") {
      const picture = posterFrom(source.dataUrl);
      const dimensions = imageSize(picture.bytes);
      if (!dimensions.width || !dimensions.height) throw new HttpError(400, "无法读取图片尺寸。");
      return { bytes: picture.bytes, mime: picture.extension === "jpg" ? "image/jpeg" : `image/${picture.extension}`, width: dimensions.width, height: dimensions.height };
    }
    throw new HttpError(400, "AI 图片来源无效。");
  }
  async function aiJobInput(input: Record<string, unknown>): Promise<AiJobInput> {
    if (input.mode !== "normal" && input.mode !== "high") throw new HttpError(400, "AI 模式无效。");
    if (input.weiboText !== undefined && (typeof input.weiboText !== "string" || input.weiboText.length > 20_000))
      throw new HttpError(400, "微博正文不能超过 20000 字符。");
    if (input.weiboUrl !== undefined && (typeof input.weiboUrl !== "string" || input.weiboUrl.length > 2048 || !/^https:\/\/(?:(?:www\.)?weibo\.com|(?:m\.)?weibo\.cn)\//.test(input.weiboUrl)))
      throw new HttpError(400, "微博来源链接无效。");
    const timetable = await aiSource(input.timetableSource);
    const crop = input.cropSource === undefined || JSON.stringify(input.cropSource) === JSON.stringify(input.timetableSource)
      ? timetable : await aiSource(input.cropSource);
    const cover = input.coverSource === undefined || input.coverSource === null ? null
      : JSON.stringify(input.coverSource) === JSON.stringify(input.timetableSource) ? timetable
      : JSON.stringify(input.coverSource) === JSON.stringify(input.cropSource) ? crop
      : await aiSource(input.coverSource);
    if (!timetable && !(input.weiboText as string | undefined)?.trim())
      throw new AiImportError("AI_SOURCE_REQUIRED", "请选择时间表图片，或提供包含时间表的微博正文。");
    return { timetable, crop, cover, postText: String(input.weiboText ?? ""), sourceUrl: input.weiboUrl as string | undefined, mode: input.mode, debug: input.debug === true };
  }

  return createServer(async (request, response) => {
    try {
      const path = new URL(request.url ?? "/", "http://localhost").pathname;
      const method = request.method ?? "GET";
      if (method === "GET" && path === "/api/health") { sendJson(response, 200, { ok: true, activities: activities.length }); return; }
      if (method === "GET" && path === "/api/activities") { sendJson(response, 200, activities.map(publicActivity)); return; }
      if (method === "GET" && path === "/api/groups") {
        sendJson(response, 200, library.map(publicGroup).sort((a, b) => a.name.localeCompare(b.name, "zh-CN"))); return;
      }
      const groupAvatarPath = new RegExp(`^/api/groups/(${ID_PATTERN})/avatar$`).exec(path);
      if (method === "GET" && groupAvatarPath) {
        const group = library.find((item) => item.id === groupAvatarPath[1]);
        if (!group?.avatarFilename) throw new HttpError(404, "团体头像不存在。");
        await streamImage(response, join(groupsDir, group.id, group.avatarFilename), "image/webp", true);
        return;
      }
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
      const thumbnailPath = new RegExp(`^/api/activities/(${ID_PATTERN})/thumbnail$`).exec(path);
      if (method === "GET" && thumbnailPath) {
        const activity = activities.find((item) => item.id === thumbnailPath[1]);
        if (!activity?.posterFilename) throw new HttpError(404, "海报不存在。");
        await ensureThumbnail(activity.posterFilename);
        await streamImage(response, join(posterDir, thumbnailName(activity.posterFilename)), "image/webp", true);
        return;
      }
      const cropPath = new RegExp(`^/api/activities/(${ID_PATTERN})/crop-source$`).exec(path);
      if (method === "GET" && cropPath) {
        const activity = activities.find((item) => item.id === cropPath[1]);
        const filename = activity?.cropSourceFilename ?? activity?.posterFilename;
        if (!filename) throw new HttpError(404, "团体裁剪原图不存在。");
        const extension = filename.split(".").pop();
        await streamImage(response, join(posterDir, filename), extension === "jpg" ? "image/jpeg" : `image/${extension}`);
        return;
      }
      // Preserve old published group thumbnails for the migrated activity.
      const oldImagePath = /^\/api\/images\/(\d+)\/([a-f0-9]{64})\.(webp|jpg|png)$/.exec(path);
      if (method === "GET" && oldImagePath) {
        await streamImage(response, join(dataDir, "images", oldImagePath[1], `${oldImagePath[2]}.${oldImagePath[3]}`), oldImagePath[3] === "jpg" ? "image/jpeg" : `image/${oldImagePath[3]}`, true);
        return;
      }
      if (method === "GET" && path === "/api/admin/session") { sendJson(response, 200, { authenticated: !!sessionId(request) }); return; }
      if (method === "GET" && path === "/api/admin/ai/status") {
        requireAdmin(request);
        sendJson(response, 200, { configured: !!(process.env.OPENROUTER_API_KEY && process.env.OPENROUTER_OCR_MODEL) }); return;
      }
      if (method === "GET" && path === "/api/admin/ai/jobs") {
        requireAdmin(request);
        sendJson(response, 200, aiJobs.list()); return;
      }
      const aiJobPath = new RegExp(`^/api/admin/ai/jobs/(${ID_PATTERN})$`).exec(path);
      if (method === "GET" && aiJobPath) {
        requireAdmin(request);
        const job = await aiJobs.get(aiJobPath[1]);
        if (!job) throw new HttpError(404, "AI 任务不存在或记录已过期。");
        sendJson(response, 200, job); return;
      }
      const aiJobRawPath = new RegExp(`^/api/admin/ai/jobs/(${ID_PATTERN})/raw$`).exec(path);
      if (method === "GET" && aiJobRawPath) {
        requireAdmin(request);
        const raw = await aiJobs.raw(aiJobRawPath[1]);
        if (!raw) throw new HttpError(404, "AI 原始响应尚未保存或记录已过期。");
        response.writeHead(200, {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          ...(new URL(request.url ?? "/", "http://localhost").searchParams.get("download") === "1"
            ? { "Content-Disposition": `attachment; filename="ai-response-${aiJobRawPath[1]}.txt"` } : {}),
        });
        response.end(raw.body); return;
      }
      const aiJobSourcePath = new RegExp(`^/api/admin/ai/jobs/(${ID_PATTERN})/sources/(timetable|crop|cover)$`).exec(path);
      if (method === "GET" && aiJobSourcePath) {
        requireAdmin(request);
        const source = await aiJobs.source(aiJobSourcePath[1], aiJobSourcePath[2] as "timetable" | "crop" | "cover");
        if (!source) throw new HttpError(404, "AI 任务图片不存在。");
        await streamImage(response, source.filename, source.mime); return;
      }
      const importAssetPath = /^\/api\/admin\/weibo\/import-assets\/([a-f0-9-]{36})\/(image_\d{3})$/.exec(path);
      if (method === "GET" && importAssetPath) {
        requireAdmin(request);
        const asset = await weiboStore.asset(importAssetPath[1], importAssetPath[2]);
        await streamImage(response, asset.filename, asset.mime);
        return;
      }
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
      if (method === "POST" && path === "/api/admin/weibo/parse") {
        limitImport(request, "weibo");
        const input = await readJson(request);
        if (typeof input.url !== "string" || typeof input.cookie !== "string") throw new HttpError(400, "请输入微博链接和 Cookie。");
        try { sendJson(response, 200, await weiboStore.parse(input.url, input.cookie)); }
        catch (error) {
          if (error instanceof WeiboError) throw error;
          throw new WeiboError("WEIBO_REQUEST_FAILED", "微博读取失败，请改用本地上传或手动 JSON。", 502);
        }
        return;
      }
      if (method === "POST" && path === "/api/admin/ai/jobs") {
        limitImport(request, "ai");
        const input = await aiJobInput(await readJson(request));
        sendJson(response, 202, await aiJobs.add(input));
        return;
      }
      if (method === "POST" && path === "/api/admin/ai/parse-poster") {
        limitImport(request, "ai");
        const { timetable, crop, cover, postText, mode, debug } = await aiJobInput(await readJson(request));
        const result = await recognizeEvent({
          timetable, crop, cover, postText, mode, debug,
          apiKey: process.env.OPENROUTER_API_KEY,
          normalModel: process.env.OPENROUTER_OCR_MODEL,
          highModel: process.env.OPENROUTER_OCR_MODEL_HIGH,
        });
        sendJson(response, 200, result);
        return;
      }
      if (method === "POST" && path === "/api/admin/groups/weibo-profile") {
        limitImport(request, "weibo");
        const input = await readJson(request);
        if (typeof input.url !== "string" || typeof input.cookie !== "string") throw new HttpError(400, "请输入微博主页链接和 Cookie。");
        sendJson(response, 200, await fetchWeiboGroupProfile(input.url, input.cookie));
        return;
      }
      if (method === "POST" && path === "/api/admin/groups") {
        const input = await readJson(request);
        const bytes = await avatarBytes(input.avatarDataUrl);
        const result = await exclusive(async () => {
          const fields = groupFields(input);
          const id = randomUUID();
          const now = new Date().toISOString();
          const avatarFilename = bytes ? await writeAvatar(id, bytes) : undefined;
          const group: StoredGroup = { id, ...fields, createdAt: now, updatedAt: now, ...(avatarFilename ? { avatarFilename } : {}) };
          try { await saveGroups([...library, group]); }
          catch (error) { if (avatarFilename) await rm(join(groupsDir, id), { recursive: true, force: true }); throw error; }
          return publicGroup(group);
        });
        sendJson(response, 201, result); return;
      }
      const adminGroupPath = new RegExp(`^/api/admin/groups/(${ID_PATTERN})$`).exec(path);
      if (method === "PATCH" && adminGroupPath) {
        const input = await readJson(request);
        const bytes = await avatarBytes(input.avatarDataUrl);
        const result = await exclusive(async () => {
          const old = library.find((item) => item.id === adminGroupPath[1]);
          if (!old) throw new HttpError(404, "团体不存在或已被删除。");
          const fields = groupFields(input, old.id);
          const avatarFilename = bytes ? await writeAvatar(old.id, bytes) : input.avatarDataUrl === null ? undefined : old.avatarFilename;
          const next: StoredGroup = { id: old.id, ...fields, createdAt: old.createdAt, updatedAt: new Date().toISOString(), ...(avatarFilename ? { avatarFilename } : {}) };
          try { await saveGroups(library.map((item) => item.id === old.id ? next : item)); }
          catch (error) { if (bytes && avatarFilename) await unlink(join(groupsDir, old.id, avatarFilename)); throw error; }
          if (old.avatarFilename && old.avatarFilename !== avatarFilename)
            await unlink(join(groupsDir, old.id, old.avatarFilename)).catch((error) => console.error("Old group avatar cleanup failed", error));
          return publicGroup(next);
        });
        sendJson(response, 200, result); return;
      }
      if (method === "DELETE" && adminGroupPath) {
        await exclusive(async () => {
          const old = library.find((item) => item.id === adminGroupPath[1]);
          if (!old) throw new HttpError(404, "团体不存在或已被删除。");
          const count = boundActivityCount(old.id);
          if (count) throw new HttpError(409, `该团体已被 ${count} 场活动引用，请先解除绑定。`);
          await saveGroups(library.filter((item) => item.id !== old.id));
          await rm(join(groupsDir, old.id), { recursive: true, force: true }).catch((error) => console.error("Group avatar cleanup failed", error));
        });
        sendJson(response, 200, { ok: true }); return;
      }
      if (method === "POST" && path === "/api/admin/activities") {
        const input = await readJson(request);
        const city = cityFrom(input.city);
        const data = checkedEvent(input.data);
        const result = await exclusive(async () => {
          const groupBindings = input.groupBindings === undefined
            ? exactGroupBindings(data.groups, library.map(publicGroup))
            : checkedBindings(input.groupBindings, data);
          const id = randomUUID();
          const now = new Date().toISOString();
          const assets = await writeActivityImages(id, input);
          const activity: StoredActivity = { id, city, data, groupBindings, createdAt: now, updatedAt: now, ...assets };
          try { await save([...activities, activity]); }
          catch (error) { await removeUnreferenced(activity); throw error; }
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
          const groupBindings = input.groupBindings === undefined
            ? Object.fromEntries(Object.entries(old.groupBindings ?? {}).filter(([eventId]) => data.groups.some((group) => group.id === eventId)))
            : checkedBindings(input.groupBindings, data);
          const assets = await writeActivityImages(old.id, input);
          const next = { ...old, city, data, groupBindings, updatedAt: new Date().toISOString(),
            ...(assets.posterFilename ? { posterFilename: assets.posterFilename, images: {} } : {}),
            ...(assets.cropSourceFilename ? { cropSourceFilename: assets.cropSourceFilename, images: {} }
              : assets.posterFilename && old.cropSourceFilename === old.posterFilename
                ? { cropSourceFilename: assets.posterFilename, images: {} } : {}),
          };
          try { await save(activities.map((item) => item.id === old.id ? next : item)); }
          catch (error) { await removeUnreferenced(next, old); throw error; }
          await removeUnreferenced(old, next);
          return publicActivity(next);
        });
        sendJson(response, 200, result); return;
      }
      if (method === "DELETE" && adminActivityPath) {
        await exclusive(async () => {
          const old = activities.find((item) => item.id === adminActivityPath[1]);
          if (!old) throw new HttpError(404, "活动不存在或已被删除。");
          await save(activities.filter((item) => item.id !== old.id));
          await removeUnreferenced(old);
        });
        sendJson(response, 200, { ok: true }); return;
      }
      throw new HttpError(404, "接口不存在。");
    } catch (error) {
      const status = error instanceof HttpError || error instanceof WeiboError || error instanceof AiImportError ? error.status : 500;
      if (status === 500) console.error(error);
      if (!response.headersSent) sendJson(response, status, error instanceof WeiboError || error instanceof AiImportError
        ? { error: { code: error.code, message: error.message } }
        : { error: status === 500 ? "服务器操作失败，请稍后重试。" : (error as Error).message });
    }
  });
}
