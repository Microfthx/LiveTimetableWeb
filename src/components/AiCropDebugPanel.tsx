import { useState } from "react";
import type { AiCropDebugData } from "../types/aiCropDebug";
import { debugCrop } from "../types/aiCropDebug";
import type { EventData, PosterSource } from "../types/timetable";
import type { RuntimeGroupImages } from "../utils/poster";

function ratio(width: number, height: number): string {
  return width && height ? (width / height).toFixed(6) : "无";
}

function number(value: number): string {
  return Number.isFinite(value) ? value.toFixed(3) : "无效";
}

function CropOverlay({ url, alt, groups, onLoad }: {
  url: string;
  alt: string;
  groups: AiCropDebugData["groups"];
  onLoad?: (width: number, height: number) => void;
}) {
  return <div className="ai-crop-debug-overlay">
    <img src={url} alt={alt} onLoad={(event) => onLoad?.(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)} />
    {groups.map((group, index) => {
      const crop = debugCrop(group.rawCrop);
      if (!crop || crop.width <= 0 || crop.height <= 0) return null;
      return <span className="ai-crop-debug-box" key={`${group.id}-${index}`} style={{
        left: `${crop.x * 100}%`, top: `${crop.y * 100}%`,
        width: `${crop.width * 100}%`, height: `${crop.height * 100}%`,
      }}><span>{index + 1} {group.name}</span></span>;
    })}
  </div>;
}

export function AiCropDebugPanel({ debug, original, originalAtRequest, data, images }: {
  debug: AiCropDebugData;
  original: PosterSource | null;
  originalAtRequest: { width: number; height: number } | null;
  data: EventData;
  images: RuntimeGroupImages;
}) {
  const [renderedInput, setRenderedInput] = useState<{ width: number; height: number } | null>(null);
  const input = debug.aiInput;
  const originalWidth = original?.width ?? originalAtRequest?.width ?? 0;
  const originalHeight = original?.height ?? originalAtRequest?.height ?? 0;
  const inputRatio = input.width && input.height ? input.width / input.height : 0;
  const originalRatio = originalWidth && originalHeight ? originalWidth / originalHeight : 0;
  const sameRatio = inputRatio && originalRatio ? Math.abs(inputRatio - originalRatio) / originalRatio < 0.000001 : false;

  return <details className="ai-crop-debug">
    <summary>AI Crop Debug · 原始坐标诊断</summary>
    <p>以下框直接使用 OpenRouter 返回的 rawCrop。未经过 normalize、修正、扩张或人为 Y 补偿。此数据只在当前导入会话内显示，不写入活动 JSON。</p>
    <div className="ai-crop-debug-facts">
      <span>AI INPUT：{input.width} × {input.height} · ratio {ratio(input.width, input.height)}</span>
      <span>ORIGINAL：{originalWidth} × {originalHeight} · ratio {ratio(originalWidth, originalHeight)}</span>
      <span>比例完全一致：{sameRatio ? "是" : "否 / 无法判断"}</span>
      <span>本应用发送前 resize：{input.resize ? "是" : "否"}；保持比例：{input.aspectRatioPreserved ? "是" : "否"}</span>
      <span>本应用发送前 padding：{input.padding ? "是" : "否"}；center crop：{input.centerCrop ? "是" : "否"}；CSS / object-fit 裁切作为输入：{input.objectFitOrCssCrop ? "是" : "否"}</span>
      <span>OpenRouter 或模型提供方内部的图像预处理无法从本应用观察。</span>
      <span>AI INPUT MIME：{input.mime ?? "无图片"}；SHA-256：{input.sha256 ?? "无图片"}</span>
      {renderedInput && <span>浏览器解码 AI INPUT natural：{renderedInput.width} × {renderedInput.height}</span>}
      {original && originalAtRequest && (original.width !== originalAtRequest.width || original.height !== originalAtRequest.height) &&
        <span className="form-warning">预览解码尺寸与 AI 请求前原图尺寸不同：请求前 {originalAtRequest.width} × {originalAtRequest.height}</span>}
    </div>
    <div className="ai-crop-debug-images">
      <section><h4>A · AI INPUT IMAGE + raw crop</h4>
        {input.dataUrl ? <CropOverlay url={input.dataUrl} alt="实际发送 OpenRouter 的 Crop Source 字节及原始裁剪框" groups={debug.groups} onLoad={(width, height) => setRenderedInput({ width, height })} /> : <p>未发送 Crop Source 图片。</p>}
      </section>
      <section><h4>B · ORIGINAL CROP SOURCE + raw crop</h4>
        {original ? <CropOverlay url={original.url} alt="浏览器原始 Crop Source 及同一组原始裁剪框" groups={debug.groups} /> : <p>生成导入预览后显示原始 Crop Source。</p>}
      </section>
    </div>
    <h4>C · 当前最终生成的 cropped images</h4>
    <div className="ai-crop-debug-results">
      {debug.groups.map((group, index) => {
        const crop = debugCrop(group.rawCrop);
        const finalGroup = data.groups.find((item) => item.id === group.id && item.name === group.name)
          ?? data.groups.find((item) => item.name === group.name);
        const final = finalGroup ? images[finalGroup.id] : undefined;
        const matchesFinal = !!crop && !!finalGroup?.crop
          && (['x', 'y', 'width', 'height'] as const).every((key) => crop[key] === finalGroup.crop?.[key]);
        return <div className="ai-crop-debug-result" key={`${group.id}-${index}`}>
          {final ? <img src={final} alt={`${group.name} 当前最终裁剪图片`} /> : <div className="ai-crop-debug-empty">无最终图片</div>}
          <div><strong>{group.name || `团体 ${index + 1}`}</strong>
            {crop ? <>
              <small>x {crop.x} · y {crop.y} · width {crop.width} · height {crop.height}</small>
              <small>ORIGINAL pixelX {number(crop.x * originalWidth)} · pixelY {number(crop.y * originalHeight)} · pixelWidth {number(crop.width * originalWidth)} · pixelHeight {number(crop.height * originalHeight)}</small>
              <small>AI INPUT pixelX {number(crop.x * input.width)} · pixelY {number(crop.y * input.height)} · pixelWidth {number(crop.width * input.width)} · pixelHeight {number(crop.height * input.height)}</small>
              <small>最终 Canvas 使用的 crop：{matchesFinal ? "与 rawCrop 相同" : "与 rawCrop 不同 / 无对应团体，请核对人工修改或校验结果"}</small>
            </> : <small>rawCrop：{JSON.stringify(group.rawCrop)}（无法绘制）</small>}
          </div>
        </div>;
      })}
    </div>
  </details>;
}
