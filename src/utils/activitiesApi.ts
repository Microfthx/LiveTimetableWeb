import type { ActivityRecord } from "../types/activity";
import type { EventData, PosterSource } from "../types/timetable";

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) { super(message); }
}

async function request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      headers: method === "GET" ? undefined : {
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "无法连接服务器，请稍后重试。");
  }
  let result: T & { error?: string | { code: string; message: string } };
  try { result = await response.json(); }
  catch { throw new ApiError(response.status, "服务器返回了无效响应。"); }
  if (!response.ok) throw new ApiError(response.status,
    typeof result.error === "object" ? result.error.message : result.error ?? "服务器操作失败，请重试。",
    typeof result.error === "object" ? result.error.code : undefined);
  return result;
}

export const listActivities = () => request<ActivityRecord[]>("/api/activities");
export const getActivity = (id: string) => request<ActivityRecord>(`/api/activities/${encodeURIComponent(id)}`);
export const adminSession = () => request<{ authenticated: boolean }>("/api/admin/session");
export const adminLogin = (key: string) => request<{ authenticated: boolean }>("/api/admin/login", "POST", { key });
export const adminLogout = () => request<{ authenticated: boolean }>("/api/admin/logout", "POST");

export function posterDataUrl(poster: PosterSource): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("读取海报失败，请重新选择图片。"));
    reader.readAsDataURL(poster.file);
  });
}

export async function createActivity(city: string, data: EventData, poster?: PosterSource | null, cropSource?: PosterSource | null) {
  const displayData = poster ? await posterDataUrl(poster) : undefined;
  return request<ActivityRecord>("/api/admin/activities", "POST", {
    city, data,
    ...(displayData ? { poster: displayData } : {}),
    ...(cropSource && cropSource !== poster ? { cropSource: await posterDataUrl(cropSource) } : {}),
  });
}

export async function updateActivity(id: string, city: string, data: EventData, poster?: PosterSource | null, cropSource?: PosterSource | null) {
  return request<ActivityRecord>(`/api/admin/activities/${encodeURIComponent(id)}`, "PATCH", {
    city, data,
    ...(poster ? { poster: await posterDataUrl(poster) } : {}),
    ...(cropSource ? { cropSource: await posterDataUrl(cropSource) } : {}),
  });
}

export const deleteActivity = (id: string) => request<{ ok: boolean }>(`/api/admin/activities/${encodeURIComponent(id)}`, "DELETE");

export interface WeiboImportPost {
  id: string;
  url: string;
  author: { name: string; avatar?: string };
  created_at: string;
  text: string;
  repost_text?: string;
  importId: string;
  images: { id: string; local_url: string; width: number; height: number }[];
  warnings: string[];
}

export type AiSource =
  | { kind: "weibo"; importId: string; imageId: string }
  | { kind: "upload"; poster: PosterSource };

async function sourcePayload(source: AiSource | null) {
  if (!source) return undefined;
  return source.kind === "weibo"
    ? { kind: "weibo", importId: source.importId, imageId: source.imageId }
    : { kind: "upload", dataUrl: await posterDataUrl(source.poster) };
}

export const aiStatus = () => request<{ configured: boolean }>("/api/admin/ai/status");
export const parseWeibo = (url: string, cookie: string) => request<WeiboImportPost>("/api/admin/weibo/parse", "POST", { url, cookie });
export async function recognizeTimetable(input: {
  timetableSource: AiSource | null;
  cropSource: AiSource | null;
  coverSource?: AiSource | null;
  weiboText: string;
  mode: "normal" | "high";
}) {
  return request<{ data: EventData; city: string; warnings: string[]; model: string; mode: "normal" | "high" }>(
    "/api/admin/ai/parse-poster", "POST", {
      timetableSource: await sourcePayload(input.timetableSource),
      cropSource: input.cropSource === input.timetableSource ? undefined : await sourcePayload(input.cropSource),
      coverSource: input.coverSource && input.coverSource !== input.timetableSource && input.coverSource !== input.cropSource
        ? await sourcePayload(input.coverSource) : undefined,
      weiboText: input.weiboText,
      mode: input.mode,
    },
  );
}
