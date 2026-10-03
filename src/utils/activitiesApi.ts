import type { ActivityRecord } from "../types/activity";
import type { EventData, PosterSource } from "../types/timetable";
import type { GroupBindings, GroupLibraryRecord, WeiboGroupPreview } from "../types/groupLibrary";

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

export const listGroups = () => request<GroupLibraryRecord[]>("/api/groups");
export const importWeiboGroupProfile = (url: string, cookie: string) =>
  request<WeiboGroupPreview>("/api/admin/groups/weibo-profile", "POST", { url, cookie });
export interface GroupDraft {
  name: string;
  aliases?: string[];
  weiboUid?: string;
  weiboUrl?: string;
  avatarSourceUrl?: string;
  avatarDataUrl?: string | null;
}
export const createGroup = (draft: GroupDraft) => request<GroupLibraryRecord>("/api/admin/groups", "POST", draft);
export const updateGroup = (id: string, draft: GroupDraft) => request<GroupLibraryRecord>(`/api/admin/groups/${encodeURIComponent(id)}`, "PATCH", draft);
export const deleteGroup = (id: string) => request<{ ok: boolean }>(`/api/admin/groups/${encodeURIComponent(id)}`, "DELETE");

export async function createActivity(city: string, data: EventData, poster?: PosterSource | null, cropSource?: PosterSource | null, groupBindings?: GroupBindings) {
  const displayData = poster ? await posterDataUrl(poster) : undefined;
  return request<ActivityRecord>("/api/admin/activities", "POST", {
    city, data, groupBindings,
    ...(displayData ? { poster: displayData } : {}),
    ...(cropSource && cropSource !== poster ? { cropSource: await posterDataUrl(cropSource) } : {}),
  });
}

export async function updateActivity(id: string, city: string, data: EventData, poster?: PosterSource | null, cropSource?: PosterSource | null, groupBindings?: GroupBindings) {
  return request<ActivityRecord>(`/api/admin/activities/${encodeURIComponent(id)}`, "PATCH", {
    city, data, groupBindings,
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

export interface AiJobSummary {
  id: string;
  status: "queued" | "running" | "completed" | "failed";
  mode: "normal" | "high";
  sourceUrl?: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  queuePosition: number;
  hasRawResponse: boolean;
  rawComplete?: boolean;
  upstreamStatus?: number;
  requestId?: string | null;
  model?: string;
  provider?: string;
  finishReason?: string;
  outputTokens?: number;
  reasoningTokens?: number;
  error?: { code: string; message: string };
}
export interface AiJobDetail extends AiJobSummary {
  postText: string;
  sources: Record<"timetable" | "crop" | "cover", { url: string; width: number; height: number; mime: string } | null>;
  result?: { data: EventData; city: string; warnings: string[]; model: string; mode: "normal" | "high"; debug?: import("../types/aiCropDebug").AiCropDebugData };
}

async function sourcePayload(source: AiSource | null) {
  if (!source) return undefined;
  return source.kind === "weibo"
    ? { kind: "weibo", importId: source.importId, imageId: source.imageId }
    : { kind: "upload", dataUrl: await posterDataUrl(source.poster) };
}

export const aiStatus = () => request<{ configured: boolean }>("/api/admin/ai/status");
export const parseWeibo = (url: string, cookie: string) => request<WeiboImportPost>("/api/admin/weibo/parse", "POST", { url, cookie });
export const listAiJobs = () => request<AiJobSummary[]>("/api/admin/ai/jobs");
export const getAiJob = (id: string) => request<AiJobDetail>(`/api/admin/ai/jobs/${encodeURIComponent(id)}`);
export const getAiJobRaw = async (id: string) => {
  const response = await fetch(`/api/admin/ai/jobs/${encodeURIComponent(id)}/raw`, { credentials: "same-origin", cache: "no-store" });
  if (!response.ok) throw new ApiError(response.status, "AI 原始响应暂不可读取。");
  return response.text();
};
export interface AiRecognitionRequest {
  timetableSource: AiSource | null;
  cropSource: AiSource | null;
  coverSource?: AiSource | null;
  weiboText: string;
  weiboUrl?: string;
  mode: "normal" | "high";
  debug?: boolean;
}

async function recognitionPayload(input: AiRecognitionRequest) {
  return {
    timetableSource: await sourcePayload(input.timetableSource),
    cropSource: input.cropSource === input.timetableSource ? undefined : await sourcePayload(input.cropSource),
    coverSource: input.coverSource && input.coverSource !== input.timetableSource && input.coverSource !== input.cropSource
      ? await sourcePayload(input.coverSource) : undefined,
    weiboText: input.weiboText,
    weiboUrl: input.weiboUrl,
    mode: input.mode,
    debug: input.debug === true,
  };
}

export async function recognizeTimetable(input: AiRecognitionRequest) {
  return request<{ data: EventData; city: string; warnings: string[]; model: string; mode: "normal" | "high"; debug?: import("../types/aiCropDebug").AiCropDebugData }>(
    "/api/admin/ai/parse-poster", "POST", await recognitionPayload(input),
  );
}

export async function submitAiJob(input: AiRecognitionRequest) {
  return request<AiJobSummary>("/api/admin/ai/jobs", "POST", await recognitionPayload(input));
}
