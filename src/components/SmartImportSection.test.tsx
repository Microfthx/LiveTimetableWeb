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
const parsePost = vi.hoisted(() => vi.fn());
const jobState = vi.hoisted(() => ({ result: null as unknown, input: null as { weiboText: string } | null, getJobGate: null as Promise<void> | null }));
vi.mock("../utils/activitiesApi", () => ({
  aiStatus: () => Promise.resolve({ configured: true }),
  parseWeibo: parsePost,
  listAiJobs: () => Promise.resolve([]),
  getAiJobRaw: () => Promise.resolve("{}"),
  submitAiJob: async (input: { weiboText: string }) => {
    jobState.input = input;
    jobState.result = await recognize(input);
    return { id: "11111111-1111-4111-8111-111111111111", status: "queued", mode: "normal", createdAt: new Date().toISOString(), queuePosition: 1, hasRawResponse: false };
  },
  getAiJob: async () => { if (jobState.getJobGate) await jobState.getJobGate; return ({
    id: "11111111-1111-4111-8111-111111111111", status: "completed", mode: "normal", createdAt: new Date().toISOString(), queuePosition: 0,
    hasRawResponse: false, postText: jobState.input?.weiboText ?? "", sources: { timetable: null, crop: null, cover: null }, result: jobState.result,
  }); },
  listGroups: () => Promise.resolve([]),
}));
afterEach(() => {
  cleanup();
  recognize.mockReset();
  parsePost.mockReset();
  jobState.result = null;
  jobState.input = null;
  jobState.getJobGate = null;
  window.localStorage.clear();
});

it("remembers a Weibo Cookie only when selected and can clear it", async () => {
  render(
    <SmartImportSection
      onPrepared={() => undefined}
      onCityRecognized={() => undefined}
      onManual={() => undefined}
      manualRequest={0}
    />,
  );
  const cookie = screen.getByLabelText("微博 Cookie") as HTMLTextAreaElement;
  fireEvent.change(cookie, { target: { value: "SUB=private==" } });
  expect(window.localStorage.getItem("live-idol-weibo-cookie")).toBeNull();
  fireEvent.click(screen.getByLabelText("在此浏览器记住 Cookie"));
  await waitFor(() =>
    expect(window.localStorage.getItem("live-idol-weibo-cookie")).toBe(
      "SUB=private==",
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "清除已保存的 Cookie" }));
  await waitFor(() =>
    expect(window.localStorage.getItem("live-idol-weibo-cookie")).toBeNull(),
  );
  expect(cookie.value).toBe("");
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
    city: "",
    warnings: [],
    model: "test-model",
    mode: "normal",
  });
  render(
    <SmartImportSection
      onPrepared={onPrepared}
      onCityRecognized={() => undefined}
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
  expect(screen.getByRole("button", { name: "JSON 编辑" }).classList.contains("selected")).toBe(true);
  expect(screen.getByRole("button", { name: "应用 JSON 修改" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "可视化编辑" }));
  expect(screen.getByLabelText("活动名称")).toBeTruthy();
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
  const [event, city, crop, cover] = onPrepared.mock.calls[0];
  expect(event.poster).toEqual({ width: 0, height: 0 });
  expect(city).toBe("");
  expect(crop).toBeNull();
  expect(cover).toBeNull();
});

it("offers high precision recognition after normal recognition fails", async () => {
  recognize.mockRejectedValueOnce(new Error("AI 输出被截断，请尝试高精度识别或手动 JSON。"));
  recognize.mockResolvedValueOnce({ data: demoData, city: "", warnings: [], model: "qwen/qwen3.8-27b", mode: "high" });
  render(<SmartImportSection onPrepared={() => undefined} onCityRecognized={() => undefined} onManual={() => undefined} manualRequest={0} />);
  fireEvent.change(screen.getByPlaceholderText(/14:00 Gara/), { target: { value: "14:00 Gara" } });
  fireEvent.click(await screen.findByRole("button", { name: "AI 识别 Timetable" }));
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "高精度识别 Timetable" }));
  await waitFor(() => expect(recognize).toHaveBeenLastCalledWith(expect.objectContaining({ mode: "high" })));
  await screen.findByText("人工检查 AI 识别结果");
});

