import { useEffect, useRef, useState } from "react";
import {
  Check,
  ClipboardPaste,
  Download,
  FileJson,
  ImageUp,
  RotateCcw,
  Upload,
  X,
} from "lucide-react";
import type { EventData, PosterSource } from "../types/timetable";
import { OCR_PROMPT } from "../constants/ocrPrompt";
import { copyTextToClipboard } from "../utils/clipboard";
import { parseEventJsonDetailed } from "../utils/validation";
import {
  cropGroupImages,
  posterRatioDifference,
  readPoster,
  revokeRuntimeImages,
  type RuntimeGroupImages,
} from "../utils/poster";
import { GroupImage, RuntimeImageContext } from "./GroupImage";
import { SmartImportSection, type SmartSourceSummary } from "./SmartImportSection";

export function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeButton.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = oldOverflow;
    };
  }, [onClose]);
  return (
    <div
      className="sheet-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="bottom-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="sheet-handle" />
        <div className="sheet-heading">
          <h2>{title}</h2>
          <button
            ref={closeButton}
            className="icon-circle"
            onClick={onClose}
            aria-label="关闭"
          >
            <X size={21} />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}

export function DelayBottomSheet({
  delay,
  onApply,
  onClose,
}: {
  delay: number;
  onApply: (value: number) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(String(delay));
  const [error, setError] = useState("");
  const apply = () => {
    const number = Number(value);
    if (
      !/^-?\d+$/.test(value.trim()) ||
      !Number.isInteger(number) ||
      number < -1440 ||
      number > 1440
    ) {
      setError("请输入 -1440 到 1440 之间的整数分钟。");
      return;
    }
    onApply(number);
    onClose();
  };
  return (
    <Sheet title="调整现场时间" onClose={onClose}>
      <div className="sheet-current">
        <span>当前延迟</span>
        <strong>
          {delay > 0 ? "+" : ""}
          {delay} 分钟
        </strong>
      </div>
      <p className="sheet-description">
        快捷调整会加到当前设定；也可直接输入最终延迟分钟数。
      </p>
      <div className="quick-grid">
        {[-10, -5, -1, 1, 5, 10, 15, 30].map((amount) => (
          <button
            key={amount}
            onClick={() => {
              setValue(
                String(
                  Math.max(-1440, Math.min(1440, Number(value || 0) + amount)),
                ),
              );
              setError("");
            }}
          >
            {amount > 0 ? "+" : ""}
            {amount}
          </button>
        ))}
      </div>
      <label className="input-label" htmlFor="custom-delay">
        自定义分钟数
      </label>
      <div className="number-input">
        <input
          id="custom-delay"
          type="number"
          inputMode="numeric"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setError("");
          }}
        />
        <span>分钟</span>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button className="primary-button" onClick={apply}>
        应用调整
      </button>
      <button
        className="text-button"
        onClick={() => {
          onApply(0);
          onClose();
        }}
      >
        <RotateCcw size={17} /> 恢复原始时间
      </button>
    </Sheet>
  );
}

