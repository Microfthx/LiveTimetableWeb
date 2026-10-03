import { useEffect, useRef, useState } from "react";
import { ClipboardPaste, ImageUp, Sparkles } from "lucide-react";
import type { EventData, PosterSource } from "../types/timetable";
import {
  aiStatus,
  parseWeibo,
  recognizeTimetable,
  type AiSource,
  type WeiboImportPost,
} from "../utils/activitiesApi";
import { copyTextToClipboard } from "../utils/clipboard";
import { readPoster } from "../utils/poster";
import { parseEventJsonDetailed } from "../utils/validation";
import { OCR_PROMPT } from "../constants/ocrPrompt";
import { EventDataVisualEditor } from "./EventDataVisualEditor";

const WEIBO_COOKIE_KEY = "live-idol-weibo-cookie";

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
  onPrepared,
  onCityRecognized,
  onManual,
  manualRequest,
}: {
  onPrepared: (
    data: EventData,
    city: string,
    crop: PosterSource | null,
    cover: PosterSource | null,
    summary: SmartSourceSummary,
  ) => void;
  onCityRecognized: (city: string) => void;
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
  const localUrls = useRef(new Set<string>());
  const inFlight = useRef(false);

  useEffect(() => {
    aiStatus()
      .then((value) => setConfigured(value.configured))
      .catch(() => setConfigured(false));
    return () => {
      for (const blobUrl of localUrls.current) URL.revokeObjectURL(blobUrl);
    };
  }, []);

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
      post ||
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
    if (inFlight.current || (!timetable && !postText.trim())) return;
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
    try {
      const result = await recognizeTimetable({
        timetableSource: timetable?.source ?? null,
        cropSource: crop?.source ?? null,
        coverSource: cityContext?.source ?? null,
        weiboText: postText,
        mode: requestedMode,
      });
      setPending(result.data);
      setRecognizedCity(result.city ?? "");
      onCityRecognized(result.city ?? "");
      setOriginalAi(structuredClone(result.data));
      setJsonDraft(JSON.stringify(result.data, null, 2));
      setWarnings(result.warnings);
      setMode(requestedMode);
      setDraftDirty(false);
      setEditorTab("json");
      setShowSources(false);
      setNotice(result.city
        ? `AI 识别完成，城市：${result.city}。请人工核对，再生成导入预览。`
        : "AI 识别完成；城市未能确认，请手动填写。请人工核对，再生成导入预览。");
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
    if (!pending || inFlight.current) return;
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
              onClick={() => setSourceMode("weibo")}
            >
              从微博获取
            </button>
            <button
              className={sourceMode === "upload" ? "selected" : ""}
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
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="https://weibo.com/..."
                />
              </label>
              <button
                className="secondary-button"
                disabled={!!busy || !url.trim() || !cookie.trim()}
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
      <button
        className="primary-button"
        disabled={
          !!busy || configured === false || (!timetable && !postText.trim())
        }
        onClick={() => void recognize("normal")}
      >
        {busy === "ai" ? "AI 识别中…" : "AI 识别 Timetable"}
      </button>
      {pending && (
        <button
          className="secondary-button"
          disabled={!!busy || configured === false}
          onClick={() => void recognize("high")}
        >
          重新识别 Timetable
        </button>
      )}
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
            disabled={!!busy}
            onClick={() => void applyPreview()}
          >
            {busy === "preview" ? "正在生成预览…" : "应用修改并生成导入预览"}
          </button>
        </section>
      )}
    </section>
  );
}
