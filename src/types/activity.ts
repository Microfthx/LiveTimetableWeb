import type { EventData } from "./timetable.js";
import type { GroupBindings } from "./groupLibrary.js";

/** Website metadata wraps the unchanged OCR v1.0 EventData. */
export interface ActivityRecord {
  id: string;
  city: string;
  posterUrl?: string;
  /** Persisted, lightweight cover for activity lists. */
  thumbnailUrl?: string;
  /** Source for normalized group crops; old records fall back to posterUrl. */
  cropSourceUrl?: string;
  cropSourceSeparate?: boolean;
  data: EventData;
  /** Event group id -> stable website group UUID. Older activities omit this. */
  groupBindings?: GroupBindings;
  createdAt: string;
  updatedAt: string;
  /** Preserves cropped images published by the earlier single-event server. */
  images?: Record<string, string>;
}
