import { expect, it } from "vitest";
import { exactGroupBindings, groupNameFromWeiboHandle } from "./groupMatching";
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

it("suggests Weibo group names without trailing Official or its common typo", () => {
  expect(groupNameFromWeiboHandle("DayBreak_official")).toBe("DayBreak");
  expect(groupNameFromWeiboHandle("StarHoneyOfficial")).toBe("StarHoney");
  expect(groupNameFromWeiboHandle("StarLight_offical")).toBe("StarLight");
  expect(groupNameFromWeiboHandle("CAMELLiA-Official-")).toBe("CAMELLiA");
  expect(groupNameFromWeiboHandle("_Prince_Official_")).toBe("_Prince");
  expect(groupNameFromWeiboHandle("NoraNeko_Official野良猫俱乐部")).toBe("NoraNeko_Official野良猫俱乐部");
});
