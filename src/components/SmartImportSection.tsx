import { useEffect, useRef, useState } from "react";
import { ClipboardPaste, ImageUp, Sparkles } from "lucide-react";
import type { EventData, PosterSource } from "../types/timetable";
import type { GroupLibraryRecord } from "../types/groupLibrary";
import { matchGroupBindings } from "../utils/groupMatching";
import type { AiCropDebugData } from "../types/aiCropDebug";
import {
  aiStatus,
  ApiError,
  getAiJob,
  getAiJobRaw,
  listAiJobs,
  parseWeibo,
  submitAiJob,
  type AiJobDetail,
  type AiJobSummary,
  type AiSource,
  type WeiboImportPost,
} from "../utils/activitiesApi";
import { copyTextToClipboard } from "../utils/clipboard";
import { readPoster } from "../utils/poster";
import { parseEventJsonDetailed } from "../utils/validation";
import { OCR_PROMPT } from "../constants/ocrPrompt";
import { EventDataVisualEditor } from "./EventDataVisualEditor";

const WEIBO_COOKIE_KEY = "live-idol-weibo-cookie";
const AI_JOB_KEY = "live-idol-ai-job-id";

function savedWeiboCookie(): string {
  try {
    return window.localStorage.getItem(WEIBO_COOKIE_KEY) ?? "";
  } catch {
    return "";
  }
}

interface ImportImage {
  id: string;
  url: string;
  width: number;
  height: number;
  source: AiSource;
  poster?: PosterSource;
}

export interface SmartSourceSummary {
  timetable: string;
  crop: string;
  cover: string;
  mode: "normal" | "high";
  origin: "微博" | "本地上传";
}

