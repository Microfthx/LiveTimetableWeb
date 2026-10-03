import { afterAll, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { aiInputParts, recognizeEvent, AI_IMPORT_SCHEMA, EVENT_DATA_SCHEMA } from "./aiImport";
import {
  createWeiboStore,
  parseCookieHeader,
  postIdFromUrl,
  postPictures,
} from "./weibo";

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

it("uses pic_ids when pics is empty and retries another size if the large image fails", async () => {
  expect(
    postPictures({
      pics: [],
      pic_ids: ["abc"],
      pic_infos: {
        abc: { large: { url: "https://wx1.sinaimg.cn/large/abc.jpg" } },
      },
    }),
  ).toHaveLength(1);
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
            text: "14:00 Gara",
            pic_ids: ["abc"],
            pics: [],
            pic_infos: {
              abc: {
                large: { url: "https://wx1.sinaimg.cn/large/abc.jpg" },
                original: { url: "https://wx1.sinaimg.cn/original/abc.jpg" },
              },
            },
          },
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    if (url.includes("/large/")) return new Response(null, { status: 403 });
    return new Response(tinyPng, { headers: { "Content-Type": "image/png" } });
  }) as typeof fetch;
  const store = createWeiboStore(directory, fakeFetch);
  const post = await store.parse(
    "https://m.weibo.cn/detail/1234567890123",
    "SUB=secret",
  );
  expect(post.images).toHaveLength(1);
  expect(post.warnings).toEqual([]);
  expect(visited).toContain("https://wx1.sinaimg.cn/original/abc.jpg");
});

