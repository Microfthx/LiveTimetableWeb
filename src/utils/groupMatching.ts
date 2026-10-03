import type { GroupLibraryRecord, GroupBindings } from "../types/groupLibrary.js";
import type { IdolGroup } from "../types/timetable.js";

/** Only whitespace at the edges and Unicode canonical form are normalized. */
export function canonicalGroupName(name: string): string {
  return name.normalize("NFC").trim();
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
