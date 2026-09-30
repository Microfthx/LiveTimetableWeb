import { useEffect, useRef, useState } from "react";
import {
  CalendarDays,
  Check,
  CloudUpload,
  Home,
  ImageUp,
  Settings2,
  Star,
  Upload,
} from "lucide-react";
import {
  Header,
  NowPlayingCard,
  NextUpCard,
  DelayControl,
  TimetableList,
} from "./components/Cards";
import {
  DelayBottomSheet,
  ImportBottomSheet,
  SettingsSheet,
} from "./components/Sheets";
import { RuntimeImageContext } from "./components/GroupImage";
import { demoData } from "./data/demo";
import { useCurrentTime } from "./hooks/useCurrentTime";
import type { EventData, PosterSource } from "./types/timetable";
import { getCurrentPerformance, getNextPerformance } from "./utils/time";
import { loadStoredEventData } from "./utils/storage";
import { revokeRuntimeImages, type RuntimeGroupImages } from "./utils/poster";
import {
  ApiError,
  clearAdminKey,
  fetchSharedState,
  loadAdminKey,
  publishSharedEvent,
  resetSharedEvent,
  saveAdminKey,
  setSharedDelay,
  verifyAdminKey,
  type SharedState,
} from "./utils/sharedApi";

type OpenSheet = "delay" | "import" | "settings" | null;

