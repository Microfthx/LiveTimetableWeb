// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { GroupBindingPicker } from "./GroupBindingPicker";
import type { GroupLibraryRecord } from "../types/groupLibrary";

afterEach(cleanup);

const library = [
  { id: "1", name: "Token", avatarUrl: "/token.webp" },
  { id: "2", name: "Purelee", avatarUrl: "/purelee.webp" },
  { id: "3", name: "DayBreak" },
  { id: "4", name: "夢境契約", avatarUrl: "/dream.webp" },
] as GroupLibraryRecord[];

it("searches avatar choices without losing the selected binding and allows clearing it", () => {
  const onChange = vi.fn();
  render(<GroupBindingPicker groupName="token" value="2" library={library} disabled={false} onChange={onChange} />);
  const trigger = screen.getByRole("button", { name: "token 的团体库绑定" });
  expect(trigger.textContent).toContain("Purelee");
  fireEvent.click(trigger);
  const search = screen.getByRole("searchbox", { name: "搜索token的团体库头像" });
  fireEvent.change(search, { target: { value: "TOKEN" } });
  expect(screen.getByRole("button", { name: /Token.*有头像/ })).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Purelee.*有头像/ })).toBeNull();
  expect(trigger.textContent).toContain("Purelee");
  fireEvent.click(screen.getByRole("button", { name: /Token.*有头像/ }));
  expect(onChange).toHaveBeenCalledWith("1");
  expect(screen.queryByRole("searchbox")).toBeNull();
  fireEvent.click(trigger);
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "梦境契约" } });
  expect(screen.getByRole("button", { name: /夢境契約.*有头像/ })).toBeTruthy();
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "未绑定 · 使用本场 crop" }));
  expect(onChange).toHaveBeenCalledWith("");
});
