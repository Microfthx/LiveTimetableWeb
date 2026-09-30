export interface CropRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PosterInfo {
  width: number;
  height: number;
}

export interface PosterSource {
  file: File;
  url: string;
  width: number;
  height: number;
}

export interface IdolGroup {
  id: string;
  name: string;
  start_time: string;
  end_time: string;
  image_base64: string;
  image_mime: string;
  crop?: CropRegion;
}

export interface EventInfo {
  title: string;
  date: string;
  venue?: string;
  doors_time?: string;
  start_time?: string;
}

export interface EventData {
  schema_version: "1.0";
  event: EventInfo;
  delay_minutes: number;
  poster: PosterInfo;
  groups: IdolGroup[];
}

export type PerformanceStatus =
  "finished" | "live" | "next" | "upcoming" | "unscheduled";
