import type { EventData } from "../types/timetable";
import type { RuntimeGroupImages } from "./poster";
import { validateEventData } from "./validation";

const ADMIN_KEY = "live-idol-admin-key";

export interface SharedState {
  revision: number;
  data: EventData;
  images: RuntimeGroupImages;
  requires_auth: boolean;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function loadAdminKey(): string {
  try {
    return localStorage.getItem(ADMIN_KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveAdminKey(key: string): void {
  localStorage.setItem(ADMIN_KEY, key);
}

export function clearAdminKey(): void {
  localStorage.removeItem(ADMIN_KEY);
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  adminKey = "",
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      cache: "no-store",
      headers: {
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(adminKey ? { "X-Admin-Token": adminKey } : {}),
      },
    });
  } catch {
    throw new ApiError(0, "无法连接服务器，请检查网络后重试。");
  }
  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new ApiError(
      response.status,
      payload.error ?? "服务器操作失败，请重试。",
    );
  }
  return payload;
}

function normalizedState(state: SharedState): SharedState {
  return { ...state, data: validateEventData(state.data) };
}

export async function fetchSharedState(): Promise<SharedState> {
  return normalizedState(await request<SharedState>("/api/state"));
}

export async function verifyAdminKey(key: string): Promise<void> {
  await request<{ ok: boolean }>("/api/auth", {}, key);
}

export async function setSharedDelay(
  change: { delta: number } | { value: number },
  adminKey: string,
): Promise<SharedState> {
  return normalizedState(
    await request<SharedState>(
      "/api/delay",
      { method: "PATCH", body: JSON.stringify(change) },
      adminKey,
    ),
  );
}

function blobUrlAsDataUrl(url: string): Promise<string> {
  return fetch(url)
    .then((response) => {
      if (!response.ok) throw new Error("读取裁剪图片失败。");
      return response.blob();
    })
    .then(
      (blob) =>
        new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error("读取裁剪图片失败。"));
          reader.readAsDataURL(blob);
        }),
    );
}

export async function publishSharedEvent(
  data: EventData,
  images: RuntimeGroupImages,
  revision: number,
  adminKey: string,
): Promise<SharedState> {
  const encodedImages: Record<string, string> = {};
  for (const [id, url] of Object.entries(images)) {
    encodedImages[id] = await blobUrlAsDataUrl(url);
  }
  return normalizedState(
    await request<SharedState>(
      "/api/event",
      {
        method: "PUT",
        body: JSON.stringify({ revision, data, images: encodedImages }),
      },
      adminKey,
    ),
  );
}

export async function resetSharedEvent(adminKey: string): Promise<SharedState> {
  return normalizedState(
    await request<SharedState>("/api/reset", { method: "POST" }, adminKey),
  );
}
