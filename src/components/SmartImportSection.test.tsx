// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { demoData } from "../data/demo";
import { SmartImportSection } from "./SmartImportSection";
import { ImportBottomSheet } from "./Sheets";

const recognize = vi.hoisted(() => vi.fn());
vi.mock("../utils/activitiesApi", () => ({
  aiStatus: () => Promise.resolve({ configured: true }),
  parseWeibo: vi.fn(),
  recognizeTimetable: recognize,
}));
afterEach(() => {
  cleanup();
  recognize.mockReset();
});

it("allows timetable text without an image and reaches the existing preview path", async () => {
  const onPrepared = vi.fn();
  const data = {
    ...demoData,
    poster: { width: 0, height: 0 },
    groups: demoData.groups.map((group) => ({
      ...group,
      crop: { x: 0, y: 0, width: 0, height: 0 },
    })),
  };
  recognize.mockResolvedValue({
    data,
    warnings: [],
    model: "test-model",
    mode: "normal",
  });
  render(
    <SmartImportSection
      onPrepared={onPrepared}
      onManual={() => undefined}
      manualRequest={0}
    />,
  );
  const aiButton = await screen.findByRole("button", {
    name: "AI 识别 Timetable",
  });
  expect(aiButton.hasAttribute("disabled")).toBe(true);
  fireEvent.change(screen.getByPlaceholderText(/14:00 Gara/), {
    target: { value: "14:00 Gara\n14:20 Koisa" },
  });
  expect(aiButton.hasAttribute("disabled")).toBe(false);
  fireEvent.click(aiButton);
  await screen.findByText("人工检查 AI 识别结果");
  expect(recognize).toHaveBeenCalledWith(
    expect.objectContaining({
      timetableSource: null,
      cropSource: null,
      weiboText: "14:00 Gara\n14:20 Koisa",
    }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "应用修改并生成导入预览" }),
  );
  await waitFor(() => expect(onPrepared).toHaveBeenCalled());
  const [event, crop, cover] = onPrepared.mock.calls[0];
  expect(event.poster).toEqual({ width: 0, height: 0 });
  expect(crop).toBeNull();
  expect(cover).toBeNull();
});

it("keeps the manual JSON textarea editable after a failed parse with a poster selected", async () => {
  render(
    <ImportBottomSheet
      mode="paste"
      poster={{
        file: new File(["x"], "poster.png", { type: "image/png" }),
        url: "blob:poster",
        width: 1,
        height: 1,
      }}
      onPosterSelect={() => undefined}
      onPosterClear={() => undefined}
      onImport={async () => undefined}
      onClose={() => undefined}
    />,
  );
  const textarea = screen.getByLabelText(
    "粘贴 OCR JSON",
  ) as HTMLTextAreaElement;
  fireEvent.change(textarea, {
    target: { value: '{"schema_version":"1.0" "event":{}}' },
  });
  fireEvent.click(screen.getByRole("button", { name: "解析 JSON" }));
  expect(
    await screen.findByText("JSON 格式错误，请确认复制了完整的 OCR 识别结果。"),
  ).toBeTruthy();
  expect(textarea.disabled).toBe(false);
  fireEvent.change(textarea, { target: { value: JSON.stringify(demoData) } });
  expect(textarea.disabled).toBe(false);
});

it("switches to manual JSON while retaining a text-only timetable source", async () => {
  const onManual = vi.fn();
  render(
    <SmartImportSection
      onPrepared={() => undefined}
      onManual={onManual}
      manualRequest={0}
    />,
  );
  fireEvent.change(screen.getByPlaceholderText(/14:00 Gara/), {
    target: { value: "14:00 Gara" },
  });
  fireEvent.click(screen.getByRole("button", { name: /改用手动 JSON/ }));
  await waitFor(() => expect(onManual).toHaveBeenCalled());
  expect(onManual.mock.calls[0][0]).toBeNull();
  expect(onManual.mock.calls[0][2].timetable).toBe("微博正文");
});
