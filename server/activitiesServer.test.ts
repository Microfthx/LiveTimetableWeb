import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { mkdtemp, readFile, readdir, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Server } from "node:http";
import sharp from "sharp";
import { demoData } from "../src/data/demo";
import { createActivitiesServer } from "./activitiesServer";

let directory: string;
let server: Server;
let base: string;
let cookie = "";
const key = "test-admin-access-key";
const secret = "test-admin-session-secret-with-at-least-32-characters";
let image: string;
let otherImage: string;

async function listen() {
  server = await createActivitiesServer({ dataDir: directory, adminAccessKey: key, adminSessionSecret: secret });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test port");
  base = `http://127.0.0.1:${address.port}`;
}

const request = (path: string, method = "GET", body?: unknown, authenticated = true) => fetch(`${base}${path}`, {
  method,
  headers: {
    ...(method !== "GET" ? { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" } : {}),
    ...(authenticated && cookie ? { Cookie: cookie } : {}),
  },
  body: body === undefined ? undefined : JSON.stringify(body),
});

beforeAll(async () => {
  image = `data:image/png;base64,${(await sharp({ create: { width: 2, height: 2, channels: 3, background: "red" } }).png().toBuffer()).toString("base64")}`;
  otherImage = `data:image/png;base64,${(await sharp({ create: { width: 2, height: 2, channels: 3, background: "blue" } }).png().toBuffer()).toString("base64")}`;
  directory = await mkdtemp(join(tmpdir(), "live-idol-activities-test-"));
  await writeFile(join(directory, "state.json"), JSON.stringify({ revision: 3, data: demoData, images: {} }));
  await listen();
});

afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()));
  if (!resolve(directory).startsWith(resolve(tmpdir(), "live-idol-activities-test-"))) throw new Error("Unsafe test cleanup path");
  await rm(directory, { recursive: true, force: true });
});

it("migrates the old shared event and blocks unauthenticated writes", async () => {
  const records = await (await request("/api/activities")).json();
  expect(records).toHaveLength(1);
  expect(records[0].data.event.title).toBe(demoData.event.title);
  expect(records[0].city).toBe("未设置");
  expect((await request(`/api/admin/activities/${records[0].id}`, "DELETE", undefined, false)).status).toBe(401);
  expect((await request("/api/admin/activities", "POST", { city: "上海", data: demoData }, false)).status).toBe(401);
  expect((await request("/api/admin/weibo/parse", "POST", { url: "https://m.weibo.cn/detail/1234567890123", cookie: "SUB=test" }, false)).status).toBe(401);
  expect((await request("/api/admin/ai/parse-poster", "POST", { mode: "normal", weiboText: "14:00 Gara" }, false)).status).toBe(401);
  expect((await request("/api/admin/ai/jobs", "POST", { mode: "normal", weiboText: "14:00 Gara" }, false)).status).toBe(401);
  expect((await request("/api/admin/ai/jobs", "GET", undefined, false)).status).toBe(401);
  expect((await request("/api/admin/ai/jobs/11111111-1111-4111-8111-111111111111/raw", "GET", undefined, false)).status).toBe(401);
  expect((await request("/api/admin/login", "POST", { key: "wrong" })).status).toBe(401);
  const login = await request("/api/admin/login", "POST", { key });
  expect(login.status).toBe(200);
  cookie = login.headers.get("set-cookie")!.split(";")[0];
  expect(cookie).toContain("admin_session=");
  expect((await (await request("/api/admin/session")).json()).authenticated).toBe(true);
  expect((await request("/api/admin/ai/jobs")).status).toBe(200);
  expect((await request("/api/admin/ai/jobs", "POST", { mode: "invalid", weiboText: "14:00 Gara" })).status).toBe(400);
});

