import type { EventData } from "./timetable.js";

/** Website metadata wraps the unchanged OCR v1.0 EventData. */
export interface ActivityRecord {
  id: string;
  city: string;
  posterUrl?: string;
  data: EventData;
  createdAt: string;
  updatedAt: string;
  /** Preserves cropped images published by the earlier single-event server. */
  images?: Record<string, string>;
}
