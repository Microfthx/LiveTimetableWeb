// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { demoData } from "../data/demo";
import { TimetableList } from "./Cards";

afterEach(cleanup);

it("shows performance time first, with benefit time and an ongoing benefit status", () => {
  const group = { ...demoData.groups[0], benefit_type: "normal" as const,
    benefit_time_start: "14:20", benefit_time_end: "15:00" };
  render(<TimetableList data={{ ...demoData, groups: [group] }} now={new Date(2026, 9, 1, 14, 30)} />);
  const row = screen.getByText(group.name).closest(".timeline-row")!;
  expect(row.classList.contains("row-benefit")).toBe(true);
  expect(within(row as HTMLElement).getByText("14:00 – 14:10")).toBeTruthy();
  expect(within(row as HTMLElement).getByText("特典 14:20 – 15:00")).toBeTruthy();
  expect(within(row as HTMLElement).getByText("平特中")).toBeTruthy();
  expect(within(row as HTMLElement).queryByText("特典中")).toBeNull();
  expect(within(row as HTMLElement).getByText("平特中").classList.contains("status-benefit")).toBe(true);
});

it("shows final benefit while performing and keeps old groups clean", () => {
  const final = { ...demoData.groups[0], benefit_type: "final" as const };
  render(<TimetableList data={{ ...demoData, groups: [final, demoData.groups[1]] }}
    now={new Date(2026, 9, 1, 14, 5)} nextId={demoData.groups[1].id} />);
  const row = screen.getByText(final.name).closest(".timeline-row")!;
  expect(within(row as HTMLElement).getByText("● 演出中")).toBeTruthy();
  expect(within(row as HTMLElement).getByText("☆ 终特")).toBeTruthy();
  const nextRow = screen.getByText(demoData.groups[1].name).closest(".timeline-row")!;
  expect(within(nextRow as HTMLElement).getByText("NEXT")).toBeTruthy();
  expect(within(nextRow as HTMLElement).queryByText(/特典/)).toBeNull();
});

it("shows a completed normal benefit as the only main status", () => {
  const group = { ...demoData.groups[0], benefit_type: "normal" as const,
    benefit_time_start: "14:15", benefit_time_end: "14:30" };
  render(<TimetableList data={{ ...demoData, groups: [group] }} now={new Date(2026, 9, 1, 14, 35)} />);
  const row = screen.getByText(group.name).closest(".timeline-row")!;
  expect(within(row as HTMLElement).getByText("平特结束")).toBeTruthy();
  expect(within(row as HTMLElement).queryByText("演出结束")).toBeNull();
});

it("uses the benefit main status whenever its explicit time is ongoing", () => {
  const group = { ...demoData.groups[0], benefit_type: "normal" as const,
    benefit_time_start: "14:05", benefit_time_end: "14:30" };
  render(<TimetableList data={{ ...demoData, groups: [group] }} now={new Date(2026, 9, 1, 14, 7)} />);
  const row = screen.getByText(group.name).closest(".timeline-row")!;
  expect(within(row as HTMLElement).getByText("平特中")).toBeTruthy();
  expect(within(row as HTMLElement).getByText("14:00 – 14:10")).toBeTruthy();
});

it("labels a completed show without benefit as 演出结束", () => {
  const group = demoData.groups[0];
  render(<TimetableList data={{ ...demoData, groups: [group] }} now={new Date(2026, 9, 1, 14, 30)} />);
  const row = screen.getByText(group.name).closest(".timeline-row")!;
  expect(within(row as HTMLElement).getByText("演出结束")).toBeTruthy();
  expect(within(row as HTMLElement).queryByText(/平特/)).toBeNull();
});