it("returns a job ID immediately and protects saved AI output behind admin auth", async () => {
  const jobDir = await mkdtemp(join(tmpdir(), "live-idol-ai-queue-test-"));
  const rawBody = '{"choices":[{"message":{"content":"saved"}}]}';
  const jobServer = await createActivitiesServer({
    dataDir: jobDir, adminAccessKey: key, adminSessionSecret: secret,
    aiJobRunner: async (_input, onResponse) => {
      await onResponse({ status: 200, contentType: "application/json", requestId: "test-request", body: rawBody, complete: true });
      return { data: demoData, city: "厦门", warnings: [], model: "test-model", mode: "normal" };
    },
  });
  try {
    await new Promise<void>((done) => jobServer.listen(0, "127.0.0.1", done));
    const address = jobServer.address();
    if (!address || typeof address === "string") throw new Error("No test port");
    const endpoint = `http://127.0.0.1:${address.port}`;
    const headers = { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" };
    const login = await fetch(`${endpoint}/api/admin/login`, { method: "POST", headers, body: JSON.stringify({ key }) });
    const adminCookie = login.headers.get("set-cookie")!.split(";")[0];
    const created = await fetch(`${endpoint}/api/admin/ai/jobs`, {
      method: "POST", headers: { ...headers, Cookie: adminCookie },
      body: JSON.stringify({ mode: "normal", weiboText: "14:00 Gara", weiboUrl: "https://weibo.com/123/456" }),
    });
    expect(created.status).toBe(202);
    const { id } = await created.json();
    expect(id).toMatch(/^[a-f0-9-]{36}$/);
    const rawUrl = `${endpoint}/api/admin/ai/jobs/${id}/raw`;
    expect((await fetch(rawUrl)).status).toBe(401);
    await vi.waitFor(async () => {
      const response = await fetch(`${endpoint}/api/admin/ai/jobs/${id}`, { headers: { Cookie: adminCookie } });
      expect(response.status).toBe(200);
      const job = await response.json();
      expect(job.status).toBe("completed");
      expect(job.result.data.event.title).toBe(demoData.event.title);
      expect(job.hasRawResponse).toBe(true);
      expect(job.sourceUrl).toBe("https://weibo.com/123/456");
    });
    const saved = await fetch(rawUrl, { headers: { Cookie: adminCookie } });
    expect(saved.status).toBe(200);
    expect(await saved.text()).toBe(rawBody);
  } finally {
    await new Promise<void>((done) => jobServer.close(() => done()));
    if (!resolve(jobDir).startsWith(resolve(tmpdir(), "live-idol-ai-queue-test-"))) throw new Error("Unsafe test cleanup path");
    await rm(jobDir, { recursive: true, force: true });
  }
});

it("persists separate display and crop assets while keeping old poster fallback", async () => {
  const createdResponse = await request("/api/admin/activities", "POST", { city: "福州", data: demoData, poster: image, cropSource: otherImage });
  expect(createdResponse.status).toBe(201);
  const created = await createdResponse.json();
  expect(created.cropSourceSeparate).toBe(true);
  expect(created.posterUrl).toContain("/poster");
  expect(created.cropSourceUrl).toContain("/crop-source");
  expect((await request(created.posterUrl)).status).toBe(200);
  expect((await request(created.cropSourceUrl)).status).toBe(200);
  expect(JSON.stringify(created)).not.toContain("cropSourceFilename");
  const replacement = await request(`/api/admin/activities/${created.id}`, "PATCH", { city: "福州", data: demoData, cropSource: image });
  expect(replacement.status).toBe(200);
  const replacedCover = await request(`/api/admin/activities/${created.id}`, "PATCH", { city: "福州", data: demoData, poster: otherImage });
  expect(replacedCover.status).toBe(200);
  const after = await (await request(`/api/activities/${created.id}`)).json();
  expect(after.posterUrl).toBeDefined();
  expect(after.cropSourceSeparate).toBe(true);
  expect((await request(after.cropSourceUrl)).status).toBe(200);
  expect((await request(`/api/admin/activities/${created.id}`, "DELETE")).status).toBe(200);
  expect((await request(created.cropSourceUrl)).status).toBe(404);
});

it("creates, validates, replaces poster, and deletes without exposing disk paths", async () => {
  const createdResponse = await request("/api/admin/activities", "POST", { city: "上海", data: demoData, poster: image });
  expect(createdResponse.status).toBe(201);
  const created = await createdResponse.json();
  expect(created.posterUrl).toMatch(new RegExp(`^/api/activities/${created.id}/poster\\?v=`));
  expect(created.cropSourceUrl).toContain(`/api/activities/${created.id}/crop-source`);
  expect(created.cropSourceSeparate).toBe(false);
  expect(JSON.stringify(created)).not.toContain("posterFilename");
  expect((await request(created.posterUrl)).status).toBe(200);
  const invalid = await request(`/api/admin/activities/${created.id}`, "PATCH", { city: "上海", data: { ...demoData, groups: [] } });
  expect(invalid.status).toBe(400);
  expect((await (await request(`/api/activities/${created.id}`)).json()).data.groups).toHaveLength(demoData.groups.length);
  const changed = { ...demoData, event: { ...demoData.event, title: "修改后的活动" } };
  const edited = await (await request(`/api/admin/activities/${created.id}`, "PATCH", { city: "厦门", data: changed, poster: image })).json();
  expect(edited.city).toBe("厦门");
  expect(edited.data.event.title).toBe("修改后的活动");
  expect(edited.posterUrl).not.toBe(created.posterUrl);
  expect((await request(edited.posterUrl)).status).toBe(200);
  expect((await request(`/api/admin/activities/${created.id}`, "DELETE")).status).toBe(200);
  expect((await request(`/api/activities/${created.id}`)).status).toBe(404);
  expect((await request(edited.posterUrl)).status).toBe(404);
});

it("serves persisted WebP cover thumbnails and regenerates missing old thumbnails", async () => {
  const original = await sharp({ create: { width: 1200, height: 1600, channels: 3, background: "#d9438a" } }).png().toBuffer();
  const createdResponse = await request("/api/admin/activities", "POST", {
    city: "杭州", data: demoData, poster: `data:image/png;base64,${original.toString("base64")}`,
  });
  expect(createdResponse.status).toBe(201);
  const created = await createdResponse.json();
  expect(created.thumbnailUrl).toMatch(new RegExp(`^/api/activities/${created.id}/thumbnail\\?v=`));
  expect(JSON.stringify(created)).not.toContain("thumb.webp");
  const metadataOnly = await (await request(`/api/admin/activities/${created.id}`, "PATCH", { city: "苏州", data: demoData })).json();
  expect(metadataOnly.thumbnailUrl).toBe(created.thumbnailUrl);
  expect(metadataOnly.posterUrl).toBe(created.posterUrl);
  const thumbnailResponse = await request(created.thumbnailUrl);
  expect(thumbnailResponse.status).toBe(200);
  expect(thumbnailResponse.headers.get("content-type")).toBe("image/webp");
  expect(thumbnailResponse.headers.get("cache-control")).toContain("immutable");
  const thumbnail = Buffer.from(await thumbnailResponse.arrayBuffer());
  const metadata = await sharp(thumbnail).metadata();
  expect(metadata.width).toBe(320);
  expect(metadata.height).toBeLessThanOrEqual(480);
  expect(thumbnail.length).toBeLessThan(original.length);
  const posterDir = join(directory, "posters");
  const thumbnailFilename = (await readdir(posterDir)).find((name) => name.startsWith(created.id) && name.endsWith(".thumb.webp"));
  expect(thumbnailFilename).toBeDefined();
  await unlink(join(posterDir, thumbnailFilename!));
  await new Promise<void>((done) => server.close(() => done()));
  await listen();
  const regenerated = await request(created.thumbnailUrl);
  expect(regenerated.status).toBe(200);
  expect(Buffer.from(await regenerated.arrayBuffer())).toEqual(thumbnail);
  expect(await readdir(posterDir)).toContain(thumbnailFilename);
  const login = await request("/api/admin/login", "POST", { key });
  cookie = login.headers.get("set-cookie")!.split(";")[0];
  expect((await request(`/api/admin/activities/${created.id}`, "DELETE")).status).toBe(200);
  expect((await readdir(posterDir)).filter((name) => name.startsWith(created.id))).toEqual([]);
});

it("keeps group avatars server-side, exact matches new events, and protects referenced groups", async () => {
  const name = demoData.groups[0].name;
  expect((await request("/api/admin/groups", "POST", { name }, false)).status).toBe(401);
  expect((await request("/api/admin/groups/weibo-profile", "POST", { url: "https://weibo.com/u/123456789", cookie: "SUB=test" }, false)).status).toBe(401);
  const createdResponse = await request("/api/admin/groups", "POST", { name, avatarDataUrl: image });
  expect(createdResponse.status).toBe(201);
  const group = await createdResponse.json();
  expect(group.avatarUrl).toContain(`/api/groups/${group.id}/avatar`);
  const avatar = await request(group.avatarUrl);
  expect(avatar.status).toBe(200);
  expect(avatar.headers.get("content-type")).toBe("image/webp");
  expect((await sharp(Buffer.from(await avatar.arrayBuffer())).metadata()).format).toBe("webp");
  expect(JSON.stringify(group)).not.toContain("avatarFilename");
  expect((await request("/api/admin/groups", "POST", { name: ` ${name} ` })).status).toBe(409);
  expect((await request("/api/admin/groups", "POST", { name: `-${name}-` })).status).toBe(409);
  expect((await request("/api/admin/groups", "POST", { name: name.toUpperCase() })).status).toBe(409);
  await new Promise<void>((done) => server.close(() => done()));
  await listen();
  expect((await (await request("/api/groups")).json()).some((item: { id: string }) => item.id === group.id)).toBe(true);
  cookie = (await request("/api/admin/login", "POST", { key })).headers.get("set-cookie")!.split(";")[0];
  const activityResponse = await request("/api/admin/activities", "POST", { city: "上海", data: demoData });
  expect(activityResponse.status).toBe(201);
  const activity = await activityResponse.json();
  expect(activity.groupBindings[demoData.groups[0].id]).toBe(group.id);
  expect((await request(`/api/admin/groups/${group.id}`, "DELETE")).status).toBe(409);
  expect((await request(`/api/admin/groups/${group.id}`, "PATCH", { name, avatarDataUrl: null })).status).toBe(200);
  expect((await request(group.avatarUrl)).status).toBe(404);
  expect((await request(`/api/admin/activities/${activity.id}`, "PATCH", { city: "上海", data: demoData, groupBindings: {} })).status).toBe(200);
  expect((await request(`/api/admin/groups/${group.id}`, "DELETE")).status).toBe(200);
  expect((await request(`/api/admin/activities/${activity.id}`, "DELETE")).status).toBe(200);
});

it("matches simplified and traditional group names without changing either display name", async () => {
  const createdGroup = await request("/api/admin/groups", "POST", { name: "夢境契約" });
  expect(createdGroup.status).toBe(201);
  const libraryGroup = await createdGroup.json();
  expect((await request("/api/admin/groups", "POST", { name: "梦境契约" })).status).toBe(409);
  const data = { ...demoData, groups: demoData.groups.map((group, index) =>
    index === 0 ? { ...group, name: "梦境契约" } : group) };
  const createdActivity = await request("/api/admin/activities", "POST", { city: "上海", data });
  expect(createdActivity.status).toBe(201);
  const activity = await createdActivity.json();
  expect(activity.groupBindings[data.groups[0].id]).toBe(libraryGroup.id);
  expect(activity.data.groups[0].name).toBe("梦境契约");
  expect((await (await request("/api/groups")).json()).find((group: { id: string }) => group.id === libraryGroup.id).name).toBe("夢境契約");
  expect((await request(`/api/admin/activities/${activity.id}`, "DELETE")).status).toBe(200);
  expect((await request(`/api/admin/groups/${libraryGroup.id}`, "DELETE")).status).toBe(200);
});

it("stores editable aliases and binds bracketed event names without changing OCR data", async () => {
  const created = await request("/api/admin/groups", "POST", { name: "電波TOXIC", aliases: ["Toxic"] });
  expect(created.status).toBe(201);
  const libraryGroup = await created.json();
  expect(libraryGroup.aliases).toEqual(["Toxic"]);
  expect((await request("/api/admin/groups", "POST", { name: "Another", aliases: ["toxic"] })).status).toBe(409);
  expect((await request("/api/admin/groups", "POST", { name: "Another", aliases: "toxic" })).status).toBe(400);
  const data = { ...demoData, groups: demoData.groups.map((group, index) =>
    index === 0 ? { ...group, name: "Toxic（武汉）" } : group) };
  const activityResponse = await request("/api/admin/activities", "POST", { city: "武汉", data });
  expect(activityResponse.status).toBe(201);
  const activity = await activityResponse.json();
  expect(activity.groupBindings[data.groups[0].id]).toBe(libraryGroup.id);
  expect(activity.data.groups[0].name).toBe("Toxic（武汉）");
  const updated = await request(`/api/admin/groups/${libraryGroup.id}`, "PATCH", { name: "電波TOXIC", aliases: ["Toxic", "Dianbo Toxic"] });
  expect(updated.status).toBe(200);
  expect((await updated.json()).aliases).toEqual(["Toxic", "Dianbo Toxic"]);
  expect((await request(`/api/admin/activities/${activity.id}`, "DELETE")).status).toBe(200);
  expect((await request(`/api/admin/groups/${libraryGroup.id}`, "DELETE")).status).toBe(200);
});

it("keeps the migrated event after restart and invalidates logout cookie", async () => {
  const saved = JSON.parse(await readFile(join(directory, "activities.json"), "utf8"));
  expect(saved).toHaveLength(1);
  await new Promise<void>((done) => server.close(() => done()));
  await listen();
  expect((await (await request("/api/activities")).json())).toHaveLength(1);
  expect((await request("/api/admin/logout", "POST")).status).toBe(200);
  expect((await (await request("/api/admin/session")).json()).authenticated).toBe(false);
});
