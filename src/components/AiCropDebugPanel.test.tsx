// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { AiCropDebugPanel } from "./AiCropDebugPanel";
import { demoData } from "../data/demo";

afterEach(cleanup);

it("overlays untouched raw coordinates on both images and reports natural pixel coordinates", () => {
  const rawCrop = { x: 0.1, y: 0.55, width: 0.3, height: 0.2 };
  const group = demoData.groups[0];
  const poster = { file: new File(["a"], "poster.png", { type: "image/png" }), url: "data:image/png;base64,AA==", width: 1000, height: 2000 };
  const { container } = render(<AiCropDebugPanel
    debug={{
      groups: [{ id: group.id, name: group.name, rawCrop }],
      aiInput: { dataUrl: "data:image/png;base64,AA==", width: 500, height: 1000, mime: "image/png", sha256: "abc", resize: false, aspectRatioPreserved: true, padding: false, centerCrop: false, objectFitOrCssCrop: false },
    }}
    original={poster} originalAtRequest={{ width: 1000, height: 2000 }}
    data={demoData} images={{ [group.id]: "blob:final" }}
  />);
  fireEvent.click(screen.getByText("AI Crop Debug · 原始坐标诊断"));
  const boxes = container.querySelectorAll(".ai-crop-debug-box");
  expect(boxes).toHaveLength(2);
  expect(parseFloat((boxes[0] as HTMLElement).style.top)).toBeCloseTo(55);
  expect(parseFloat((boxes[1] as HTMLElement).style.top)).toBeCloseTo(55);
  expect(screen.getByText(/ORIGINAL pixelX 100\.000 · pixelY 1100\.000/)).toBeTruthy();
  expect(screen.getByText(/AI INPUT pixelX 50\.000 · pixelY 550\.000/)).toBeTruthy();
  expect(screen.getByAltText(`${group.name} 当前最终裁剪图片`).getAttribute("src")).toBe("blob:final");
});
