import type { CropRegion } from "./timetable.js";

export interface AiCropDebugGroup {
  id: string;
  name: string;
  rawCrop: unknown;
}

export interface AiCropDebugData {
  groups: AiCropDebugGroup[];
  aiInput: {
    dataUrl: string | null;
    width: number;
    height: number;
    mime: string | null;
    sha256: string | null;
    resize: boolean;
    aspectRatioPreserved: boolean;
    padding: boolean;
    centerCrop: boolean;
    objectFitOrCssCrop: boolean;
  };
}

/** Debug overlays only accept a complete numeric crop; the returned rawCrop is never changed. */
export function debugCrop(value: unknown): CropRegion | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if ([item.x, item.y, item.width, item.height].some((part) => typeof part !== "number" || !Number.isFinite(part))) return null;
  return value as CropRegion;
}
