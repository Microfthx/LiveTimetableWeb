// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { demoData } from "../data/demo";
import { localDateKey } from "../utils/activityList";
import { ActivityListPage } from "./ActivityListPage";

vi.mock("../utils/activitiesApi", () => ({
  listActivities: () => Promise.resolve([{
    id: "7be64f88-1440-458c-b36d-36f8c335b716",
    city: "上海",
    data: { ...demoData, event: { ...demoData.event, date: localDateKey(new Date()) } },
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    thumbnailUrl: "/api/activities/example/thumbnail",
    posterUrl: "/api/activities/example/poster",
  }]),
}));

afterEach(cleanup);

it("shows the original poster inside a small dialog only after clicking the thumbnail", async () => {
  render(<ActivityListPage />);
  const open = await screen.findByRole("button", { name: `查看${demoData.event.title}原图` });
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(open);
  const dialog = screen.getByRole("dialog", { name: `${demoData.event.title}海报原图` });
  expect(dialog.className).toBe("poster-viewer");
  expect(dialog.querySelector(".poster-viewer-image img")?.getAttribute("src")).toBe("/api/activities/example/poster");
  fireEvent.click(screen.getByRole("button", { name: "关闭原图" }));
  expect(screen.queryByRole("dialog")).toBeNull();
});
