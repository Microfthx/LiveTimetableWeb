// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cropImageFromPoster } from "./poster";

afterEach(() => vi.restoreAllMocks());

it("uses natural image pixels for Canvas crop even when displayed size differs", async () => {
  const image = document.createElement("img");
  image.width = 100;
  image.height = 200;
  Object.defineProperty(image, "naturalWidth", { value: 1000 });
  Object.defineProperty(image, "naturalHeight", { value: 2000 });
  const drawImage = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => ({
    fillRect: vi.fn(), drawImage, fillStyle: "",
  }) as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => {
    callback(new Blob(["crop"], { type: "image/webp" }));
  });
  await cropImageFromPoster(image, { x: 0.1, y: 0.55, width: 0.3, height: 0.2 });
  expect(drawImage).toHaveBeenCalledWith(image, 100, 1100, 300, 400, 0, 0, 300, 400);
});
