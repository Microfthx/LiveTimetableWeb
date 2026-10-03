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
  const withoutNotes = name.replace(/\([^()]*\)|（[^（）]*）|\[[^\[\]]*\]|【[^【】]*】/g, "");
  return toSimplified(canonicalGroupName(withoutNotes)).replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

/** Suggest a library name from a Weibo handle without changing event names. */
export function groupNameFromWeiboHandle(handle: string): string {
  const normalized = canonicalGroupName(handle);
  const suffix = /(?:[_-]?offici?al)[_-]*$/i.exec(normalized);
  if (!suffix) return normalized;
  return canonicalGroupName(normalized.slice(0, suffix.index).replace(/[_-]+$/, "")) || normalized;
}

export function matchGroupBindings(groups: IdolGroup[], library: GroupLibraryRecord[]): GroupBindings {
  const candidates = library.map((group) => ({
    id: group.id,
    keys: new Set([group.name, ...(group.aliases ?? [])].map(groupMatchKey).filter(Boolean)),
  }));
  const bindings: GroupBindings = {};
  for (const group of groups) {
    const key = groupMatchKey(group.name);
    if (!key) continue;
    const exact = candidates.filter((candidate) => candidate.keys.has(key));
    if (exact.length === 1) { bindings[group.id] = exact[0].id; continue; }
    if (exact.length > 1) continue;
    // A short fragment can coincidentally occur in an unrelated name.
    if ([...key].length < 2 || (/^[a-z0-9]+$/.test(key) && key.length < 3)) continue;
    const partial = candidates.filter((candidate) => [...candidate.keys].some((name) => name.includes(key)));
    if (partial.length === 1) bindings[group.id] = partial[0].id;
  }
  return bindings;
}
