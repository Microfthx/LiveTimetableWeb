import type { ActivityRecord } from "../types/activity";
import type { EventData, PosterSource } from "../types/timetable";

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
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
  let result: T & { error?: string };
  try { result = await response.json(); }
  catch { throw new ApiError(response.status, "服务器返回了无效响应。"); }
  if (!response.ok) throw new ApiError(response.status, result.error ?? "服务器操作失败，请重试。");
  return result;
}

export const listActivities = () => request<ActivityRecord[]>("/api/activities");
export const getActivity = (id: string) => request<ActivityRecord>(`/api/activities/${encodeURIComponent(id)}`);
export const adminSession = () => request<{ authenticated: boolean }>("/api/admin/session");
export const adminLogin = (key: string) => request<{ authenticated: boolean }>("/api/admin/login", "POST", { key });
export const adminLogout = () => request<{ authenticated: boolean }>("/api/admin/logout", "POST");

function posterDataUrl(poster: PosterSource): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("读取海报失败，请重新选择图片。"));
    reader.readAsDataURL(poster.file);
  });
}

export async function createActivity(city: string, data: EventData, poster?: PosterSource | null) {
  return request<ActivityRecord>("/api/admin/activities", "POST", {
    city, data,
    ...(poster ? { poster: await posterDataUrl(poster) } : {}),
  });
}

export async function updateActivity(id: string, city: string, data: EventData, poster?: PosterSource | null) {
  return request<ActivityRecord>(`/api/admin/activities/${encodeURIComponent(id)}`, "PATCH", {
    city, data,
    ...(poster ? { poster: await posterDataUrl(poster) } : {}),
  });
}

export const deleteActivity = (id: string) => request<{ ok: boolean }>(`/api/admin/activities/${encodeURIComponent(id)}`, "DELETE");
