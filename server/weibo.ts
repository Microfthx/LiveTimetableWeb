import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { imageSize } from "image-size";

const UUID = /^[a-f0-9-]{36}$/;
const IMAGE_ID = /^image_\d{3}$/;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_REDIRECTS = 3;

export class WeiboError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export interface WeiboImage {
  id: string;
  local_url: string;
  width: number;
  height: number;
}

export interface WeiboPost {
  id: string;
  url: string;
  author: { name: string; avatar?: string };
  created_at: string;
  text: string;
  repost_text?: string;
  images: WeiboImage[];
  warnings: string[];
  importId: string;
}

export function parseCookieHeader(raw: string): string {
  if (raw.length > 8192)
    throw new WeiboError(
      "WEIBO_COOKIE_INVALID",
      "微博 Cookie 过长，请只粘贴 Cookie Header。",
    );
  return raw
    .split(";")
    .map((part) => {
      const at = part.indexOf("=");
      if (at < 1) return "";
      const key = part.slice(0, at).trim();
      const value = part.slice(at + 1).trim();
      return /^[A-Za-z0-9_\-]+$/.test(key) && value && !/[\r\n]/.test(value)
        ? `${key}=${value}`
        : "";
    })
    .filter(Boolean)
    .join("; ");
}

function officialHost(hostname: string): boolean {
  return ["weibo.com", "www.weibo.com", "m.weibo.cn", "weibo.cn"].includes(
    hostname,
  );
}

export function postIdFromUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new WeiboError("WEIBO_INVALID_URL", "请输入具体单条微博链接。");
  }
  if (url.protocol !== "https:" || !officialHost(url.hostname.toLowerCase()))
    throw new WeiboError(
      "WEIBO_INVALID_URL",
      "仅支持微博官方 HTTPS 单条博文链接。",
    );
  const parts = url.pathname.split("/").filter(Boolean);
  const id =
    url.searchParams.get("id") &&
    /^(detail|status|statuses)$/.test(parts[0] ?? "")
      ? url.searchParams.get("id")!
      : parts[0] === "detail" ||
          parts[0] === "status" ||
          parts[0] === "statuses"
        ? parts[1]
        : parts.length === 2
          ? parts[1]
          : undefined;
  if (!id || !/^[A-Za-z0-9]{5,24}$/.test(id))
    throw new WeiboError(
      "WEIBO_INVALID_URL",
      "请提供单条微博的详情链接，不能使用主页或时间线。",
    );
  if (
    !/^\d+$/.test(id) &&
    parts.length === 2 &&
    parts[0] !== "detail" &&
    parts[0] !== "status" &&
    parts[0] !== "statuses"
  ) {
    const alphabet =
      "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const chunks: string[] = [];
    for (let end = id.length; end > 0; end -= 4) {
      const part = id.slice(Math.max(0, end - 4), end);
      let number = 0n;
      for (const character of part) {
        const digit = alphabet.indexOf(character);
        if (digit < 0)
          throw new WeiboError(
            "WEIBO_INVALID_URL",
            "微博链接包含无效的博文 ID。",
          );
        number = number * 62n + BigInt(digit);
      }
      chunks.unshift(number.toString().padStart(end > 4 ? 7 : 1, "0"));
    }
    return chunks.join("");
  }
  return id;
}

function decodeText(html: unknown): string {
  if (typeof html !== "string") return "";
  return html
    .replace(/<img\b[^>]*\balt=["']([^"']*)["'][^>]*>/gi, "$1")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/(?:p|div)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(
      /&(#(?:x[0-9a-f]+|\d+)|amp|lt|gt|quot|apos|nbsp);/gi,
      (_all, entity: string) => {
        const named: Record<string, string> = {
          amp: "&",
          lt: "<",
          gt: ">",
          quot: '"',
          apos: "'",
          nbsp: " ",
        };
        if (entity[0] !== "#") return named[entity.toLowerCase()] ?? "";
        const code =
          entity[1].toLowerCase() === "x"
            ? Number.parseInt(entity.slice(2), 16)
            : Number(entity.slice(1));
        return Number.isInteger(code) && code > 0 && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : "";
      },
    )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function imageHost(hostname: string): boolean {
  return hostname === "sinaimg.cn" || hostname.endsWith(".sinaimg.cn");
}

function checkedImageUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.startsWith("//") ? `https:${raw}` : raw);
  } catch {
    throw new WeiboError("WEIBO_IMAGE_FAILED", "微博图片地址无效。");
  }
  if (!imageHost(url.hostname.toLowerCase()))
    throw new WeiboError(
      "WEIBO_IMAGE_FAILED",
      "微博图片地址不在允许的图片域名内。",
    );
  if (url.protocol === "http:") url.protocol = "https:";
  if (url.protocol !== "https:")
    throw new WeiboError("WEIBO_IMAGE_FAILED", "微博图片地址协议无效。");
  return url;
}