export function ImportBottomSheet({
  mode,
  poster,
  initialData,
  initialCity = "",
  sheetTitle = "导入 Timetable",
  submitLabel = "确认导入",
  duplicateTitles = [],
  originalPosterRatio,
  replacementPending = false,
  smartEnabled = false,
  displayPoster = null,
  showDisplayPosterEditor = false,
  coverReplacementPending = false,
  onDisplayPosterSelect,
  onPosterSelect,
  onPosterClear,
  onDirtyChange,
  onImport,
  onClose,
}: {
  mode: "paste" | "file" | "poster";
  poster: PosterSource | null;
  initialData?: EventData;
  initialCity?: string;
  sheetTitle?: string;
  submitLabel?: string;
  duplicateTitles?: string[];
  originalPosterRatio?: number;
  replacementPending?: boolean;
  smartEnabled?: boolean;
  displayPoster?: PosterSource | null;
  showDisplayPosterEditor?: boolean;
  coverReplacementPending?: boolean;
  onDisplayPosterSelect?: (poster: PosterSource | null) => void;
  onPosterSelect: (poster: PosterSource) => void;
  onPosterClear: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  onImport: (data: EventData, images: RuntimeGroupImages, poster: PosterSource | null, city: string) => Promise<void>;
  onClose: () => void;
}) {
  const [text, setText] = useState(() => initialData ? JSON.stringify(initialData, null, 2) : "");
  const [importMode, setImportMode] = useState<"smart" | "manual">(smartEnabled ? "smart" : "manual");
  const [manualRequest, setManualRequest] = useState(0);
  const [sourceSummary, setSourceSummary] = useState<SmartSourceSummary | null>(null);
  const [city, setCity] = useState(initialCity);
  const [candidate, setCandidate] = useState<{
    data: EventData;
    warnings: string[];
  } | null>(() => initialData ? parseEventJsonDetailed(JSON.stringify(initialData)) : null);
  const [preview, setPreview] = useState<{
    images: RuntimeGroupImages;
    failed: string[];
  }>({ images: {}, failed: [] });
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const posterRef = useRef<HTMLInputElement>(null);
  const displayPosterFileRef = useRef<HTMLInputElement>(null);
  const previewUrlsRef = useRef<RuntimeGroupImages>({});
  const confirmingRef = useRef(false);

  useEffect(() => {
    if (mode === "file") fileRef.current?.click();
  }, [mode]);
  useEffect(() => {
    if (!candidate || !poster) {
      setPreview({ images: {}, failed: [] });
      setProcessing(false);
      return;
    }
    let cancelled = false;
    setProcessing(true);
    setProgress({ done: 0, total: candidate.data.groups.length });
    cropGroupImages(candidate.data, poster, (done, total) => {
      if (!cancelled) setProgress({ done, total });
    })
      .then((result) => {
        if (cancelled) {
          revokeRuntimeImages(result.images);
          return;
        }
        previewUrlsRef.current = result.images;
        setPreview(result);
      })
      .catch((cause) => {
        if (!cancelled) {
          setPreview({
            images: {},
            failed: candidate.data.groups
              .filter((group) => group.crop?.width)
              .map((group) => group.name),
          });
          setError(cause instanceof Error ? cause.message : "图片裁剪失败。");
        }
      })
      .finally(() => {
        if (!cancelled) setProcessing(false);
      });
    return () => {
      cancelled = true;
      revokeRuntimeImages(previewUrlsRef.current);
      previewUrlsRef.current = {};
    };
  }, [candidate, poster]);

  const parse = (value = text) => {
    try {
      const parsed = parseEventJsonDetailed(value);
      setPreview({ images: {}, failed: [] });
      setProcessing(!!poster);
      setCandidate(parsed);
      if (parsed.city) setCity(parsed.city);
      setError("");
      setToast("");
    } catch (cause) {
      setCandidate(null);
      setProcessing(false);
      setError(cause instanceof Error ? cause.message : "JSON 解析失败。");
    }
  };
  const prepareSmart = (data: EventData, crop: PosterSource | null, cover: PosterSource | null, summary: SmartSourceSummary) => {
    setText(JSON.stringify(data, null, 2));
    setCandidate(parseEventJsonDetailed(JSON.stringify(data)));
    setSourceSummary(summary);
    setPreview({ images: {}, failed: [] });
    setProcessing(!!crop);
    if (crop) onPosterSelect(crop);
    else onPosterClear();
    onDisplayPosterSelect?.(cover);
    onDirtyChange?.(true);
    setError("");
  };
  const useSmartSourcesManually = (crop: PosterSource | null, cover: PosterSource | null, summary: SmartSourceSummary) => {
    if (crop) onPosterSelect(crop);
    else onPosterClear();
    onDisplayPosterSelect?.(cover);
    setSourceSummary(summary);
    setImportMode("manual");
  };
  const loadFile = async (file?: File) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".json")) {
      setError("请选择 .json 文件。");
      return;
    }
    try {
      const value = await file.text();
      setText(value);
      onDirtyChange?.(true);
      parse(value);
    } catch {
      setError("读取 JSON 文件失败，请重试。");
    }
  };
  const uploadPoster = async (file?: File) => {
    if (!file) return;
    try {
      const selected = await readPoster(file);
      setPreview({ images: {}, failed: [] });
      setProcessing(!!candidate);
      onPosterSelect(selected);
      onDirtyChange?.(true);
      setError("");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "海报读取失败，请重新选择图片。",
      );
    }
  };
  const copy = async (value: string, success: string) => {
    try {
      await copyTextToClipboard(value);
      setToast(success);
    } catch {
      setToast("复制失败，请手动复制");
    }
  };
  const confirm = async () => {
    if (!candidate || processing || confirmingRef.current) return;
    if (!city.trim()) { setError("请填写活动城市。"); return; }
    confirmingRef.current = true;
    setProcessing(true);
    try {
      await onImport(candidate.data, preview.images, poster, city.trim());
      onClose();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "服务器保存失败，请重试。",
      );
    } finally {
      confirmingRef.current = false;
      setProcessing(false);
    }
  };
  const download = () => {
    if (!candidate) return;
    const blob = new Blob([JSON.stringify({ ...candidate.data, city: city.trim() }, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${candidate.data.event.date}_${candidate.data.event.title.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, "-")}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  };
  const data = candidate?.data;
  const ratioDifference =
    data && poster ? posterRatioDifference(data, poster) : null;
  const replacementRatioDifference = originalPosterRatio && poster
    ? Math.abs(poster.width / poster.height - originalPosterRatio) / originalPosterRatio
    : 0;
  const noCropCount =
    data?.groups.filter((group) => !group.crop?.width || !group.crop.height)
      .length ?? 0;
  const generatedCount = Object.keys(preview.images).length;
  const warningCount =
    (candidate?.warnings.length ?? 0) +
    preview.failed.length +
    (ratioDifference !== null && ratioDifference >= 0.02 ? 1 : 0) +
    (data && !poster ? 1 : 0);

  return (
    <Sheet title={sheetTitle} onClose={onClose}>
      <label className="input-label" htmlFor="activity-city">活动城市 *</label>
      <input id="activity-city" className="activity-city-input" value={city} maxLength={80}
        onChange={(event) => { setCity(event.target.value); onDirtyChange?.(true); }} placeholder="例如：厦门" disabled={processing} />
      {showDisplayPosterEditor && <div className="cover-editor"><strong>活动列表封面</strong>{displayPoster && <img src={displayPoster.url} alt="当前活动列表封面" />}<button className="secondary-button" disabled={processing} onClick={() => displayPosterFileRef.current?.click()}>更换活动封面</button>{coverReplacementPending && <p className="form-warning">新活动封面尚未保存。</p>}<input ref={displayPosterFileRef} type="file" className="visually-hidden" accept="image/jpeg,image/png,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) void readPoster(file).then((source) => { onDisplayPosterSelect?.(source); onDirtyChange?.(true); setError(""); }).catch((cause) => setError(cause instanceof Error ? cause.message : "封面读取失败。")); event.target.value = ""; }} /></div>}
      {smartEnabled && <div className="smart-mode-tabs import-mode-tabs"><button className={importMode === "smart" ? "selected" : ""} onClick={() => setImportMode("smart")}>智能导入</button><button className={importMode === "manual" ? "selected" : ""} onClick={() => { if (importMode === "smart") setManualRequest((value) => value + 1); }}>手动 JSON</button></div>}
      {smartEnabled && <div hidden={importMode !== "smart"}><SmartImportSection onPrepared={prepareSmart} onManual={useSmartSourcesManually} manualRequest={manualRequest} /></div>}
      <div hidden={importMode !== "manual"}>
      <section className="ocr-workflow" aria-label="AI 海报识别">
        <h3>AI 海报识别</h3>
        <p className="sheet-description">
          上传与 ChatGPT 识别时相同的原始海报，然后复制固定 Prompt。
        </p>
        <div className="ocr-step">
          <span>①</span>
          <strong>上传原始海报</strong>
        </div>
        <button
          className="secondary-button"
          onClick={() => posterRef.current?.click()}
          disabled={processing}
        >
          <ImageUp size={18} /> {poster ? "更换原始海报" : "选择海报"}
        </button>
        <input
          ref={posterRef}
          className="visually-hidden"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={(event) => void uploadPoster(event.target.files?.[0])}
        />
        {poster && (
          <div className="poster-selected">
            <img src={poster.url} alt="已上传的原始海报预览" />
            <div>
              <strong>已选择海报</strong>
              <span>{poster.file.name}</span>
              <small>
                {poster.width} × {poster.height} ·{" "}
                {(poster.file.size / 1024 / 1024).toFixed(1)} MB
              </small>
            </div>
            <button
              className="remove-poster"
              onClick={() => {
                setPreview({ images: {}, failed: [] });
                onPosterClear();
                onDirtyChange?.(true);
              }}
              disabled={processing}
              aria-label="移除海报"
            >
              <X size={17} />
            </button>
          </div>
        )}
        {replacementPending && <p className="form-warning">新海报尚未保存。请检查裁剪预览后再保存修改。</p>}
        {poster && poster.file.size > 20 * 1024 * 1024 && (
          <p className="form-warning">海报文件较大，处理可能需要一些时间。</p>
        )}
        <div className="ocr-step">
          <span>②</span>
          <strong>使用 ChatGPT 识别</strong>
        </div>
        <p className="sheet-description">
          将原始海报和 Prompt 一起发送给 ChatGPT。
        </p>
        <button
          className="secondary-button"
          onClick={() => void copy(OCR_PROMPT, "OCR Prompt 已复制")}
        >
          <ClipboardPaste size={18} /> 复制 OCR Prompt
        </button>
        <details className="prompt-details">
          <summary>查看 Prompt 全文</summary>
          <pre>{OCR_PROMPT}</pre>
        </details>
        {toast && (
          <p className="copy-toast" role="status">
            {toast}
          </p>
        )}
      </section>
      <div className="ocr-step">
        <span>③</span>
        <strong>粘贴 OCR JSON</strong>
      </div>
      <div className="import-choice">
        <button
          disabled={processing}
          onClick={async () => {
            try {
              const value = await navigator.clipboard.readText();
              setText(value);
              onDirtyChange?.(true);
              parse(value);
            } catch {
              setError("无法读取剪贴板，请直接粘贴到下方输入框。");
            }
          }}
        >
          <ClipboardPaste size={20} /> 读取剪贴板
        </button>
        <button disabled={processing} onClick={() => fileRef.current?.click()}>
          <Upload size={20} /> 上传 JSON
        </button>
      </div>
      <input
        ref={fileRef}
        className="visually-hidden"
        type="file"
        accept=".json,application/json"
        onChange={(event) => void loadFile(event.target.files?.[0])}
      />
      <label className="input-label" htmlFor="json-input">
        粘贴 OCR JSON
      </label>
      <textarea
        id="json-input"
        value={text}
        disabled={processing}
        onChange={(event) => {
          setText(event.target.value);
          onDirtyChange?.(true);
          setCandidate(null);
          setError("");
        }}
        placeholder={
          '{\n  "schema_version": "1.0",\n  "event": { ... },\n  "poster": { "width": 0, "height": 0 },\n  "groups": [ ... ]\n}'
        }
        spellCheck={false}
      />
      <button
        className="secondary-button"
        onClick={() => parse()}
        disabled={!text.trim() || processing}
      >
        <FileJson size={18} /> 解析 JSON
      </button>
      <button className="text-button" disabled={!text.trim() || processing} onClick={() => {
        try {
          const parsed = parseEventJsonDetailed(text);
          const parsedCity = parsed.city || city.trim();
          setText(JSON.stringify({ ...parsed.data, ...(parsedCity ? { city: parsedCity } : {}) }, null, 2));
          setCandidate(parsed);
          if (parsed.city) setCity(parsed.city);
          setPreview({ images: {}, failed: [] });
          setProcessing(!!poster);
          setError("");
          onDirtyChange?.(true);
        } catch (cause) { setProcessing(false); setError(cause instanceof Error ? cause.message : "JSON 格式错误。"); }
      }}>格式化 JSON</button>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {processing && (
        <p className="crop-progress" role="status">
          正在处理团体图片 {progress.done} / {progress.total}
        </p>
      )}
      {data && !processing && (
        <section className="import-preview" aria-label="导入预览">
          {sourceSummary && <div className="smart-preview-sources"><strong>素材来源：{sourceSummary.origin} · AI {sourceSummary.mode}</strong><span>时间表：{sourceSummary.timetable.startsWith("/") || sourceSummary.timetable.startsWith("blob:") ? "已选图片" : sourceSummary.timetable}</span><span>团体裁剪：{sourceSummary.crop === "无图片" ? "无图片" : "已选图片"}</span><span>活动封面：{sourceSummary.cover === "无图片" ? "占位图" : "已选图片"}</span><div>{([sourceSummary.timetable, sourceSummary.crop, sourceSummary.cover] as const).map((url, index) => url.startsWith("/") || url.startsWith("blob:") ? <img key={`${index}-${url}`} src={url} alt={["时间表来源", "团体裁剪来源", "活动封面"][index]} loading="lazy" /> : null)}</div></div>}
          {duplicateTitles.includes(`${data.event.date}:${data.event.title}`) && !initialData && (
            <p className="form-warning">可能已经存在相同活动。请核对后再创建。</p>
          )}
          <div className="ocr-step">
            <span>④</span>
            <strong>导入预览</strong>
          </div>
          <div className="preview-event">
            <strong>{data.event.title}</strong>
            <span>
              {data.event.date} · {data.event.venue || "演出现场"}
            </span>
          </div>
          <div className="preview-stats">
            <span>{data.groups.length} 个团体</span>
            <span>{generatedCount} 个裁剪图片</span>
            <span>{noCropCount} 个无 crop</span>
            <span>{preview.failed.length} 个裁剪失败</span>
            <span>{warningCount} 条提示</span>
          </div>
          {!poster && (
            <p className="form-warning">
              未上传原始海报，团体图片将使用已有图片或默认占位图。
            </p>
          )}
          {ratioDifference !== null && ratioDifference >= 0.05 && (
            <p className="form-warning">
              上传的海报比例与 OCR
              识别图片不一致，团体图片裁剪位置可能存在偏差。
            </p>
          )}
          {replacementRatioDifference > 0.05 && (
            <p className="form-warning">新海报比例与原海报不同，当前 crop 位置可能错误，请检查下方裁剪区域。</p>
          )}
          {ratioDifference !== null &&
            ratioDifference >= 0.02 &&
            ratioDifference < 0.05 && (
              <p className="form-warning">海报比例略有差异，请检查裁剪预览。</p>
            )}
          {candidate!.warnings.map((warning, index) => (
            <p className="form-warning" key={`${index}-${warning}`}>
              {warning}
            </p>
          ))}
          {preview.failed.map((name, index) => (
            <p className="form-warning" key={`${index}-${name}`}>
              {name} 的图片裁剪失败，将使用默认图片。
            </p>
          ))}
          <RuntimeImageContext.Provider value={preview.images}>
            <div className="preview-groups">
              {data.groups.map((group) => (
                <div className="preview-group" key={group.id}>
                  <GroupImage group={group} />
                  <div>
                    <strong>{group.name}</strong>
                    <small>
                      {group.start_time && group.end_time
                        ? `${group.start_time}–${group.end_time}`
                        : "时间待核对"}
                    </small>
                  </div>
                </div>
              ))}
            </div>
          </RuntimeImageContext.Provider>
          {poster && (
            <details className="crop-overlay-details">
              <summary>检查海报裁剪区域</summary>
              <div className="poster-overlay">
                <img src={poster.url} alt="带团体裁剪框的原始海报" />
                {data.groups.map((group, index) =>
                  group.crop?.width && group.crop.height ? (
                    <span
                      className="crop-box"
                      key={group.id}
                      style={{
                        left: `${group.crop.x * 100}%`,
                        top: `${group.crop.y * 100}%`,
                        width: `${group.crop.width * 100}%`,
                        height: `${group.crop.height * 100}%`,
                      }}
                    >
                      <span>
                        {String(index + 1).padStart(2, "0")} {group.name}
                      </span>
                    </span>
                  ) : null,
                )}
              </div>
            </details>
          )}
          <div className="export-buttons">
            <button
              onClick={() =>
                void copy(JSON.stringify({ ...data, city: city.trim() }, null, 2), "JSON 已复制")
              }
            >
              <ClipboardPaste size={16} /> 复制 JSON
            </button>
            <button onClick={download}>
              <Download size={16} /> 下载 JSON
            </button>
          </div>
        </section>
      )}
      <button
        className="primary-button"
        onClick={() => void confirm()}
        disabled={!data || !city.trim() || processing}
      >
        {processing ? "处理中…" : submitLabel}
      </button>
    </Sheet>
  );
}

export function PosterHelpSheet({
  onClose,
  onImport,
}: {
  onClose: () => void;
  onImport: () => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <Sheet title="从活动海报导入" onClose={onClose}>
      <div className="poster-help-icon">
        <ImageUp size={30} />
      </div>
      <p className="sheet-description">
        当前版本通过 JSON 导入。把海报交给 OCR 工具识别，并让它按数据协议输出
        JSON；核对后粘贴到这里。
      </p>
      <button
        className="secondary-button"
        onClick={async () => {
          try {
            await copyTextToClipboard(OCR_PROMPT);
            setCopied(true);
          } catch {
            setCopied(false);
          }
        }}
      >
        {copied ? <Check size={18} /> : <ClipboardPaste size={18} />}
        {copied ? "OCR Prompt 已复制" : "复制 OCR Prompt"}
      </button>
      <button className="primary-button" onClick={onImport}>
        继续导入 JSON
      </button>
    </Sheet>
  );
}

export function SettingsSheet({
  data,
  canEdit,
  requiresAuth,
  legacyData,
  onSignIn,
  onSignOut,
  onPublishLegacy,
  onRestore,
  onClose,
}: {
  data: EventData;
  canEdit: boolean;
  requiresAuth: boolean;
  legacyData: EventData | null;
  onSignIn: (key: string) => Promise<void>;
  onSignOut: () => void;
  onPublishLegacy: (data: EventData) => Promise<void>;
  onRestore: () => Promise<void>;
  onClose: () => void;
}) {
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const oldDataDiffers =
    legacyData && JSON.stringify(legacyData) !== JSON.stringify(data);
  const perform = async (action: () => Promise<void>) => {
    setSaving(true);
    setError("");
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "操作失败，请重试。");
    } finally {
      setSaving(false);
    }
  };
  return (
    <Sheet title="设置" onClose={onClose}>
      <div className="settings-detail">
        <span>当前活动</span>
        <strong>{data.event.title}</strong>
        <small>
          {data.event.date} · {data.event.venue || "演出现场"}
        </small>
      </div>
      <p className="sheet-description">
        活动、现场延迟和团体图片保存在服务器，所有浏览器自动同步。管理员密钥验证后会保存在此浏览器，清除浏览器数据前无需重复输入。
      </p>
      {requiresAuth && !canEdit && (
        <div className="admin-access">
          <label className="input-label" htmlFor="admin-key">
            管理员密钥
          </label>
          <input
            id="admin-key"
            type="password"
            autoComplete="off"
            value={key}
            onChange={(event) => setKey(event.target.value)}
            placeholder="输入一次后永久保存在此浏览器"
          />
          <button
            className="primary-button"
            disabled={!key.trim() || saving}
            onClick={() => void perform(() => onSignIn(key.trim()))}
          >
            验证并启用编辑
          </button>
        </div>
      )}
      {canEdit && (
        <>
          <p className="form-success">管理员编辑已启用</p>
          {oldDataDiffers && (
            <div className="legacy-data">
              <strong>此浏览器的旧活动：{legacyData.event.title}</strong>
              <p>旧数据仍保留在浏览器中。发布后将替换所有访客看到的活动。</p>
              <button
                className="secondary-button"
                disabled={saving}
                onClick={() =>
                  void perform(async () => {
                    await onPublishLegacy(legacyData);
                    onClose();
                  })
                }
              >
                发布旧活动到服务器
              </button>
            </div>
          )}
          {!confirmReset ? (
            <button
              className="secondary-button"
              disabled={saving}
              onClick={() => setConfirmReset(true)}
            >
              <RotateCcw size={18} /> 恢复共享 Demo 数据
            </button>
          ) : (
            <div className="reset-confirm">
              <p>这会替换所有访客当前看到的活动。</p>
              <button
                className="secondary-button"
                disabled={saving}
                onClick={() =>
                  void perform(async () => {
                    await onRestore();
                    onClose();
                  })
                }
              >
                确认恢复共享 Demo
              </button>
              <button
                className="text-button"
                onClick={() => setConfirmReset(false)}
              >
                取消
              </button>
            </div>
          )}
          {requiresAuth && (
            <button className="text-button" onClick={onSignOut}>
              退出管理员编辑
            </button>
          )}
        </>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </Sheet>
  );
}
