import { expect, it } from "vitest";
import { canonicalGroupName, exactGroupBindings, groupMatchKey, groupNameFromWeiboHandle } from "./groupMatching";
import type { IdolGroup } from "../types/timetable";
import type { GroupLibraryRecord } from "../types/groupLibrary";

const entry = { id: "library-1", name: "云梦CloudDream", createdAt: "now", updatedAt: "now" } satisfies GroupLibraryRecord;
const group = (id: string, name: string) => ({ id, name, start_time: "14:00", end_time: "14:20" }) as IdolGroup;

it("matches edge hyphens and ASCII casing while keeping event IDs separate", () => {
  expect(exactGroupBindings([
    group("group_001", " 云梦CloudDream "),
    group("group_002", "CloudDream"),
    group("group_003", "云梦clouddream"),
    group("group_004", "-云梦CloudDream-"),
  ], [entry])).toEqual({ group_001: "library-1", group_003: "library-1", group_004: "library-1" });
  expect(exactGroupBindings([group("group_005", "token")], [{ ...entry, name: "Token" }])).toEqual({ group_005: "library-1" });
  expect(canonicalGroupName(" -Pri-Mary- ")).toBe("Pri-Mary");
  expect(groupMatchKey(" -TOKEN- ")).toBe("token");
  expect(groupMatchKey("夢境契約")).toBe(groupMatchKey("梦境契约"));
  expect(groupMatchKey("-電波TOXIC-")).toBe(groupMatchKey("电波toxic"));
  expect(exactGroupBindings([group("group_007", "梦境契约")], [
    { ...entry, name: "夢境契約" },
  ])).toEqual({ group_007: "library-1" });
  expect(exactGroupBindings([group("group_006", "token")], [
    { ...entry, name: "Token" }, { ...entry, id: "library-2", name: "TOKEN" },
  ])).toEqual({});
  expect(exactGroupBindings([group("group_008", "梦境契约")], [
    { ...entry, name: "夢境契約" }, { ...entry, id: "library-2", name: "梦境契约" },
  ])).toEqual({});
});

it("suggests Weibo group names without trailing Official or its common typo", () => {
  expect(groupNameFromWeiboHandle("DayBreak_official")).toBe("DayBreak");
  expect(groupNameFromWeiboHandle("StarHoneyOfficial")).toBe("StarHoney");
  expect(groupNameFromWeiboHandle("StarLight_offical")).toBe("StarLight");
  expect(groupNameFromWeiboHandle("CAMELLiA-Official-")).toBe("CAMELLiA");
  expect(groupNameFromWeiboHandle("-Agape-")).toBe("Agape");
  expect(groupNameFromWeiboHandle("-Mirage-official")).toBe("Mirage");
  expect(groupNameFromWeiboHandle("_Prince_Official_")).toBe("_Prince");
  expect(groupNameFromWeiboHandle("NoraNeko_Official野良猫俱乐部")).toBe("NoraNeko_Official野良猫俱乐部");
});
