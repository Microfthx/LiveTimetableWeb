import type { EventData } from "../types/timetable";
import { demoData } from "../data/demo";
import { validateEventData } from "./validation";

const DATA_KEY = "live-idol-timetable-data";
const DELAY_KEY = "live-idol-delay";

export function loadEventData(): EventData {
  try {
    const stored = localStorage.getItem(DATA_KEY);
    if (!stored) return demoData;
    const data = validateEventData(JSON.parse(stored));
    const delay = localStorage.getItem(DELAY_KEY);
    if (delay !== null && /^-?\d+$/.test(delay)) {
      const number = Number(delay);
      if (number >= -1440 && number <= 1440) data.delay_minutes = number;
    }
    return data;
  } catch {
    return demoData;
  }
}

/** Keep first-stage browser data available for an explicit admin migration. */
export function loadStoredEventData(): EventData | null {
  try {
    return localStorage.getItem(DATA_KEY) ? loadEventData() : null;
  } catch {
    return null;
  }
}

export function saveEventData(data: EventData): void {
  localStorage.setItem(DATA_KEY, JSON.stringify(data));
  localStorage.setItem(DELAY_KEY, String(data.delay_minutes));
}

export function clearEventData(): void {
  localStorage.removeItem(DATA_KEY);
  localStorage.removeItem(DELAY_KEY);
}
