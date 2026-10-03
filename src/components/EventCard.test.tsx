// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { demoData } from "../data/demo";
import { EventCard } from "./EventCard";

afterEach(cleanup);

it("loads only the thumbnail in the list and opens the original on poster click", () => {
  const onPosterOpen = vi.fn();
  const activity = {
    id: "7be64f88-1440-458c-b36d-36f8c335b716",
    city: "上海",
    data: demoData,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    thumbnailUrl: "/api/activities/example/thumbnail",
    posterUrl: "/api/activities/example/poster",
  };
  render(<EventCard activity={activity} now={new Date("2026-10-02T00:00:00.000Z")} onPosterOpen={onPosterOpen} />);
  expect(screen.getByRole("img", { name: `${demoData.event.title} 海报缩略图` }).getAttribute("src")).toBe(activity.thumbnailUrl);
  expect(screen.queryByRole("img", { name: /海报原图/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: `查看${demoData.event.title}原图` }));
  expect(onPosterOpen).toHaveBeenCalledWith(activity);
  expect(screen.getByRole("link").getAttribute("href")).toBe(`/events/${activity.id}`);
});