it("uses a matching desktop post for images when the mobile detail has none", async () => {
  const directory = await mkdtemp(join(tmpdir(), "smart-import-test-"));
  folders.push(directory);
  const fakeFetch = (async (input: URL | RequestInfo) => {
    const url = String(input);
    if (url.includes("m.weibo.cn/api/statuses/show"))
      return new Response(
        JSON.stringify({
          ok: 1,
          data: { id: 1234567890123, text: "14:00 Gara", pics: [] },
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    if (url.includes("weibo.com/ajax/statuses/show"))
      return new Response(
        JSON.stringify({
          id: 1234567890123,
          pic_infos: {
            abc: { large: { url: "https://wx1.sinaimg.cn/large/abc.png" } },
          },
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    return new Response(tinyPng, { headers: { "Content-Type": "image/png" } });
  }) as typeof fetch;
  const store = createWeiboStore(directory, fakeFetch);
  const post = await store.parse(
    "https://m.weibo.cn/detail/1234567890123",
    "SUB=secret",
  );
  expect(post.text).toBe("14:00 Gara");
  expect(post.images).toHaveLength(1);
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
      (part) => part.type === "image_url",
    ),
  ).toHaveLength(1);
  expect(
    aiInputParts(picture, { ...picture }, "正文").filter(
      (part) => part.type === "image_url",
    ),
  ).toHaveLength(2);
  expect(
    aiInputParts(null, null, "正文时间表", picture).filter(
      (part) => part.type === "image_url",
    ),
  ).toHaveLength(1);
  expect(JSON.stringify(aiInputParts(null, null, "正文时间表", picture)))
    .toContain("IMAGE C = ACTIVITY POSTER / CITY CONTEXT");
  expect(
    aiInputParts(picture, picture, "", picture).filter(
      (part) => part.type === "image_url",
    ),
  ).toHaveLength(1);
  const labeled = JSON.stringify(aiInputParts(picture, { ...picture }, "正文"));
  expect(labeled).toContain("IMAGE A = TIMETABLE SOURCE");
  expect(labeled).toContain("IMAGE B = GROUP VISUAL / CROP SOURCE");
  expect(JSON.stringify(EVENT_DATA_SCHEMA)).not.toContain("city");
  expect(AI_IMPORT_SCHEMA.properties.city).toEqual({ type: "string" });
  expect(AI_IMPORT_SCHEMA.required).toContain("city");
  expect(EVENT_DATA_SCHEMA.properties.groups.items.required).toContain("benefit_type");
  expect(EVENT_DATA_SCHEMA.properties.groups.items.required).toContain("benefit_time_start");
  await expect(
    recognizeEvent({
      timetable: null,
      crop: null,
      postText: "14:00 Gara",
      mode: "normal",
    }),
  ).rejects.toMatchObject({ code: "AI_NOT_CONFIGURED" });
});

it("recognizes city beside EventData in one strict OpenRouter request", async () => {
  const picture = { bytes: tinyPng, mime: "image/png", width: 1, height: 1 };
  const requests: Array<{ url: string; headers: Headers; body: Record<string, unknown> }> = [];
  const fakeFetch = (async (url: URL | RequestInfo, init?: RequestInit) => {
    requests.push({
      url: String(url),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    return new Response(JSON.stringify({
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify({
        schema_version: "1.0",
        city: "厦门",
        event: { title: "测试活动", date: "2026-10-02", venue: "测试场地", doors_time: "", start_time: "14:00" },
        delay_minutes: 0,
        poster: { width: 0, height: 0 },
        groups: [{ id: "group_001", name: "Gara", start_time: "14:00", end_time: "14:20", benefit_type: "normal", benefit_time_start: "14:30", benefit_time_end: "15:00", crop: { x: 0, y: 0, width: 1, height: 1 } }],
      }) } }],
      usage: { prompt_tokens: 10, completion_tokens: 20 },
    }), { headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  const result = await recognizeEvent({
    timetable: picture, crop: picture, cover: { ...picture }, postText: "14:00 Gara", mode: "normal",
    apiKey: "test-secret", normalModel: "google/gemini-2.5-flash", fetchImpl: fakeFetch,
  });
  expect(requests).toHaveLength(1);
  expect(requests[0].url).toBe("https://openrouter.ai/api/v1/chat/completions");
  expect(requests[0].headers.get("Authorization")).toBe("Bearer test-secret");
  expect(requests[0].body.model).toBe("google/gemini-2.5-flash");
  expect(requests[0].body.response_format).toMatchObject({ type: "json_schema", json_schema: { strict: true, schema: AI_IMPORT_SCHEMA } });
  expect(requests[0].body.provider).toEqual({ require_parameters: true });
  const content = (requests[0].body.messages as Array<{ content: Array<{ type: string; text?: string }> }>)[1].content;
  expect(content.filter((part) => part.type === "image_url")).toHaveLength(2);
  expect(JSON.stringify(content)).toContain("IMAGE C = ACTIVITY POSTER / CITY CONTEXT");
  expect(JSON.stringify(requests[0].body)).not.toContain("test-secret");
  expect(result.data.poster).toEqual({ width: 1, height: 1 });
  expect(result.data.groups[0].name).toBe("Gara");
  expect(result.data.groups[0].benefit_time_start).toBe("14:30");
  expect(result.city).toBe("厦门");
  expect(result.data).not.toHaveProperty("city");
});

it("reports OpenRouter credit errors without changing import data", async () => {
  const fakeFetch = (async () => new Response("{}", { status: 402 })) as typeof fetch;
  await expect(recognizeEvent({
    timetable: null, crop: null, postText: "14:00 Gara", mode: "normal",
    apiKey: "test-secret", normalModel: "google/gemini-2.5-flash", fetchImpl: fakeFetch,
  })).rejects.toMatchObject({ code: "AI_CREDITS_REQUIRED", message: "OpenRouter 额度不足，请检查账户余额。" });
});

it("distinguishes a provider restriction from an invalid OpenRouter key", async () => {
  const fakeFetch = (async () => new Response(JSON.stringify({ error: {
    code: 403,
    message: "The request is prohibited due to a violation of provider Terms Of Service.",
  } }), { status: 403 })) as typeof fetch;
  await expect(recognizeEvent({
    timetable: null, crop: null, postText: "14:00 Gara", mode: "normal",
    apiKey: "test-secret", normalModel: "openai/gpt-5.6-luna", fetchImpl: fakeFetch,
  })).rejects.toMatchObject({
    code: "AI_PROVIDER_RESTRICTED",
    message: "OpenRouter 拒绝访问所选模型，请检查账户或模型提供方的访问限制。",
  });
});