function pictureUrls(item: unknown): string[] {
  if (typeof item === "string")
    return /^https?:\/\/|^\/\//.test(item) ? [item] : [];
  if (!item || typeof item !== "object") return [];
  const picture = item as Record<string, unknown>;
  const urls = [
    "large",
    "original",
    "largest",
    "bmiddle",
    "middle",
    "thumbnail",
    "url",
  ]
    .map((key) => {
      const value = picture[key];
      if (typeof value === "string") return value;
      if (value && typeof value === "object") {
        const nested = value as Record<string, unknown>;
        return typeof nested.url === "string" ? nested.url : "";
      }
      return "";
    })
    .filter(Boolean);
  return [...new Set(urls)];
}

export function postPictures(data: Record<string, unknown>): string[][] {
  const info =
    data.pic_infos &&
    typeof data.pic_infos === "object" &&
    !Array.isArray(data.pic_infos)
      ? (data.pic_infos as Record<string, unknown>)
      : {};
  const ids = Array.isArray(data.pic_ids)
    ? data.pic_ids.map(String)
    : Object.keys(info);
  const pics = Array.isArray(data.pics) ? data.pics : [];
  const count = Math.max(pics.length, ids.length);
  const pictures: string[][] = [];
  for (let index = 0; index < count; index += 1) {
    const item = pics[index];
    const id =
      typeof item === "string"
        ? item
        : (ids[index] ??
          (item && typeof item === "object"
            ? String((item as Record<string, unknown>).pid ?? "")
            : ""));
    pictures.push([
      ...new Set([...pictureUrls(item), ...pictureUrls(info[id])]),
    ]);
  }
  return pictures;
}

