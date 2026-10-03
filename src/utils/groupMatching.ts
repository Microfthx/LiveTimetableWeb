import type { GroupLibraryRecord, GroupBindings } from "../types/groupLibrary.js";
import type { IdolGroup } from "../types/timetable.js";

/** Only whitespace at the edges and Unicode canonical form are normalized. */
export function canonicalGroupName(name: string): string {
  return name.normalize("NFC").trim();
}

/** Suggest a library name from a Weibo handle without changing event names. */
export function groupNameFromWeiboHandle(handle: string): string {
  const normalized = canonicalGroupName(handle);
  const suffix = /(?:[_-]?offici?al)[_-]*$/i.exec(normalized);
  if (!suffix) return normalized;
  return normalized.slice(0, suffix.index).replace(/[_-]+$/, "") || normalized;
}

export function exactGroupBindings(groups: IdolGroup[], library: GroupLibraryRecord[]): GroupBindings {
  const byName = new Map(library.map((group) => [canonicalGroupName(group.name), group.id]));
  const bindings: GroupBindings = {};
  for (const group of groups) {
    const match = byName.get(canonicalGroupName(group.name));
    if (match) bindings[group.id] = match;
  }
  return bindings;
}
