import { afterAll, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { aiInputParts, recognizeEvent, EVENT_DATA_SCHEMA } from "./aiImport";
import { createWeiboStore, parseCookieHeader, postIdFromUrl } from "./weibo";

const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLytQAAAABJRU5ErkJggg==",
  "base64",
);
const folders: string[] = [];
afterAll(async () => {
  for (const folder of folders) {
    if (!resolve(folder).startsWith(resolve(tmpdir(), "smart-import-test-")))
      throw new Error("Unsafe test cleanup path");
    await rm(folder, { recursive: true, force: true });
  }
});

it("accepts Cookie values containing equals and rejects non-post URLs", () => {
  expect(parseCookieHeader("SUB=abc==; SUBP=xy=z; invalid; SINAGLOBAL=1")).toBe(
    "SUB=abc==; SUBP=xy=z; SINAGLOBAL=1",
  );
  expect(postIdFromUrl("https://m.weibo.cn/detail/1234567890123")).toBe(
    "1234567890123",
  );
  expect(() => postIdFromUrl("http://127.0.0.1/detail/1234567890123")).toThrow(
    "仅支持微博官方",
  );
  expect(() => postIdFromUrl("https://weibo.com/home")).toThrow("单条微博");
});

it("reads only the target post text and images into authenticated local assets", async () => {
  const directory = await mkdtemp(join(tmpdir(), "smart-import-test-"));
  folders.push(directory);
  const visited: string[] = [];
  const fakeFetch = (async (input: URL | RequestInfo) => {
    const url = String(input);
    visited.push(url);
    if (url.includes("statuses/show"))
      return new Response(
        JSON.stringify({
          ok: 1,
          data: {
            id: 1234567890123,
            text: "14:00 Gara<br/>14:20 Koisa &amp; friends",
            user: { screen_name: "海报发布者" },
            created_at: "Fri Oct 02 12:00:00 +0800 2026",
            pics: [
              { large: { url: "https://wx1.sinaimg.cn/large/one.png" } },
              { url: "https://wx2.sinaimg.cn/large/two.png" },
            ],
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    return new Response(tinyPng, {
      status: 200,
      headers: { "Content-Type": "image/png" },
    });
  }) as typeof fetch;
  const store = createWeiboStore(directory, fakeFetch);
  const post = await store.parse(
    "https://m.weibo.cn/detail/1234567890123",
    "SUB=secret==",
  );
  expect(post.text).toBe("14:00 Gara\n14:20 Koisa & friends");
  expect(post.images).toHaveLength(2);
  expect(post.images[0].local_url).toContain(post.importId);
  expect((await store.asset(post.importId, post.images[0].id)).bytes).toEqual(
    tinyPng,
  );
  expect(visited).toHaveLength(3);
  expect(
    visited.every(
      (url) =>
        url.startsWith("https://m.weibo.cn/") || url.includes("sinaimg.cn"),
    ),
  ).toBe(true);
});

it("rejects redirects outside the official Weibo hosts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "smart-import-test-"));
  folders.push(directory);
  const fakeFetch = (async () =>
    new Response(null, {
      status: 302,
      headers: { Location: "http://127.0.0.1/internal" },
    })) as typeof fetch;
  const store = createWeiboStore(directory, fakeFetch);
  await expect(
    store.parse("https://m.weibo.cn/detail/1234567890123", "SUB=secret"),
  ).rejects.toMatchObject({ code: "WEIBO_INVALID_URL" });
});

it("uses text alone, a shared image once, or two explicitly labeled images", async () => {
  const picture = { bytes: tinyPng, mime: "image/png", width: 1, height: 1 };
  expect(aiInputParts(null, null, "14:00 Gara")).toHaveLength(1);
  expect(
    aiInputParts(picture, picture, "").filter(
      (part) => part.type === "input_image",
    ),
  ).toHaveLength(1);
  expect(
    aiInputParts(picture, { ...picture }, "正文").filter(
      (part) => part.type === "input_image",
    ),
  ).toHaveLength(2);
  const labeled = JSON.stringify(aiInputParts(picture, { ...picture }, "正文"));
  expect(labeled).toContain("IMAGE A = TIMETABLE SOURCE");
  expect(labeled).toContain("IMAGE B = GROUP VISUAL / CROP SOURCE");
  expect(JSON.stringify(EVENT_DATA_SCHEMA)).not.toContain("city");
  await expect(
    recognizeEvent({
      timetable: null,
      crop: null,
      postText: "14:00 Gara",
      mode: "normal",
    }),
  ).rejects.toMatchObject({ code: "AI_NOT_CONFIGURED" });
});
