import { useEffect, useState } from "react";
import { ArrowRight, Cloud, Sparkles, Star } from "lucide-react";
import type { ActivityRecord } from "../types/activity";
import { EventCard } from "../components/EventCard";
import { useCurrentTime } from "../hooks/useCurrentTime";
import { classifyActivities, displayDate, localDateKey } from "../utils/activityList";
import { listActivities } from "../utils/activitiesApi";

type Tab = "recent" | "upcoming" | "ended";

export function ActivityListPage() {
  const [activities, setActivities] = useState<ActivityRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("recent");
  const [city, setCity] = useState("");
  const [retry, setRetry] = useState(0);
  const now = useCurrentTime();
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const records = await listActivities();
        if (active) { setActivities(records); setError(""); setLoading(false); }
      } catch {
        if (active) { setError("活动列表暂时加载失败"); setLoading(false); }
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 15_000);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener("focus", onFocus); };
  }, [retry]);
  const cities = [...new Set(activities.map((item) => item.city))].sort((a, b) => a.localeCompare(b, "zh-CN"));
  const grouped = classifyActivities(activities, now, city);
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const visibleCount = tab === "recent" ? grouped.today.length + grouped.tomorrow.length : grouped[tab].length;
  const section = (title: string, subtitle: string, records: ActivityRecord[], empty: string) => (
    <section className="activity-section">
      <div className="activity-section-heading"><span>{title}</span><h2>{subtitle}</h2></div>
      {records.length ? <div className="event-grid">{records.map((item) => <EventCard key={item.id} activity={item} now={now} />)}</div>
        : <div className="activity-empty"><Star size={22} /><p>{empty}</p></div>}
    </section>
  );
  const dateSections = (records: ActivityRecord[]) => {
    const dates = [...new Set(records.map((item) => item.data.event.date))];
    return dates.map((date) => section(date, displayDate(date), records.filter((item) => item.data.event.date === date), "暂无活动"));
  };
  return (
    <div className="activity-home">
      <header className="activity-home-header">
        <Cloud className="home-cloud" size={66} />
        <Sparkles className="home-sparkle" size={27} />
        <p>LIVE IDOL · EVENT GUIDE</p>
        <h1>Live Schedule <span>✦</span></h1>
        <strong>找到下一场心动现场</strong>
      </header>
      <main className="activity-home-main">
        <div className="activity-toolbar">
          <div className="activity-tabs" role="tablist" aria-label="活动分类">
            <button role="tab" aria-selected={tab === "recent"} className={tab === "recent" ? "selected" : ""} onClick={() => setTab("recent")}>今日 / 明日</button>
            <button role="tab" aria-selected={tab === "upcoming"} className={tab === "upcoming" ? "selected" : ""} onClick={() => setTab("upcoming")}>即将到来</button>
            <button role="tab" aria-selected={tab === "ended"} className={tab === "ended" ? "selected" : ""} onClick={() => setTab("ended")}>已结束</button>
          </div>
          <label className="city-filter">城市
            <select value={city} onChange={(event) => setCity(event.target.value)}>
              <option value="">全部城市</option>
              {cities.map((name) => <option value={name} key={name}>{name}</option>)}
            </select>
          </label>
        </div>
        {loading ? <div className="activity-skeleton" aria-label="正在加载活动"><div /><div /><div /></div>
          : error ? <div className="activity-empty"><p>{error}</p><button onClick={() => { setLoading(true); setRetry((value) => value + 1); }}>重试</button></div>
            : city && visibleCount === 0 ? <div className="activity-empty"><p>当前城市暂无活动</p><button onClick={() => setCity("")}>查看全部城市</button></div>
              : tab === "recent" ? <>
                {section("TODAY", `今日 · ${displayDate(localDateKey(now))}`, grouped.today, "今天暂时没有活动")}
                {section("TOMORROW", `明日 · ${displayDate(localDateKey(tomorrow))}`, grouped.tomorrow, "明天暂时没有活动")}
                <button className="activity-more" onClick={() => setTab("upcoming")}>查看即将到来的活动 <ArrowRight size={18} /></button>
              </> : grouped[tab].length ? dateSections(grouped[tab])
                : section(tab === "upcoming" ? "UPCOMING" : "ENDED", tab === "upcoming" ? "即将到来" : "已结束", [], tab === "upcoming" ? "还没有更多活动" : "暂无历史活动")}
      </main>
      <footer className="activity-home-footer"><a href="/admin">管理入口</a></footer>
    </div>
  );
}
