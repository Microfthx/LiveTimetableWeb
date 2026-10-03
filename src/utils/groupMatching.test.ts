import { expect, it } from "vitest";
import { canonicalGroupName, groupMatchKey, groupNameFromWeiboHandle, matchGroupBindings } from "./groupMatching";
import type { IdolGroup } from "../types/timetable";
import type { GroupLibraryRecord } from "../types/groupLibrary";

const entry = { id: "library-1", name: "云梦CloudDream", createdAt: "now", updatedAt: "now" } satisfies GroupLibraryRecord;
const group = (id: string, name: string) => ({ id, name, start_time: "14:00", end_time: "14:20" }) as IdolGroup;

it("matches edge hyphens, casing, scripts and unique name fragments while keeping event IDs separate", () => {
  expect(matchGroupBindings([
    group("group_001", " 云梦CloudDream "),
    group("group_002", "CloudDream"),
    group("group_003", "云梦clouddream"),
    group("group_004", "-云梦CloudDream-"),
  ], [entry])).toEqual({ group_001: "library-1", group_002: "library-1", group_003: "library-1", group_004: "library-1" });
  expect(matchGroupBindings([group("group_005", "token")], [{ ...entry, name: "Token" }])).toEqual({ group_005: "library-1" });
  expect(canonicalGroupName(" -Pri-Mary- ")).toBe("Pri-Mary");
  expect(groupMatchKey(" -TOKEN- ")).toBe("token");
  expect(groupMatchKey("夢境契約")).toBe(groupMatchKey("梦境契约"));
  expect(groupMatchKey("-電波TOXIC-")).toBe(groupMatchKey("电波toxic"));
  expect(groupMatchKey("夢響YUMEHIBIKI（上海）")).toBe(groupMatchKey("夢響YUMEHIBIKI"));
  expect(groupMatchKey("【上海】Yumehanabi")).toBe("yumehanabi");
  expect(matchGroupBindings([group("group_007", "梦境契约")], [
    { ...entry, name: "夢境契約" },
  ])).toEqual({ group_007: "library-1" });
  expect(matchGroupBindings([group("group_006", "token")], [
    { ...entry, name: "Token" }, { ...entry, id: "library-2", name: "TOKEN" },
  ])).toEqual({});
  expect(matchGroupBindings([group("group_008", "梦境契约")], [
    { ...entry, name: "夢境契約" }, { ...entry, id: "library-2", name: "梦境契约" },
  ])).toEqual({});
});

it("uses aliases and unique partial matches, but never guesses between multiple candidates", () => {
  const library: GroupLibraryRecord[] = [
    { ...entry, name: "夢響YUMEHIBIKI", aliases: ["Yumehibiki"] },
    { ...entry, id: "library-2", name: "夢花火YUMEHANABI", aliases: ["Yumehanabi"] },
    { ...entry, id: "library-3", name: "電波TOXIC", aliases: ["Toxic"] },
  ];
  expect(matchGroupBindings([
    group("a", "Yumehibiki（上海）"), group("b", "yumehanabi (深圳)"), group("c", "Toxic"),
  ], library)).toEqual({ a: "library-1", b: "library-2", c: "library-3" });
  expect(matchGroupBindings([group("c", "toxic")], [{ ...library[2], aliases: [] }])).toEqual({ c: "library-3" });
  expect(matchGroupBindings([group("c", "toxic")], [
    { ...library[2], aliases: [] }, { ...entry, id: "library-4", name: "TOXIC HEART" },
  ])).toEqual({});
  expect(matchGroupBindings([group("c", "Toxic")], [
    library[2], { ...entry, id: "library-4", name: "TOXIC HEART" },
  ])).toEqual({ c: "library-3" });
  expect(matchGroupBindings([group("x", "A")], [{ ...entry, name: "STAR" }])).toEqual({});
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
