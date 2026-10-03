// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { GroupManager } from "./GroupManager";

vi.mock("../utils/activitiesApi", () => ({
  listGroups: () => Promise.resolve([
    { id: "1", name: "夢境契約", weiboUid: "1234567890", createdAt: "now", updatedAt: "now" },
    { id: "2", name: "電波TOXIC", aliases: ["Toxic"], weiboUid: "9876543210", createdAt: "now", updatedAt: "now" },
  ]),
}));

afterEach(cleanup);

it("searches group names across simplified and traditional Chinese and still accepts Weibo UID", async () => {
  render(<GroupManager />);
  expect(await screen.findByText("夢境契約")).toBeTruthy();
  const search = screen.getByRole("textbox", { name: "搜索团体" });
  fireEvent.change(search, { target: { value: "梦境契约" } });
  expect(screen.getByText("夢境契約")).toBeTruthy();
  expect(screen.queryByText("電波TOXIC")).toBeNull();
  fireEvent.change(search, { target: { value: "9876543210" } });
  expect(screen.getByText("電波TOXIC")).toBeTruthy();
  expect(screen.queryByText("夢境契約")).toBeNull();
  fireEvent.change(search, { target: { value: "toxic" } });
  expect(screen.getByText("電波TOXIC")).toBeTruthy();
  expect(screen.getByText("别名：Toxic")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "编辑" }));
  expect((screen.getByRole("textbox", { name: "匹配别名（每行一个）" }) as HTMLTextAreaElement).value).toBe("Toxic");
});