it("keeps a submitted job across a page remount and restores its result", async () => {
  let release!: () => void;
  jobState.getJobGate = new Promise<void>((resolve) => { release = resolve; });
  recognize.mockResolvedValue({ data: demoData, city: "厦门", warnings: [], model: "test-model", mode: "normal" });
  const props = { onPrepared: () => undefined, onCityRecognized: () => undefined, onManual: () => undefined, manualRequest: 0 };
  const first = render(<SmartImportSection {...props} />);
  fireEvent.change(screen.getByPlaceholderText(/14:00 Gara/), { target: { value: "14:00 Gara" } });
  fireEvent.click(await screen.findByRole("button", { name: "AI 识别 Timetable" }));
  await screen.findByText(/排队中/);
  expect(window.localStorage.getItem("live-idol-ai-job-id")).toBe("11111111-1111-4111-8111-111111111111");
  first.unmount();
  render(<SmartImportSection {...props} />);
  release();
  await screen.findByText("人工检查 AI 识别结果");
  expect(screen.getByText(/城市：厦门/)).toBeTruthy();
});

it("edits an existing activity visually while keeping JSON as the default", async () => {
  const onImport = vi.fn().mockResolvedValue(undefined);
  render(<ImportBottomSheet
    mode="paste" poster={null} initialData={demoData} initialCity="厦门"
    sheetTitle="编辑活动" submitLabel="保存修改"
    onPosterSelect={() => undefined} onPosterClear={() => undefined}
    onImport={onImport} onClose={() => undefined}
  />);
  expect(screen.getByRole("tab", { name: "JSON 编辑" }).getAttribute("aria-selected")).toBe("true");
  fireEvent.click(screen.getByRole("tab", { name: "可视化编辑" }));
  fireEvent.change(screen.getByLabelText("活动名称"), { target: { value: "可视化修改后的活动" } });
  fireEvent.change(screen.getAllByLabelText("开始")[0], { target: { value: "14:01" } });
  fireEvent.change(screen.getAllByLabelText("特典类型")[0], { target: { value: "final" } });
  expect(screen.getByRole("button", { name: "保存修改" }).hasAttribute("disabled")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "验证并预览可视化修改" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "保存修改" }).hasAttribute("disabled")).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
  await waitFor(() => expect(onImport).toHaveBeenCalledWith(
    expect.objectContaining({
      event: expect.objectContaining({ title: "可视化修改后的活动" }),
      groups: expect.arrayContaining([expect.objectContaining({ start_time: "14:01", benefit_type: "final" })]),
    }),
    expect.any(Object), null, "厦门", {},
  ));
});

it("keeps an invalid existing JSON draft editable when switching to visual mode", async () => {
  render(<ImportBottomSheet
    mode="paste" poster={null} initialData={demoData} initialCity="厦门"
    onPosterSelect={() => undefined} onPosterClear={() => undefined}
    onImport={async () => undefined} onClose={() => undefined}
  />);
  const textarea = screen.getByLabelText("粘贴 OCR JSON") as HTMLTextAreaElement;
  fireEvent.change(textarea, { target: { value: '{"schema_version":"1.0" "event":{}}' } });
  fireEvent.click(screen.getByRole("tab", { name: "可视化编辑" }));
  expect(screen.getByRole("tab", { name: "JSON 编辑" }).getAttribute("aria-selected")).toBe("true");
  expect(textarea.disabled).toBe(false);
  expect(await screen.findByText("JSON 格式错误，请确认复制了完整的 OCR 识别结果。")).toBeTruthy();
});

it("refuses to save invalid visual edits and keeps the draft for correction", async () => {
  const onImport = vi.fn().mockResolvedValue(undefined);
  render(<ImportBottomSheet
    mode="paste" poster={null} initialData={demoData} initialCity="厦门"
    submitLabel="保存修改"
    onPosterSelect={() => undefined} onPosterClear={() => undefined}
    onImport={onImport} onClose={() => undefined}
  />);
  fireEvent.click(screen.getByRole("tab", { name: "可视化编辑" }));
  fireEvent.change(screen.getByLabelText("活动名称"), { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "验证并预览可视化修改" }));
  expect(await screen.findByText("event.title 不能为空，请先核对 OCR 结果。")).toBeTruthy();
  expect(screen.getByRole("button", { name: "保存修改" }).hasAttribute("disabled")).toBe(true);
  expect(onImport).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("活动名称"), { target: { value: "已修正" } });
  fireEvent.click(screen.getByRole("button", { name: "验证并预览可视化修改" }));
  expect(screen.getByRole("button", { name: "保存修改" }).hasAttribute("disabled")).toBe(false);
});

