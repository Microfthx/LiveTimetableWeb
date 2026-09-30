import { afterAll, beforeAll, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Server } from "node:http";
import { createSharedServer } from "./sharedServer";

let directory: string;
let server: Server;
let base: string;
const key = "test-admin-secret";

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "live-idol-test-"));
  server = await createSharedServer({ dataDir: directory, writeToken: key });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test port");
  base = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()));
  if (!resolve(directory).startsWith(resolve(tmpdir(), "live-idol-test-"))) {
    throw new Error("Unsafe test cleanup path");
  }
  await rm(directory, { recursive: true, force: true });
});

const request = (path: string, method = "GET", body?: unknown, token = key) =>
  fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { "X-Admin-Token": token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

it("shares delay and event data, guards writes, and persists cropped images", async () => {
  const initial = await (await request("/api/state")).json();
  expect(initial.revision).toBe(1);
  expect(initial.requires_auth).toBe(true);
  expect((await request("/api/delay", "PATCH", { delta: 5 }, "")).status).toBe(
    401,
  );
  expect((await request("/api/auth")).status).toBe(200);

  const changed = await (
    await request("/api/delay", "PATCH", { delta: 5 })
  ).json();
  expect(changed.data.delay_minutes).toBe(5);
  expect(changed.data.groups[0].start_time).toBe(
    initial.data.groups[0].start_time,
  );
  expect(
    (
      await request("/api/event", "PUT", {
        revision: 1,
        data: initial.data,
        images: {},
      })
    ).status,
  ).toBe(409);

  const image =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLytQAAAABJRU5ErkJggg==";
  const data = {
    ...changed.data,
    event: { ...changed.data.event, title: "Shared Test" },
  };
  const published = await (
    await request("/api/event", "PUT", {
      revision: changed.revision,
      data,
      images: { group_001: image },
    })
  ).json();
  expect(published.data.event.title).toBe("Shared Test");
  expect(published.images.group_001).toMatch(/^\/api\/images\//);
  expect((await request(published.images.group_001)).status).toBe(200);

  await new Promise<void>((done) => server.close(() => done()));
  server = await createSharedServer({ dataDir: directory, writeToken: key });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test port");
  base = `http://127.0.0.1:${address.port}`;
  const restored = await (await request("/api/state")).json();
  expect(restored.data.event.title).toBe("Shared Test");
  expect(restored.images.group_001).toBe(published.images.group_001);
});