async function safeFetch(
  url: URL,
  headers: HeadersInit,
  allowed: (host: string) => boolean,
  fetchFn: typeof fetch,
): Promise<Response> {
  for (let count = 0; count <= MAX_REDIRECTS; count += 1) {
    if (url.protocol !== "https:" || !allowed(url.hostname.toLowerCase()))
      throw new WeiboError(
        "WEIBO_INVALID_URL",
        "微博资源重定向到不受支持的地址。",
      );
    const response = await fetchFn(url, {
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(20_000),
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    await response.body?.cancel().catch(() => undefined);
    if (!location) break;
    const next = new URL(location, url);
    if (/passport|login/i.test(next.hostname + next.pathname))
      throw new WeiboError(
        "WEIBO_COOKIE_EXPIRED",
        "微博 Cookie 已失效，请重新获取 Cookie。",
        401,
      );
    if (/security|verify|captcha/i.test(next.hostname + next.pathname))
      throw new WeiboError(
        "WEIBO_VERIFICATION_REQUIRED",
        "微博要求人工验证，请在微博完成验证后重试。",
        403,
      );
    url = next;
  }
  throw new WeiboError("WEIBO_REQUEST_FAILED", "微博重定向次数过多。");
}

async function limitedBytes(response: Response): Promise<Buffer> {
  if (Number(response.headers.get("content-length")) > MAX_IMAGE_BYTES)
    throw new WeiboError("WEIBO_IMAGE_FAILED", "图片超过 20 MB。");
  if (!response.body)
    throw new WeiboError("WEIBO_IMAGE_FAILED", "图片内容为空。");
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of response.body) {
    total += chunk.length;
    if (total > MAX_IMAGE_BYTES) {
      await response.body.cancel().catch(() => undefined);
      throw new WeiboError("WEIBO_IMAGE_FAILED", "图片超过 20 MB。");
    }
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function checkedImage(bytes: Buffer): {
  mime: string;
  extension: string;
  width: number;
  height: number;
} {
  const info = imageSize(bytes);
  const extension = info.type === "jpeg" ? "jpg" : info.type;
  if (
    !extension ||
    !["jpg", "png", "webp"].includes(extension) ||
    !info.width ||
    !info.height
  )
    throw new WeiboError("WEIBO_IMAGE_FAILED", "微博图片格式不受支持。");
  return {
    mime: extension === "jpg" ? "image/jpeg" : `image/${extension}`,
    extension,
    width: info.width,
    height: info.height,
  };
}

export function createWeiboStore(
  dataDir: string,
  fetchFn: typeof fetch = fetch,
) {
  const root = resolve(dataDir, "tmp", "weibo-import");
  const safeDir = (importId: string) => {
    if (!UUID.test(importId))
      throw new WeiboError(
        "WEIBO_IMPORT_EXPIRED",
        "微博素材已失效，请重新获取。",
        404,
      );
    const dir = resolve(root, importId);
    if (!dir.startsWith(root + sep))
      throw new WeiboError("WEIBO_IMPORT_EXPIRED", "微博素材路径无效。", 404);
    return dir;
  };
  async function cleanup() {
    await mkdir(root, { recursive: true });
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !UUID.test(entry.name)) continue;
      const dir = safeDir(entry.name);
      if (Date.now() - (await stat(dir)).mtimeMs > 24 * 60 * 60_000)
        await rm(dir, { recursive: true, force: true });
    }
  }
  const cleanupTimer = setInterval(() => {
    void cleanup().catch(() => undefined);
  }, 60 * 60_000);
  cleanupTimer.unref();
  async function parse(rawUrl: string, rawCookie: string): Promise<WeiboPost> {
    const id = postIdFromUrl(rawUrl);
    const cookie = parseCookieHeader(rawCookie);
    if (!cookie)
      throw new WeiboError("WEIBO_COOKIE_REQUIRED", "请输入微博 Cookie。", 400);
    await cleanup();
    const headers = {
      Cookie: cookie,
      Accept: "application/json, text/plain, */*",
      Referer: "https://m.weibo.cn/",
      "User-Agent": "Mozilla/5.0 (compatible; LiveIdolTimetable/1.0)",
    };
    const response = await safeFetch(
      new URL(
        `https://m.weibo.cn/api/statuses/show?id=${encodeURIComponent(id)}`,
      ),
      headers,
      officialHost,
      fetchFn,
    );
    if (response.status === 401 || response.status === 403)
      throw new WeiboError(
        "WEIBO_COOKIE_EXPIRED",
        "微博 Cookie 已失效，请重新获取 Cookie。",
        401,
      );
    if (!response.ok)
      throw new WeiboError(
        "WEIBO_REQUEST_FAILED",
        "微博读取失败，请稍后重试。",
        502,
      );
    if (response.headers.get("content-type")?.includes("text/html"))
      throw new WeiboError(
        "WEIBO_COOKIE_EXPIRED",
        "微博返回了登录页面，请更新 Cookie 后重试。",
        401,
      );
    let result: unknown;
    try {
      result = await response.json();
    } catch {
      throw new WeiboError(
        "WEIBO_REQUEST_FAILED",
        "微博返回了无法解析的内容。",
        502,
      );
    }
    const envelope = result as Record<string, unknown>;
    const data = (envelope.data ?? envelope) as Record<string, unknown>;
    if (envelope.ok === 0 || !data || typeof data !== "object" || !data.id)
      throw new WeiboError(
        "WEIBO_COOKIE_EXPIRED",
        "无法读取该微博，请检查 Cookie 或博文可见性。",
        401,
      );
    const author = (data.user ?? {}) as Record<string, unknown>;
    let longText = data.longText as Record<string, unknown> | undefined;
    if (data.isLongText && !longText?.longTextContent) {
      try {
        const extended = await safeFetch(
          new URL(
            `https://m.weibo.cn/statuses/extend?id=${encodeURIComponent(String(data.id))}`,
          ),
          headers,
          officialHost,
          fetchFn,
        );
        if (extended.ok) {
          const payload = (await extended.json()) as {
            data?: { longTextContent?: string };
          };
          if (payload.data?.longTextContent)
            longText = { longTextContent: payload.data.longTextContent };
        }
      } catch {
        /* Keep visible text when the long-text endpoint is unavailable. */
      }
    }
    let pictures = postPictures(data);
    if (pictures.every((urls) => urls.length === 0)) {
      try {
        const alternate = await safeFetch(
          new URL(
            `https://weibo.com/ajax/statuses/show?id=${encodeURIComponent(id)}`,
          ),
          {
            ...headers,
            Referer: "https://weibo.com/",
            "X-Requested-With": "XMLHttpRequest",
          },
          officialHost,
          fetchFn,
        );
        if (
          alternate.ok &&
          !alternate.headers.get("content-type")?.includes("text/html")
        ) {
          const payload = (await alternate.json()) as Record<string, unknown>;
          const detail = (payload.data ?? payload) as Record<string, unknown>;
          if (
            String(detail.idstr ?? detail.id ?? detail.mid) ===
            String(data.idstr ?? data.id)
          ) {
            const alternatePictures = postPictures(detail);
            if (alternatePictures.some((urls) => urls.length > 0))
              pictures = alternatePictures;
          }
        }
      } catch {
        /* The mobile response remains usable when the optional image fallback fails. */
      }
    }
    const importId = randomUUID();
    const dir = safeDir(importId);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const images: WeiboImage[] = [];
    const warnings: string[] = [];
    const manifest: Record<
      string,
      { filename: string; mime: string; width: number; height: number }
    > = {};
    for (const [index, candidates] of pictures.entries()) {
      if (candidates.length === 0) {
        warnings.push(`图 ${index + 1} 缺少图片地址。`);
        continue;
      }
      let saved = false;
      let reason = "下载失败";
      for (const candidate of candidates) {
        try {
          const imageUrl = checkedImageUrl(candidate);
          const downloaded = await safeFetch(
            imageUrl,
            {
              Referer: "https://m.weibo.cn/",
              "User-Agent": headers["User-Agent"],
              Accept: "image/webp,image/png,image/jpeg,*/*;q=0.5",
            },
            imageHost,
            fetchFn,
          );
          if (!downloaded.ok)
            throw new WeiboError(
              "WEIBO_IMAGE_FAILED",
              `HTTP ${downloaded.status}`,
            );
          const bytes = await limitedBytes(downloaded);
          const info = checkedImage(bytes);
          const imageId = `image_${String(index + 1).padStart(3, "0")}`;
          const filename = `${imageId}.${info.extension}`;
          await writeFile(join(dir, filename), bytes, {
            flag: "wx",
            mode: 0o600,
          });
          manifest[imageId] = {
            filename,
            mime: info.mime,
            width: info.width,
            height: info.height,
          };
          images.push({
            id: imageId,
            local_url: `/api/admin/weibo/import-assets/${importId}/${imageId}`,
            width: info.width,
            height: info.height,
          });
          saved = true;
          break;
        } catch (cause) {
          reason = cause instanceof WeiboError ? cause.message : "下载失败";
        }
      }
      if (!saved)
        warnings.push(`图 ${index + 1} ${reason}，其他素材仍可使用。`);
    }
    if (pictures.length === 0 && Number(data.pic_num) > 0)
      warnings.push(
        "微博表示含有图片，但详情接口未返回图片地址；请尝试本地上传图片。",
      );
    await writeFile(join(dir, "manifest.json"), JSON.stringify(manifest), {
      mode: 0o600,
    });
    const repost = data.retweeted_status as Record<string, unknown> | undefined;
    return {
      id: String(data.idstr ?? data.id),
      url: rawUrl,
      author: {
        name: String(author.screen_name ?? "未知作者"),
        ...(typeof author.profile_image_url === "string"
          ? { avatar: author.profile_image_url }
          : {}),
      },
      created_at: String(data.created_at ?? ""),
      text: decodeText(longText?.longTextContent ?? data.text),
      ...(repost ? { repost_text: decodeText(repost.text) } : {}),
      images,
      warnings,
      importId,
    };
  }
  async function asset(importId: string, imageId: string) {
    if (!IMAGE_ID.test(imageId))
      throw new WeiboError("WEIBO_IMPORT_EXPIRED", "微博图片不存在。", 404);
    const dir = safeDir(importId);
    let manifest: Record<
      string,
      { filename: string; mime: string; width: number; height: number }
    >;
    try {
      manifest = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8"));
    } catch {
      throw new WeiboError(
        "WEIBO_IMPORT_EXPIRED",
        "微博素材已失效，请重新获取。",
        404,
      );
    }
    const item = manifest[imageId];
    if (
      !item ||
      !new RegExp(`^${imageId}\\.(jpg|png|webp)$`).test(item.filename)
    )
      throw new WeiboError("WEIBO_IMPORT_EXPIRED", "微博图片不存在。", 404);
    return {
      bytes: await readFile(join(dir, item.filename)),
      mime: item.mime,
      width: item.width,
      height: item.height,
      filename: join(dir, item.filename),
    };
  }
  return { parse, asset, cleanup };
}
