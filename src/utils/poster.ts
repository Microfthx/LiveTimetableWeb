import type { CropRegion, EventData, PosterSource } from "../types/timetable";

export type RuntimeGroupImages = Record<string, string>;

const SUPPORTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("海报读取失败，请重新选择图片。"));
    image.src = url;
  });
}

export async function readPoster(file: File): Promise<PosterSource> {
  if (!SUPPORTED_TYPES.has(file.type))
    throw new Error("仅支持 JPG、PNG 和 WebP 海报。");
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url);
    if (!image.naturalWidth || !image.naturalHeight)
      throw new Error("海报读取失败，请重新选择图片。");
    return {
      file,
      url,
      width: image.naturalWidth,
      height: image.naturalHeight,
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

export function posterRatioDifference(
  data: EventData,
  poster: PosterSource,
): number | null {
  if (!data.poster.width || !data.poster.height) return null;
  const jsonRatio = data.poster.width / data.poster.height;
  const actualRatio = poster.width / poster.height;
  return Math.abs(jsonRatio - actualRatio) / actualRatio;
}

export function hasUsableCrop(data: EventData): boolean {
  return data.groups.some(
    (group) => !!group.crop?.width && !!group.crop.height,
  );
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

export async function cropImageFromPoster(
  image: HTMLImageElement,
  crop: CropRegion,
): Promise<Blob> {
  const sx = crop.x * image.naturalWidth;
  const sy = crop.y * image.naturalHeight;
  const sw = crop.width * image.naturalWidth;
  const sh = crop.height * image.naturalHeight;
  if (sw <= 0 || sh <= 0) throw new Error("图片裁剪区域为空。");
  const scale = Math.min(1, 512 / Math.max(sw, sh));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sw * scale));
  canvas.height = Math.max(1, Math.round(sh * scale));
  try {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("浏览器无法创建裁剪画布。");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    const webp = await canvasToBlob(canvas, "image/webp", 0.85);
    if (webp?.type === "image/webp") return webp;
    const jpeg = await canvasToBlob(canvas, "image/jpeg", 0.88);
    if (jpeg) return jpeg;
    throw new Error("浏览器无法导出裁剪图片。");
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

export async function cropGroupImages(
  data: EventData,
  poster: PosterSource,
  onProgress?: (done: number, total: number) => void,
): Promise<{ images: RuntimeGroupImages; failed: string[] }> {
  const image = await loadImage(poster.url);
  const images: RuntimeGroupImages = {};
  const failed: string[] = [];
  const total = data.groups.length;
  for (const [index, group] of data.groups.entries()) {
    if (group.crop?.width && group.crop.height) {
      try {
        const blob = await cropImageFromPoster(image, group.crop);
        images[group.id] = URL.createObjectURL(blob);
      } catch {
        failed.push(group.name);
      }
    }
    onProgress?.(index + 1, total);
    if (index % 3 === 2)
      await new Promise((resolve) => window.setTimeout(resolve, 0));
  }
  return { images, failed };
}

export function revokeRuntimeImages(images: RuntimeGroupImages): void {
  Object.values(images).forEach((url) => {
    if (url.startsWith("blob:")) URL.revokeObjectURL(url);
  });
}