export function SmartImportSection({
  libraryGroups = [],
  onPrepared,
  onCityRecognized,
  onDebug,
  onManual,
  manualRequest,
}: {
  libraryGroups?: GroupLibraryRecord[];
  onPrepared: (
    data: EventData,
    city: string,
    crop: PosterSource | null,
    cover: PosterSource | null,
    summary: SmartSourceSummary,
  ) => void;
  onCityRecognized: (city: string) => void;
  onDebug?: (debug: AiCropDebugData | null, original: { width: number; height: number } | null) => void;
  onManual: (
    crop: PosterSource | null,
    cover: PosterSource | null,
    summary: SmartSourceSummary,
  ) => void;
  manualRequest: number;
}) {
  const [sourceMode, setSourceMode] = useState<"weibo" | "upload">("weibo");
  const [showSources, setShowSources] = useState(true);
  const [cookie, setCookie] = useState(savedWeiboCookie);
  const [rememberCookie, setRememberCookie] = useState(() =>
    Boolean(savedWeiboCookie()),
  );
  const [url, setUrl] = useState("");
  const [post, setPost] = useState<WeiboImportPost | null>(null);
  const [postText, setPostText] = useState("");
  const [images, setImages] = useState<ImportImage[]>([]);
  const [roles, setRoles] = useState<{
    timetable: string;
    crop: string;
    cover: string;
  }>({ timetable: "", crop: "", cover: "" });
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<"weibo" | "ai" | "preview" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState<EventData | null>(null);
  const [originalAi, setOriginalAi] = useState<EventData | null>(null);
  const [mode, setMode] = useState<"normal" | "high">("normal");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [recognizedCity, setRecognizedCity] = useState("");
  const [editorTab, setEditorTab] = useState<"visual" | "json">("json");
  const [jsonDraft, setJsonDraft] = useState("");
  const [draftDirty, setDraftDirty] = useState(false);
  const [debugMode, setDebugMode] = useState(false);
  const [activeJobId, setActiveJobId] = useState(() => {
    try { return window.localStorage.getItem(AI_JOB_KEY) ?? ""; }
    catch { return ""; }
  });
  const [job, setJob] = useState<AiJobSummary | AiJobDetail | null>(null);
  const [recentJobs, setRecentJobs] = useState<AiJobSummary[]>([]);
  const [rawResponse, setRawResponse] = useState("");
  const [rawLoading, setRawLoading] = useState(false);
  const appliedJob = useRef("");
  const localUrls = useRef(new Set<string>());
  const inFlight = useRef(false);

  useEffect(() => {
    aiStatus()
      .then((value) => setConfigured(value.configured))
      .catch(() => setConfigured(false));
    void listAiJobs().then(setRecentJobs).catch(() => undefined);
    return () => {
      for (const blobUrl of localUrls.current) URL.revokeObjectURL(blobUrl);
    };
  }, []);

  useEffect(() => {
    if (!activeJobId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const next = await getAiJob(activeJobId);
        if (stopped) return;
        setJob(next);
        if (next.status === "completed" && next.result && appliedJob.current !== next.id) {
          appliedJob.current = next.id;
          if (!images.length) {
            const recovered: ImportImage[] = [];
            const restoredRoles = { timetable: "", crop: "", cover: "" };
            for (const role of ["timetable", "crop", "cover"] as const) {
              const source = next.sources[role];
              if (!source) continue;
              try {
                const response = await fetch(source.url, { credentials: "same-origin", cache: "no-store" });
                if (!response.ok) throw new Error("图片不可用");
                const blob = await response.blob();
                const poster = await readPoster(new File([blob], `${role}.${source.mime.split("/")[1] ?? "jpg"}`, { type: source.mime }));
                if (stopped) { URL.revokeObjectURL(poster.url); return; }
                localUrls.current.add(poster.url);
                const id = `recovered_${role}`;
                recovered.push({ id, url: poster.url, width: poster.width, height: poster.height, source: { kind: "upload", poster }, poster });
                restoredRoles[role] = id;
              } catch { setError("AI 结果已恢复，但任务图片读取失败；可重新选择图片后生成裁剪预览。"); }
            }
            if (stopped) return;
            setImages(recovered);
            setRoles(restoredRoles);
            setPostText(next.postText);
            if (next.sourceUrl) { setUrl(next.sourceUrl); setSourceMode("weibo"); }
          }
          const result = next.result;
          onDebug?.(result.debug ?? null, next.sources.crop ? { width: next.sources.crop.width, height: next.sources.crop.height } : null);
          setPending(result.data);
          setRecognizedCity(result.city ?? "");
          onCityRecognized(result.city ?? "");
          setOriginalAi(structuredClone(result.data));
          setJsonDraft(JSON.stringify(result.data, null, 2));
          setWarnings(result.warnings);
          setMode(result.mode);
          setDraftDirty(false);
          setEditorTab("json");
          setShowSources(false);
          setNotice(result.city ? `AI 识别完成，城市：${result.city}。请人工核对。` : "AI 识别完成；城市未能确认，请手动填写。请人工核对。");
        }
        if (next.status === "failed") setError(next.error?.message ?? "AI 任务失败，请重试。");
        if (next.status === "queued" || next.status === "running") timer = setTimeout(() => void poll(), 2500);
        else void listAiJobs().then(setRecentJobs).catch(() => undefined);
      } catch (cause) {
        if (stopped) return;
        if (cause instanceof ApiError && cause.status === 404) {
          try { window.localStorage.removeItem(AI_JOB_KEY); } catch { /* Storage may be unavailable. */ }
          setActiveJobId("");
          setJob(null);
          setError("AI 任务记录已过期，请重新识别。");
          return;
        }
        setError(cause instanceof Error ? `查询 AI 任务失败：${cause.message}` : "查询 AI 任务失败，请稍后重试。");
        timer = setTimeout(() => void poll(), 5000);
      }
    };
    void poll();
    return () => { stopped = true; if (timer) clearTimeout(timer); };
  }, [activeJobId]);

  useEffect(() => {
    try {
      if (rememberCookie && cookie.trim())
        window.localStorage.setItem(WEIBO_COOKIE_KEY, cookie);
      else window.localStorage.removeItem(WEIBO_COOKIE_KEY);
    } catch {
      /* Browser storage may be unavailable; the current input still works. */
    }
  }, [cookie, rememberCookie]);

  const byId = (id: string) => images.find((item) => item.id === id) ?? null;
  const jobActive = job?.status === "queued" || job?.status === "running";
  const timetable = byId(roles.timetable);
  const crop = byId(roles.crop) ?? timetable;
  const selectedCover = byId(roles.cover);
  const cover = selectedCover ?? crop;
  const cityContext = selectedCover ?? images.find((item) => item.id !== timetable?.id && item.id !== crop?.id) ?? null;
  const summary = (): SmartSourceSummary => ({
    timetable: timetable?.url ?? (postText.trim() ? "微博正文" : "未选择"),
    crop: crop?.url ?? "无图片",
    cover: cover?.url ?? "无图片",
    mode,
    origin:
      post || job?.sourceUrl ||
      [timetable, crop, cover].some((item) => item?.source.kind === "weibo")
        ? "微博"
        : "本地上传",
  });
  const updatePending = (next: EventData) => {
    setPending(next);
    setJsonDraft(JSON.stringify(next, null, 2));
    setDraftDirty(true);
    setError("");
  };
  const showVisualEditor = () => {
    if (!pending) return;
    if (jsonDraft !== JSON.stringify(pending, null, 2)) {
      try {
        const parsed = parseEventJsonDetailed(jsonDraft);
        if (parsed.city) {
          setRecognizedCity(parsed.city);
          onCityRecognized(parsed.city);
        }
        updatePending(parsed.data);
        setWarnings(parsed.warnings);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "JSON 格式错误，请先修正草稿。");
        return;
      }
    }
    setEditorTab("visual");
  };

  const fetchPost = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy("weibo");
    setError("");
    setNotice("");
    try {
      const fetched = await parseWeibo(url.trim(), cookie);
      setPost(fetched);
      setPostText(
        fetched.text +
          (fetched.repost_text ? `\n\n转发内容：\n${fetched.repost_text}` : ""),
      );
      setImages(
        fetched.images.map((item) => ({
          id: item.id,
          url: item.local_url,
          width: item.width,
          height: item.height,
          source: {
            kind: "weibo",
            importId: fetched.importId,
            imageId: item.id,
          },
        })),
      );
      setRoles({ timetable: "", crop: "", cover: "" });
      setWarnings(fetched.warnings);
      setNotice(
        fetched.images.length
          ? `已获取微博正文和 ${fetched.images.length} 张图片。请选择图片角色。`
          : "已获取微博正文，但未取得图片。如果原微博有图，请检查下方提示或改用本地上传。",
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "获取微博失败，请改用本地上传。",
      );
    } finally {
      if (!rememberCookie) setCookie("");
      setBusy(null);
      inFlight.current = false;
    }
  };

  const addLocal = async (
    file: File | undefined,
    role: "timetable" | "crop" | "cover",
  ) => {
    if (!file) return;
    try {
      const poster = await readPoster(file);
      localUrls.current.add(poster.url);
      const id = `upload_${crypto.randomUUID()}`;
      const image: ImportImage = {
        id,
        url: poster.url,
        width: poster.width,
        height: poster.height,
        source: { kind: "upload", poster },
        poster,
      };
      setImages((current) => [...current, image]);
      setRoles((current) => ({ ...current, [role]: id }));
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "图片读取失败。");
    }
  };

  const recognize = async (requestedMode: "normal" | "high") => {
    if (inFlight.current || job?.status === "queued" || job?.status === "running" || (!timetable && !postText.trim())) return;
    if (
      draftDirty &&
      pending &&
      !window.confirm("重新识别将覆盖当前尚未保存的人工修改。确定继续吗？")
    )
      return;
    inFlight.current = true;
    setBusy("ai");
    setError("");
    setNotice("");
    setRawResponse("");
    onDebug?.(null, null);
    try {
      const submitted = await submitAiJob({
        timetableSource: timetable?.source ?? null,
        cropSource: crop?.source ?? null,
        coverSource: cityContext?.source ?? null,
        weiboText: postText,
        weiboUrl: post?.url,
        mode: requestedMode,
        debug: debugMode,
      });
      appliedJob.current = "";
      setJob(submitted);
      setActiveJobId(submitted.id);
      try { window.localStorage.setItem(AI_JOB_KEY, submitted.id); } catch { /* The current page can still poll. */ }
      setMode(requestedMode);
      setNotice("AI 任务已提交到服务器。可以离开此页面，返回后继续查看结果。");
      void listAiJobs().then(setRecentJobs).catch(() => undefined);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "AI 识别失败，可改用手动 JSON。",
      );
    } finally {
      setBusy(null);
      inFlight.current = false;
    }
  };

  const showRawResponse = async () => {
    if (!job?.hasRawResponse || rawLoading) return;
    setRawLoading(true);
    try { setRawResponse(await getAiJobRaw(job.id)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "AI 原始响应读取失败。"); }
    finally { setRawLoading(false); }
  };

  const resumeJob = (id: string) => {
    if (draftDirty && pending && !window.confirm("当前人工修改尚未保存。确定切换 AI 任务吗？")) return;
    if (id === activeJobId) return;
    for (const blobUrl of localUrls.current) URL.revokeObjectURL(blobUrl);
    localUrls.current.clear();
    appliedJob.current = "";
    setJob(null);
    setPending(null);
    setOriginalAi(null);
    setJsonDraft("");
    setWarnings([]);
    setPost(null);
    setPostText("");
    setImages([]);
    setRoles({ timetable: "", crop: "", cover: "" });
    setRawResponse("");
    setError("");
    setActiveJobId(id);
    try { window.localStorage.setItem(AI_JOB_KEY, id); } catch { /* The current page can still poll. */ }
  };

  const resolvePoster = async (
    image: ImportImage | null,
  ): Promise<PosterSource | null> => {
    if (!image) return null;
    if (image.poster) return readPoster(image.poster.file);
    const response = await fetch(image.url, {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!response.ok) throw new Error("微博图片已失效，请重新获取微博。");
    const blob = await response.blob();
    const poster = await readPoster(
      new File([blob], `${image.id}.${blob.type.split("/")[1] ?? "jpg"}`, {
        type: blob.type,
      }),
    );
    return poster;
  };

  const applyPreview = async () => {
    if (!pending || inFlight.current || jobActive) return;
    if (
      editorTab === "json" &&
      jsonDraft !== JSON.stringify(pending, null, 2)
    ) {
      setError("JSON 草稿尚未应用，请先点击“应用 JSON 修改”。");
      return;
    }
    inFlight.current = true;
    setBusy("preview");
    setError("");
    let cropPoster: PosterSource | null = null;
    let coverPoster: PosterSource | null = null;
    let transferred = false;
    try {
      const ordered = [...pending.groups].sort((a, b) => {
        const valid = /^([01]\d|2[0-3]):[0-5]\d$/;
        return (
          valid.test(a.start_time) ? a.start_time : "99:99"
        ).localeCompare(valid.test(b.start_time) ? b.start_time : "99:99");
      });
      const next = {
        ...pending,
        delay_minutes: 0,
        poster: { width: crop?.width ?? 0, height: crop?.height ?? 0 },
        groups: ordered.map((group, index) => ({
          ...group,
          id: `group_${String(index + 1).padStart(3, "0")}`,
        })),
      };
      const checked = parseEventJsonDetailed(JSON.stringify(next));
      cropPoster = await resolvePoster(crop);
      coverPoster =
        cover?.id === crop?.id ? cropPoster : await resolvePoster(cover);
      setPending(checked.data);
      setJsonDraft(JSON.stringify(checked.data, null, 2));
      setWarnings(checked.warnings);
      onPrepared(checked.data, recognizedCity, cropPoster, coverPoster, summary());
      transferred = true;
      try { window.localStorage.removeItem(AI_JOB_KEY); } catch { /* The imported draft is already available. */ }
    } catch (cause) {
      if (!transferred) {
        if (cropPoster) URL.revokeObjectURL(cropPoster.url);
        if (coverPoster && coverPoster !== cropPoster)
          URL.revokeObjectURL(coverPoster.url);
      }
      setError(
        cause instanceof Error ? cause.message : "预览生成失败，请检查数据。",
      );
    } finally {
      setBusy(null);
      inFlight.current = false;
    }
  };

  const applyJson = () => {
    try {
      const parsed = parseEventJsonDetailed(jsonDraft);
      if (parsed.city) {
        setRecognizedCity(parsed.city);
        onCityRecognized(parsed.city);
      }
      updatePending(parsed.data);
      setWarnings(parsed.warnings);
      setNotice("JSON 修改已应用；请生成预览后确认导入。");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "JSON 格式错误，当前合法草稿未改变。",
      );
    }
  };

  const switchToManual = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy("preview");
    let cropPoster: PosterSource | null = null;
    let coverPoster: PosterSource | null = null;
    let transferred = false;
    try {
      cropPoster = await resolvePoster(crop);
      coverPoster =
        cover?.id === crop?.id ? cropPoster : await resolvePoster(cover);
      onManual(cropPoster, coverPoster, summary());
      transferred = true;
    } catch (cause) {
      if (!transferred) {
        if (cropPoster) URL.revokeObjectURL(cropPoster.url);
        if (coverPoster && coverPoster !== cropPoster)
          URL.revokeObjectURL(coverPoster.url);
      }
      setError(
        cause instanceof Error
          ? cause.message
          : "图片读取失败，请重新选择图片。",
      );
    } finally {
      setBusy(null);
      inFlight.current = false;
    }
  };
  useEffect(() => {
    if (manualRequest > 0) void switchToManual();
  }, [manualRequest]);

  const matchedBindings = pending ? matchGroupBindings(pending.groups, libraryGroups) : {};

  return (
    <section className="smart-import" aria-label="智能导入">
      <div className="smart-heading">
        <Sparkles size={20} />
        <strong>智能导入</strong>
        <span>素材 → AI → 人工检查 → 预览</span>
      </div>
      {pending && (
        <button
          className="text-button"
          onClick={() => setShowSources((current) => !current)}
        >
          {showSources ? "收起素材来源" : "检查或更换素材来源"}
        </button>
      )}
      {showSources && (
        <>
          <div className="smart-mode-tabs">
            <button
              className={sourceMode === "weibo" ? "selected" : ""}
              disabled={jobActive}
              onClick={() => setSourceMode("weibo")}
            >
              从微博获取
            </button>
            <button
              className={sourceMode === "upload" ? "selected" : ""}
              disabled={jobActive}
              onClick={() => setSourceMode("upload")}
            >
              本地上传图片
            </button>
          </div>
          {sourceMode === "weibo" ? (
            <div className="smart-fields">
              <label>
                微博 Cookie
                <textarea
                  value={cookie}
                  onChange={(event) => setCookie(event.target.value)}
                  autoComplete="off"
                  placeholder="SUB=...; SUBP=..."
                  spellCheck={false}
                />
              </label>
              <label className="smart-cookie-choice">
                <input
                  type="checkbox"
                  checked={rememberCookie}
                  onChange={(event) => setRememberCookie(event.target.checked)}
                />
                在此浏览器记住 Cookie
              </label>
              {rememberCookie && (
                <button
                  className="text-button"
                  onClick={() => {
                    setCookie("");
                    setRememberCookie(false);
                  }}
                >
                  清除已保存的 Cookie
                </button>
              )}
              <label>
                单条微博链接
                <input
                  type="url"
                  value={url}
                  disabled={jobActive}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="https://weibo.com/..."
                />
              </label>
              <button
                className="secondary-button"
                disabled={!!busy || jobActive || !url.trim() || !cookie.trim()}
                onClick={() => void fetchPost()}
              >
                {busy === "weibo" ? "正在获取微博…" : "获取微博"}
              </button>
              {post && (
                <div className="smart-post">
                  <strong>@{post.author.name}</strong>
                  <small>{post.created_at}</small>
                  <p>{post.text}</p>
                  {post.repost_text && <p>转发内容：{post.repost_text}</p>}
                </div>
              )}
              {post?.text && (
                <button
                  className="text-button"
                  onClick={() =>
                    void copyTextToClipboard(
                      `${OCR_PROMPT}\n\n微博正文参考：\n${postText}`,
                    )
                      .then(() => setNotice("Prompt 和微博正文已复制"))
                      .catch(() => setError("复制失败，请手动复制。"))
                  }
                >
                  <ClipboardPaste size={16} /> 复制 OCR Prompt + 微博正文
                </button>
              )}
            </div>
          ) : (
            <div className="smart-upload-fields">
              {(["timetable", "crop", "cover"] as const).map((role) => (
                <label key={role} className="smart-file-button">
                  <ImageUp size={18} />{" "}
                  {role === "timetable"
                    ? "上传时间表图片"
                    : role === "crop"
                      ? "上传团体视觉图片"
                      : "上传活动封面（可选）"}
                  <input
                    type="file"
                    disabled={jobActive}
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(event) => {
                      void addLocal(event.target.files?.[0], role);
                      event.target.value = "";
                    }}
                  />
                </label>
              ))}
            </div>
          )}
          <label className="smart-text-label">
            微博正文 / 时间表文字
            <textarea
              value={postText}
              disabled={jobActive}
              onChange={(event) => setPostText(event.target.value)}
              placeholder="例如：14:00 Gara\n14:20 眩晕症Megrims\n14:40 Koisa"
            />
          </label>
          {images.length > 0 && (
            <div className="smart-gallery">
              {images.map((image, index) => (
                <div className="smart-image" key={image.id}>
                  <img
                    src={image.url}
                    alt={`素材图 ${index + 1}`}
                    loading="lazy"
                  />
                  <strong>
                    图 {index + 1} · {image.width} × {image.height}
                  </strong>
                  <div className="smart-image-roles">
                    {(["timetable", "crop", "cover"] as const).map((role) => (
                      <button
                        key={role}
                        className={roles[role] === image.id ? "selected" : ""}
                        disabled={jobActive}
                        onClick={() =>
                          setRoles((current) => ({
                            ...current,
                            [role]: current[role] === image.id ? "" : image.id,
                          }))
                        }
                      >
                        {role === "timetable"
                          ? "时间表"
                          : role === "crop"
                            ? "团体图"
                            : "活动封面"}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
      <div className="smart-source-summary">
        <strong>AI 输入来源</strong>
        <span>
          时间表：
          {timetable
            ? `图 ${images.indexOf(timetable) + 1}`
            : postText.trim()
              ? "正文"
              : "未选择"}
        </span>
        <span>
          团体裁剪：
          {crop ? `图 ${images.indexOf(crop) + 1}` : "无图片，crop 为 0"}
        </span>
        <span>
          活动封面：{cover ? `图 ${images.indexOf(cover) + 1}` : "占位图"}
        </span>
        <span>
          城市参考图：{cityContext ? `图 ${images.indexOf(cityContext) + 1}` : "使用时间表图 / 正文"}
        </span>
      </div>
      {configured === false && (
        <p className="form-warning">
          AI 自动识别未配置，请使用手动 JSON。微博素材和正文仍可获取。
        </p>
      )}
      <label className="ai-crop-debug-choice">
        <input type="checkbox" checked={debugMode} disabled={!!busy || jobActive} onChange={(event) => setDebugMode(event.target.checked)} />
        AI Crop Debug（下次识别保留 rawCrop 和实际 AI 输入图；可能增加响应体积）
      </label>
      <button
        className="primary-button"
        disabled={
          !!busy || configured === false || jobActive || (!timetable && !postText.trim())
        }
        onClick={() => void recognize("normal")}
      >
        {busy === "ai" ? "AI 识别中…" : "AI 识别 Timetable"}
      </button>
      {busy === "ai" && <p className="sheet-description" role="status">图片较多时识别可能需要几分钟，请保持页面打开。</p>}
      <button
        className="secondary-button"
        disabled={!!busy || configured === false || jobActive || (!timetable && !postText.trim())}
        onClick={() => void recognize("high")}
      >
        高精度识别 Timetable
      </button>
      {job && <section className="ai-job-card" aria-live="polite">
        <strong>AI 识别任务</strong>
        <p>{job.status === "queued" ? `排队中 · 第 ${Math.max(1, job.queuePosition)} 位` : job.status === "running" ? "服务器正在识别…" : job.status === "completed" ? "识别完成 · 请核对下方草稿" : "识别失败 · 可查看原始响应后重试"}</p>
        <small>任务 {job.id.slice(0, 8)} · {job.mode === "high" ? "高精度" : "普通"}模式。关闭页面后任务仍会在服务器继续。</small>
        {job.sourceUrl && <small>来源：{job.sourceUrl}</small>}
        {(job.model || job.provider || job.finishReason) && <small>模型：{job.model ?? "识别中"}{job.provider ? ` · ${job.provider}` : ""}{job.finishReason ? ` · 结束原因 ${job.finishReason}` : ""}</small>}
        {job.outputTokens !== undefined && <small>输出 {job.outputTokens} tokens{job.reasoningTokens !== undefined ? `（推理 ${job.reasoningTokens}）` : ""}</small>}
        {job.error && <p className="form-error" role="alert">{job.error.message}</p>}
        {job.hasRawResponse && <div className="ai-job-actions">
          {job.rawComplete === false && <small>响应在传输中中断，以下仅是已收到的部分内容。</small>}
          <button type="button" className="text-button" disabled={rawLoading} onClick={() => void showRawResponse()}>{rawLoading ? "读取中…" : "查看 AI 原始响应"}</button>
          <a href={`/api/admin/ai/jobs/${job.id}/raw?download=1`}>下载原始响应</a>
        </div>}
        {rawResponse && <pre className="ai-raw-response">{rawResponse}</pre>}
      </section>}
      {recentJobs.length > 0 && <details className="ai-job-history">
        <summary>最近 AI 任务（保留 30 天）</summary>
        {recentJobs.slice(0, 8).map((item) => <div className="ai-job-history-row" key={item.id}>
          <span>{new Date(item.createdAt).toLocaleString("zh-CN")} · {item.mode === "high" ? "高精度" : "普通"} · {item.status === "queued" ? "排队中" : item.status === "running" ? "识别中" : item.status === "completed" ? "已完成" : "失败"}{item.sourceUrl ? ` · ${item.sourceUrl.split("/").pop()}` : ""}</span>
          <button type="button" className="text-button" disabled={item.id === activeJobId} onClick={() => resumeJob(item.id)}>查看任务</button>
        </div>)}
      </details>}
      <button
        className="text-button"
        disabled={!!busy}
        onClick={() => void switchToManual()}
      >
        改用手动 JSON / 复制 OCR Prompt
      </button>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="form-success" role="status">
          {notice}
        </p>
      )}
      {warnings.map((warning, index) => (
        <p className="form-warning" key={`${index}-${warning}`}>
          {warning}
        </p>
      ))}
      {pending && (
        <section className="smart-pending">
          <h3>人工检查 AI 识别结果</h3>
          <details className="smart-group-matches"><summary>团体库精确匹配 · {Object.keys(matchedBindings).length}/{pending.groups.length}</summary>
            <p className="sheet-description">团体名会忽略简繁、英文大小写及首尾装饰性连字符后匹配。请在导入预览核对头像、手动调整绑定，未匹配团体继续使用本场裁剪。</p>
            <div>{pending.groups.map((group) => { const matched = libraryGroups.find((entry) => entry.id === matchedBindings[group.id]); return <div className="smart-match-row" key={group.id}>{matched?.avatarUrl ? <img src={matched.avatarUrl} alt="" /> : <span>✦</span>}<strong>{group.name}</strong><small>{matched ? "✓ 已匹配团体库" : "未匹配 · 使用 AI crop"}</small></div>; })}</div>
          </details>
          <div className="smart-mode-tabs">
            <button
              className={editorTab === "json" ? "selected" : ""}
              onClick={() => setEditorTab("json")}
            >
              JSON 编辑
            </button>
            <button
              className={editorTab === "visual" ? "selected" : ""}
              onClick={showVisualEditor}
            >
              可视化编辑
            </button>
          </div>
          {editorTab === "visual" ? (
            <EventDataVisualEditor data={pending} onChange={updatePending} />
          ) : (
            <>
              <textarea
                className="smart-json-draft"
                aria-label="AI 识别结果 JSON"
                value={jsonDraft}
                onChange={(event) => setJsonDraft(event.target.value)}
                spellCheck={false}
              />
              <div className="smart-json-actions">
                <button onClick={applyJson}>应用 JSON 修改</button>
                <button
                  onClick={() => {
                    try {
                      setJsonDraft(
                        JSON.stringify(JSON.parse(jsonDraft), null, 2),
                      );
                      setError("");
                    } catch {
                      setError("JSON 格式错误，无法格式化。");
                    }
                  }}
                >
                  格式化
                </button>
                <button
                  onClick={() =>
                    void copyTextToClipboard(jsonDraft)
                      .then(() => setNotice("JSON 已复制"))
                      .catch(() => setError("复制失败。"))
                  }
                >
                  复制 JSON
                </button>
              </div>
            </>
          )}
          {originalAi && (
            <button
              className="text-button"
              onClick={() => {
                if (
                  draftDirty &&
                  !window.confirm(
                    "恢复 AI 原始结果会丢失当前人工修改。确定继续吗？",
                  )
                )
                  return;
                const copy = structuredClone(originalAi);
                setPending(copy);
                setJsonDraft(JSON.stringify(copy, null, 2));
                setDraftDirty(false);
              }}
            >
              恢复 AI 原始结果
            </button>
          )}
          <button
            className="primary-button"
            disabled={!!busy || jobActive}
            onClick={() => void applyPreview()}
          >
            {busy === "preview" ? "正在生成预览…" : "应用修改并生成导入预览"}
          </button>
        </section>
      )}
    </section>
  );
}