export default function App() {
  const [data, setData] = useState<EventData>(demoData);
  const [legacyData] = useState(loadStoredEventData);
  const [syncStatus, setSyncStatus] = useState<
    "loading" | "online" | "offline"
  >("loading");
  const [syncError, setSyncError] = useState("");
  const [requiresAuth, setRequiresAuth] = useState(true);
  const [adminKey, setAdminKey] = useState(loadAdminKey);
  const [authorized, setAuthorized] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const revisionRef = useRef(0);
  const [sheet, setSheet] = useState<OpenSheet>(null);
  const [importMode, setImportMode] = useState<"paste" | "file" | "poster">(
    "paste",
  );
  const [poster, setPoster] = useState<PosterSource | null>(null);
  const posterRef = useRef<PosterSource | null>(null);
  const [activityToken, setActivityToken] = useState(0);
  const [runtime, setRuntime] = useState<{
    token: number;
    images: RuntimeGroupImages;
  }>({ token: 0, images: {} });
  const runtimeRef = useRef<RuntimeGroupImages>({});
  const [notice, setNotice] = useState("");
  const now = useCurrentTime();
  const topRef = useRef<HTMLDivElement>(null);
  const current = getCurrentPerformance(data, now);
  const next = getNextPerformance(data, now);
  const canEdit = syncStatus === "online" && (!requiresAuth || authorized);

  const applySharedState = (shared: SharedState) => {
    setRequiresAuth(shared.requires_auth);
    if (shared.revision < revisionRef.current) return;
    if (shared.revision === revisionRef.current) return;
    revokeRuntimeImages(runtimeRef.current);
    runtimeRef.current = shared.images;
    revisionRef.current = shared.revision;
    setActivityToken(shared.revision);
    setRuntime({ token: shared.revision, images: shared.images });
    setData(shared.data);
  };

  useEffect(() => {
    let active = true;
    let fetching = false;
    const refresh = async () => {
      if (fetching) return;
      fetching = true;
      try {
        const shared = await fetchSharedState();
        if (!active) return;
        applySharedState(shared);
        setSyncStatus("online");
        setSyncError("");
      } catch (cause) {
        if (!active) return;
        setSyncStatus("offline");
        setSyncError(
          cause instanceof Error ? cause.message : "无法连接服务器。",
        );
      } finally {
        fetching = false;
      }
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), 3000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      active = false;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, []);

  useEffect(() => {
    if (!adminKey || !requiresAuth || syncStatus !== "online") {
      setAuthorized(!requiresAuth && syncStatus === "online");
      return;
    }
    let active = true;
    verifyAdminKey(adminKey)
      .then(() => {
        if (active) setAuthorized(true);
      })
      .catch(() => {
        if (active) setAuthorized(false);
      });
    return () => {
      active = false;
    };
  }, [adminKey, requiresAuth, syncStatus]);
  useEffect(
    () => () => {
      revokeRuntimeImages(runtimeRef.current);
      if (posterRef.current) URL.revokeObjectURL(posterRef.current.url);
    },
    [],
  );
  const selectPoster = (selected: PosterSource) => {
    if (posterRef.current) URL.revokeObjectURL(posterRef.current.url);
    posterRef.current = selected;
    setPoster(selected);
  };
  const clearPoster = () => {
    if (posterRef.current) URL.revokeObjectURL(posterRef.current.url);
    posterRef.current = null;
    setPoster(null);
  };
  const mutate = async (
    action: (key: string) => Promise<SharedState>,
    success: string,
  ) => {
    if (!canEdit) throw new Error("请先在设置中输入管理员密钥。");
    if (busyRef.current) throw new Error("正在保存，请稍后重试。");
    busyRef.current = true;
    setBusy(true);
    try {
      const shared = await action(adminKey);
      applySharedState(shared);
      setNotice(success);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        clearAdminKey();
        setAdminKey("");
        setAuthorized(false);
      }
      const message =
        cause instanceof Error ? cause.message : "服务器保存失败。";
      setNotice(message);
      throw cause;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const updateDelay = (change: { delta: number } | { value: number }) =>
    mutate((key) => setSharedDelay(change, key), "现场延迟已同步到所有浏览器");
  const importData = async (
    imported: EventData,
    images: RuntimeGroupImages,
  ) => {
    await mutate(
      (key) => publishSharedEvent(imported, images, revisionRef.current, key),
      `已向所有浏览器发布 ${imported.event.title}`,
    );
    clearPoster();
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const restore = () => mutate(resetSharedEvent, "已恢复共享 Demo 数据");
  const signIn = async (key: string) => {
    await verifyAdminKey(key);
    saveAdminKey(key);
    setAdminKey(key);
    setAuthorized(true);
  };
  const signOut = () => {
    clearAdminKey();
    setAdminKey("");
    setAuthorized(false);
  };
  const scrollToTimetable = () =>
    document
      .getElementById("timetable")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  if (revisionRef.current === 0) {
    return (
      <div className="sync-screen" role="status">
        <h1>Live Idol Timetable</h1>
        <p>{syncStatus === "offline" ? syncError : "正在读取服务器时间表…"}</p>
        {syncStatus === "offline" && (
          <button
            className="primary-button"
            onClick={() => window.location.reload()}
          >
            重试连接
          </button>
        )}
      </div>
    );
  }
  return (
    <RuntimeImageContext.Provider
      value={runtime.token === activityToken ? runtime.images : {}}
    >
      <div className="page-shell" ref={topRef}>
        <Header data={data} onSettings={() => setSheet("settings")} />
        <main className="page-content">
          <div
            className={`sync-indicator ${syncStatus === "offline" ? "sync-offline" : ""}`}
            role="status"
          >
            {syncStatus === "online"
              ? canEdit
                ? "服务器已同步 · 管理员"
                : "服务器已同步 · 只读"
              : `服务器连接中断：${syncError}`}
          </div>
          {notice && (
            <div className="notice" role="status">
              <Check size={16} /> {notice}
              <button onClick={() => setNotice("")} aria-label="关闭提示">
                ×
              </button>
            </div>
          )}
          <NowPlayingCard data={data} now={now} current={current} next={next} />
          <NextUpCard
            data={data}
            now={now}
            current={current}
            next={next}
            onClick={scrollToTimetable}
          />
          <DelayControl
            delay={data.delay_minutes}
            onChange={(delta) =>
              void updateDelay({ delta }).catch(() => undefined)
            }
            onReset={() =>
              void updateDelay({ value: 0 }).catch(() => undefined)
            }
            onOpen={() => setSheet("delay")}
            disabled={!canEdit || busy}
          />
          <TimetableList data={data} now={now} nextId={next?.id} />
          <section className="import-card" aria-label="导入时间表">
            <div className="import-heading">
              <CloudUpload size={27} />
              <div>
                <h2>导入 Timetable</h2>
                <p>导入活动数据</p>
              </div>
              <Star size={19} className="import-star" />
            </div>
            <div className="import-buttons">
              <button
                disabled={!canEdit || busy}
                onClick={() => {
                  setImportMode("paste");
                  setSheet("import");
                }}
              >
                <span>
                  <Upload size={19} /> 粘贴 JSON
                </span>
              </button>
              <button
                disabled={!canEdit || busy}
                onClick={() => {
                  setImportMode("file");
                  setSheet("import");
                }}
              >
                <span>
                  <CloudUpload size={19} /> 上传 JSON
                </span>
              </button>
              <button
                disabled={!canEdit || busy}
                onClick={() => {
                  setImportMode("poster");
                  setSheet("import");
                }}
              >
                <span>
                  <ImageUp size={19} /> 扫描 / 导入活动海报
                </span>
              </button>
            </div>
            <div className="import-foot">
              <div>
                <span>
                  <Check size={16} /> 活动信息
                </span>
                <span>
                  <Check size={16} /> {data.groups.length} 个团体
                </span>
                <span>
                  <Check size={16} /> {data.groups.length} 个演出时间
                </span>
                <span>
                  <Check size={16} />{" "}
                  {
                    data.groups.filter(
                      (group) => runtime.images[group.id] || group.image_base64,
                    ).length
                  }{" "}
                  张团体图片
                </span>
              </div>
              <button
                disabled={!canEdit || busy}
                onClick={() => {
                  setImportMode("paste");
                  setSheet("import");
                }}
              >
                确认导入
              </button>
            </div>
          </section>
        </main>
        <nav className="bottom-nav" aria-label="主导航">
          <button
            className="active"
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          >
            <Home size={22} fill="currentColor" />
            <span>LIVE</span>
          </button>
          <button onClick={scrollToTimetable}>
            <CalendarDays size={22} />
            <span>TIMETABLE</span>
          </button>
          <button onClick={() => setSheet("settings")}>
            <Settings2 size={22} />
            <span>SETTINGS</span>
          </button>
        </nav>
        {sheet === "delay" && (
          <DelayBottomSheet
            delay={data.delay_minutes}
            onApply={(value) =>
              void updateDelay({ value }).catch(() => undefined)
            }
            onClose={() => setSheet(null)}
          />
        )}
        {sheet === "import" && (
          <ImportBottomSheet
            mode={importMode}
            poster={poster}
            onPosterSelect={selectPoster}
            onPosterClear={clearPoster}
            onImport={importData}
            onClose={() => setSheet(null)}
          />
        )}
        {sheet === "settings" && (
          <SettingsSheet
            data={data}
            canEdit={canEdit}
            requiresAuth={requiresAuth}
            legacyData={legacyData}
            onSignIn={signIn}
            onSignOut={signOut}
            onPublishLegacy={(old) => importData(old, {})}
            onRestore={restore}
            onClose={() => setSheet(null)}
          />
        )}
      </div>
    </RuntimeImageContext.Provider>
  );
}
