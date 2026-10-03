// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { GroupImage, LibraryImageContext, RuntimeImageContext } from "./GroupImage";
import type { IdolGroup } from "../types/timetable";

afterEach(cleanup);

it("uses the bound library avatar before this event's crop", () => {
  const group = { id: "group_001", name: "DayBreak", image_base64: "legacy", image_mime: "image/png" } as IdolGroup;
  render(<LibraryImageContext.Provider value={{ group_001: "/api/groups/group-id/avatar" }}>
    <RuntimeImageContext.Provider value={{ group_001: "blob:crop" }}><GroupImage group={group} /></RuntimeImageContext.Provider>
  </LibraryImageContext.Provider>);
  expect((screen.getByAltText("DayBreak 团体图片") as HTMLImageElement).getAttribute("src")).toBe("/api/groups/group-id/avatar");
});
