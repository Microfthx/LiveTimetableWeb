import type { GroupLibraryRecord, GroupBindings } from "../types/groupLibrary.js";
import type { IdolGroup } from "../types/timetable.js";
import OpenCC from "opencc-js/t2cn";

const toSimplified: (text: string) => string = OpenCC.Converter({ from: "t", to: "cn" });

/** Preserve display casing and internal hyphens; remove decorative edge hyphens. */
export function canonicalGroupName(name: string): string {
  return name.normalize("NFC").trim().replace(/^-+|-+$/g, "").trim();
}

/** Match the same written name across Chinese scripts and ASCII letter case. */
export function groupMatchKey(name: string): string {
  return toSimplified(canonicalGroupName(name)).replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

/** Suggest a library name from a Weibo handle without changing event names. */
export function groupNameFromWeiboHandle(handle: string): string {
  const normalized = canonicalGroupName(handle);
  const suffix = /(?:[_-]?offici?al)[_-]*$/i.exec(normalized);
  if (!suffix) return normalized;
  return canonicalGroupName(normalized.slice(0, suffix.index).replace(/[_-]+$/, "")) || normalized;
}

export function exactGroupBindings(groups: IdolGroup[], library: GroupLibraryRecord[]): GroupBindings {
  const byName = new Map<string, string | null>();
  for (const group of library) {
    const key = groupMatchKey(group.name);
    if (!key) continue;
    if (byName.has(key)) byName.set(key, null); // Never choose between ambiguous library records.
    else byName.set(key, group.id);
  }
  const bindings: GroupBindings = {};
  for (const group of groups) {
    const match = byName.get(groupMatchKey(group.name));
    if (match) bindings[group.id] = match;
  }
  return bindings;
}