it("prefills the editable activity city from AI without adding city to EventData", async () => {
  recognize.mockResolvedValue({
    data: demoData,
    city: "武汉",
    warnings: [],
    model: "test-model",
    mode: "normal",
  });
  render(<ImportBottomSheet
    mode="paste"
    poster={null}
    smartEnabled
    onPosterSelect={() => undefined}
    onPosterClear={() => undefined}
    onImport={async () => undefined}
    onClose={() => undefined}
  />);
  fireEvent.change(screen.getByPlaceholderText(/14:00 Gara/), {
    target: { value: "武汉 Live\n14:00 Gara" },
  });
  fireEvent.click(await screen.findByRole("button", { name: "AI 识别 Timetable" }));
  await screen.findByText("人工检查 AI 识别结果");
  await waitFor(() => expect((screen.getByLabelText("活动城市 *") as HTMLInputElement).value).toBe("武汉"));
  fireEvent.click(screen.getByRole("button", { name: "应用修改并生成导入预览" }));
  await waitFor(() => expect((screen.getByLabelText("活动城市 *") as HTMLInputElement).value).toBe("武汉"));
  expect(screen.getByText("导入预览")).toBeTruthy();
});

it("keeps an administrator's city edit when AI suggests a different city", async () => {
  recognize.mockResolvedValue({ data: demoData, city: "厦门", warnings: [], model: "test-model", mode: "normal" });
  render(<ImportBottomSheet
    mode="paste" poster={null} smartEnabled
    onPosterSelect={() => undefined} onPosterClear={() => undefined}
    onImport={async () => undefined} onClose={() => undefined}
  />);
  fireEvent.change(screen.getByLabelText("活动城市 *"), { target: { value: "武汉" } });
  fireEvent.change(screen.getByPlaceholderText(/14:00 Gara/), { target: { value: "14:00 Gara" } });
  fireEvent.click(await screen.findByRole("button", { name: "AI 识别 Timetable" }));
  await screen.findByText("人工检查 AI 识别结果");
  expect((screen.getByLabelText("活动城市 *") as HTMLInputElement).value).toBe("武汉");
});

it("sends a Weibo poster as city context when timetable is in the post text", async () => {
  parsePost.mockResolvedValue({
    id: "5348092418196159", url: "https://weibo.com/4017878407/5348092418196159",
    author: { name: "活动账号" }, created_at: "2026-10-03", text: "14:00 Gara\n14:20 Koisa",
    importId: "00000000-0000-0000-0000-000000000001",
    images: [{ id: "image_001", local_url: "/api/admin/weibo/import-assets/00000000-0000-0000-0000-000000000001/image_001", width: 600, height: 800 }],
    warnings: [],
  });
  recognize.mockResolvedValue({ data: demoData, city: "西安", warnings: [], model: "test-model", mode: "normal" });
  render(<SmartImportSection onPrepared={() => undefined} onCityRecognized={() => undefined} onManual={() => undefined} manualRequest={0} />);
  fireEvent.change(screen.getByLabelText("微博 Cookie"), { target: { value: "SUB=test" } });
  fireEvent.change(screen.getByPlaceholderText("https://weibo.com/..."), { target: { value: "https://weibo.com/4017878407/5348092418196159" } });
  fireEvent.click(screen.getByRole("button", { name: "获取微博" }));
  await screen.findByText(/已获取微博正文和 1 张图片/);
  expect(screen.getByText("城市参考图：图 1")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "AI 识别 Timetable" }));
  await waitFor(() => expect(recognize).toHaveBeenCalledWith(expect.objectContaining({
    timetableSource: null,
    cropSource: null,
    coverSource: { kind: "weibo", importId: "00000000-0000-0000-0000-000000000001", imageId: "image_001" },
    weiboText: "14:00 Gara\n14:20 Koisa",
  })));
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
      onCityRecognized={() => undefined}
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
