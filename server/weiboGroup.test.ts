import { expect, it, vi } from "vitest";
import sharp from "sharp";
import { fetchWeiboGroupProfile, profileUidFromUrl } from "./weibo";

it("accepts only a numeric UID on an official Weibo profile URL", () => {
  expect(profileUidFromUrl("https://weibo.com/u/6436923951")).toBe("6436923951");
  expect(() => profileUidFromUrl("https://example.com/u/6436923951")).toThrow();
  expect(() => profileUidFromUrl("https://weibo.com/6436923951/5348786965578976")).toThrow();
});

it("returns editable profile data and a resized cached-avatar draft", async () => {
  const source = await sharp({ create: { width: 900, height: 700, channels: 3, background: "#f072ae" } }).png().toBuffer();
  const mockFetch = vi.fn(async (url: URL) => {
    if (url.hostname === "m.weibo.cn") return new Response(JSON.stringify({ data: { userInfo: {
      id: 6436923951, screen_name: "云梦CloudDream_Official", avatar_hd: "https://tvax1.sinaimg.cn/large/avatar.jpg",
    } } }), { status: 200, headers: { "content-type": "application/json" } });
    return new Response(new Uint8Array(source), { status: 200, headers: { "content-type": "image/png" } });
  }) as unknown as typeof fetch;
  const result = await fetchWeiboGroupProfile("https://weibo.com/u/6436923951", "SUB=private", mockFetch);
  expect(result.name).toBe("云梦CloudDream_Official");
  expect(result.weiboUid).toBe("6436923951");
  expect(result.weiboUrl).toBe("https://weibo.com/u/6436923951");
  expect(result.avatarDataUrl).toMatch(/^data:image\/webp;base64,/);
  const metadata = await sharp(Buffer.from(result.avatarDataUrl!.split(",")[1], "base64")).metadata();
  expect(metadata.width).toBeLessThanOrEqual(512);
  expect(metadata.height).toBeLessThanOrEqual(512);
});
