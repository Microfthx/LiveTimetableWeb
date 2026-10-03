import { expect, it } from "vitest";
import { exactGroupBindings } from "./groupMatching";
import type { IdolGroup } from "../types/timetable";
import type { GroupLibraryRecord } from "../types/groupLibrary";

const entry = { id: "library-1", name: "云梦CloudDream", createdAt: "now", updatedAt: "now" } satisfies GroupLibraryRecord;
const group = (id: string, name: string) => ({ id, name, start_time: "14:00", end_time: "14:20" }) as IdolGroup;

it("binds only exact canonical names and keeps event IDs separate", () => {
  expect(exactGroupBindings([
    group("group_001", " 云梦CloudDream "),
    group("group_002", "CloudDream"),
    group("group_003", "云梦clouddream"),
  ], [entry])).toEqual({ group_001: "library-1" });
});
