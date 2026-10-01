import { afterAll, beforeAll, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Server } from "node:http";
import { demoData } from "../src/data/demo";
import { createActivitiesServer } from "./activitiesServer";

let directory: string;
let server: Server;
let base: string;
let cookie = "";
const key = "test-admin-access-key";
const secret = "test-admin-session-secret-with-at-least-32-characters";
const image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLytQAAAABJRU5ErkJggg==";

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
  expect((await request("/api/admin/login", "POST", { key: "wrong" })).status).toBe(401);
  const login = await request("/api/admin/login", "POST", { key });
  expect(login.status).toBe(200);
  cookie = login.headers.get("set-cookie")!.split(";")[0];
  expect(cookie).toContain("admin_session=");
  expect((await (await request("/api/admin/session")).json()).authenticated).toBe(true);
});

it("creates, validates, replaces poster, and deletes without exposing disk paths", async () => {
  const createdResponse = await request("/api/admin/activities", "POST", { city: "上海", data: demoData, poster: image });
  expect(createdResponse.status).toBe(201);
  const created = await createdResponse.json();
  expect(created.posterUrl).toMatch(new RegExp(`^/api/activities/${created.id}/poster\\?v=`));
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

it("keeps the migrated event after restart and invalidates logout cookie", async () => {
  const saved = JSON.parse(await readFile(join(directory, "activities.json"), "utf8"));
  expect(saved).toHaveLength(1);
  await new Promise<void>((done) => server.close(() => done()));
  await listen();
  expect((await (await request("/api/activities")).json())).toHaveLength(1);
  expect((await request("/api/admin/logout", "POST")).status).toBe(200);
  expect((await (await request("/api/admin/session")).json()).authenticated).toBe(false);
});
