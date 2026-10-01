import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, CalendarDays, Home, Settings2 } from "lucide-react";
import { DelayBottomSheet, Sheet } from "../components/Sheets";
import { DelayControl, Header, NextUpCard, NowPlayingCard, TimetableList } from "../components/Cards";
import { RuntimeImageContext } from "../components/GroupImage";
import type { ActivityRecord } from "../types/activity";
import { useCurrentTime } from "../hooks/useCurrentTime";
import { getActivity } from "../utils/activitiesApi";
import { cropGroupImages, readPoster, revokeRuntimeImages, type RuntimeGroupImages } from "../utils/poster";
import { getCurrentPerformance, getNextPerformance } from "../utils/time";

function localDelay(id: string, initial: number): number {
  try {
    const value = localStorage.getItem(`live-idol-delay:${id}`);
    if (value === null) return initial;
    const number = Number(value);
    return Number.isInteger(number) && number >= -1440 && number <= 1440 ? number : initial;
  } catch { return initial; }
}

export function EventDetailPage({ id }: { id: string }) {
  const [record, setRecord] = useState<ActivityRecord | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [delay, setDelay] = useState(0);
  const [images, setImages] = useState<RuntimeGroupImages>({});
  const [sheet, setSheet] = useState<"delay" | "settings" | null>(null);
  const now = useCurrentTime();
  const topRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    getActivity(id).then((activity) => {
      if (!active) return;
      setRecord(activity);
      setDelay(localDelay(id, activity.data.delay_minutes));
      setError("");
      setLoading(false);
      document.title = `${activity.data.event.title} | Live Timetable`;
    }).catch((cause) => {
      if (!active) return;
      setError(cause instanceof Error && "status" in cause && cause.status === 404
        ? "活动不存在或已被删除" : "活动加载失败，请稍后重试。");
      setLoading(false);
    });
    return () => { active = false; document.title = "Live Idol Timetable"; };
  }, [id, retry]);

  useEffect(() => {
    if (!record) return;
    let active = true;
    let sourceUrl = "";
    let generated: RuntimeGroupImages = {};
    setImages(record.images ?? {});
    if (record.posterUrl) {
      (async () => {
        try {
          const response = await fetch(record.posterUrl!, { cache: "no-store" });
          if (!response.ok) throw new Error("海报读取失败");
          const blob = await response.blob();
          const file = new File([blob], "activity-poster", { type: blob.type });
          const source = await readPoster(file);
          sourceUrl = source.url;
          if (!active) { URL.revokeObjectURL(sourceUrl); sourceUrl = ""; return; }
          const cropped = await cropGroupImages(record.data, source);
          generated = cropped.images;
          if (active) setImages({ ...(record.images ?? {}), ...generated });
          else revokeRuntimeImages(generated);
        } catch { if (active) setImages(record.images ?? {}); }
      })();
    }
    return () => {
      active = false;
      revokeRuntimeImages(generated);
      if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    };
  }, [record]);

  const data = useMemo(() => record ? { ...record.data, delay_minutes: delay } : null, [record, delay]);
  const current = data ? getCurrentPerformance(data, now) : undefined;
  const next = data ? getNextPerformance(data, now) : undefined;
  const changeDelay = (value: number) => {
    const bounded = Math.max(-1440, Math.min(1440, value));
    setDelay(bounded);
    try { localStorage.setItem(`live-idol-delay:${id}`, String(bounded)); } catch { /* Private browsing may deny storage. */ }
  };
  if (loading) return <div className="sync-screen" role="status"><h1>Live Idol Timetable</h1><p>正在读取活动…</p></div>;
  if (!record || !data) return <div className="sync-screen"><h1>{error}</h1><a className="primary-button" href="/">返回活动列表</a><button className="text-button" onClick={() => setRetry((value) => value + 1)}>重试</button></div>;
  const scrollToTimetable = () => document.getElementById("timetable")?.scrollIntoView({ behavior: "smooth", block: "start" });
  return (
    <RuntimeImageContext.Provider value={images}>
      <div className="page-shell" ref={topRef}>
        <a className="detail-back" href="/"><ArrowLeft size={18} /> 返回活动列表</a>
        <Header data={data} onSettings={() => setSheet("settings")} />
        <main className="page-content">
          <div className="sync-indicator">{record.city} · 现场延迟仅在当前浏览器生效</div>
          <NowPlayingCard data={data} now={now} current={current} next={next} />
          <NextUpCard data={data} now={now} current={current} next={next} onClick={scrollToTimetable} />
          <DelayControl delay={delay} onChange={(delta) => changeDelay(delay + delta)} onReset={() => changeDelay(0)} onOpen={() => setSheet("delay")} />
          <TimetableList data={data} now={now} nextId={next?.id} />
        </main>
        <nav className="bottom-nav" aria-label="主导航">
          <a href="/"><Home size={22} /><span>活动</span></a>
          <button className="active" onClick={scrollToTimetable}><CalendarDays size={22} /><span>TIMETABLE</span></button>
          <button onClick={() => setSheet("settings")}><Settings2 size={22} /><span>SETTINGS</span></button>
        </nav>
        {sheet === "delay" && <DelayBottomSheet delay={delay} onApply={changeDelay} onClose={() => setSheet(null)} />}
        {sheet === "settings" && <Sheet title="设置" onClose={() => setSheet(null)}>
          <div className="settings-detail"><span>当前活动</span><strong>{data.event.title}</strong><small>{data.event.date} · {record.city}</small></div>
          <p className="sheet-description">现场延迟只保存在当前浏览器的这场活动中，不会修改服务器上的原始演出时间。</p>
          <a className="text-button" href="/admin">管理入口</a>
        </Sheet>}
      </div>
    </RuntimeImageContext.Provider>
  );
}
