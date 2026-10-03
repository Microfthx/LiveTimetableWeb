import { useEffect, useRef, useState } from "react";
import { ArrowLeft, LogOut, Plus, Trash2, Pencil, ShieldCheck } from "lucide-react";
import { ImportBottomSheet } from "../components/Sheets";
import { GroupManager } from "../components/GroupManager";
import type { ActivityRecord } from "../types/activity";
import type { GroupBindings } from "../types/groupLibrary";
import type { PosterSource } from "../types/timetable";
import { adminLogin, adminLogout, adminSession, createActivity, deleteActivity, listActivities, updateActivity } from "../utils/activitiesApi";
import { readPoster } from "../utils/poster";
import { displayDate, localDateKey } from "../utils/activityList";

export function AdminPage() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [activities, setActivities] = useState<ActivityRecord[]>([]);
  const [view, setView] = useState<"list" | "create" | "edit">("list");
  const [editing, setEditing] = useState<ActivityRecord | null>(null);
  const [poster, setPoster] = useState<PosterSource | null>(null);
  const [displayPoster, setDisplayPoster] = useState<PosterSource | null>(null);
  const posterRef = useRef<PosterSource | null>(null);
  const displayPosterRef = useRef<PosterSource | null>(null);
  const originalDisplayPosterRef = useRef<PosterSource | null>(null);
  const originalPosterRef = useRef<PosterSource | null>(null);
  const savedRef = useRef(false);
  const dirtyRef = useRef(false);
  const [search, setSearch] = useState("");
  const [cityFilter, setCityFilter] = useState("");
  const [section, setSection] = useState<"activities" | "groups">("activities");

  const refresh = async () => setActivities(await listActivities());
  useEffect(() => {
    let active = true;
    adminSession().then(async (session) => {
      if (!active) return;
      setAuthenticated(session.authenticated);
      if (session.authenticated) {
        try { const result = await listActivities(); if (active) setActivities(result); }
        catch { if (active) setError("活动列表加载失败，请刷新重试。"); }
      }
    }).catch(() => { if (active) { setAuthenticated(false); setError("无法连接服务器。"); } });
    return () => { active = false; };
  }, []);
  useEffect(() => () => { if (posterRef.current) URL.revokeObjectURL(posterRef.current.url); if (displayPosterRef.current && displayPosterRef.current !== posterRef.current) URL.revokeObjectURL(displayPosterRef.current.url); }, []);
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
  const selectDisplayPoster = (selected: PosterSource | null) => {
    if (displayPosterRef.current && displayPosterRef.current !== posterRef.current && displayPosterRef.current !== selected)
      URL.revokeObjectURL(displayPosterRef.current.url);
    displayPosterRef.current = selected;
    setDisplayPoster(selected);
  };
  const signIn = async () => {
    if (busy) return;
    setBusy(true); setError("");
    try { await adminLogin(key); setKey(""); setAuthenticated(true); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "管理密钥错误"); }
    finally { setBusy(false); }
  };
  const signOut = async () => {
    setBusy(true);
    try { await adminLogout(); setAuthenticated(false); setActivities([]); setView("list"); }
    catch { setError("退出失败，请重试。"); }
    finally { setBusy(false); }
  };
  const beginEdit = async (activity: ActivityRecord) => {
    clearPoster(); selectDisplayPoster(null); originalPosterRef.current = null; originalDisplayPosterRef.current = null; dirtyRef.current = false;
    setEditing(activity); setError(""); setBusy(true);
    try {
      if (activity.cropSourceUrl || activity.posterUrl) {
        const response = await fetch(activity.cropSourceUrl ?? activity.posterUrl!, { cache: "no-store" });
        if (!response.ok) throw new Error("海报读取失败，请重试。");
        const blob = await response.blob();
        const source = await readPoster(new File([blob], "当前海报", { type: blob.type }));
        posterRef.current = source;
        originalPosterRef.current = source;
        setPoster(source);
      }
      if (activity.cropSourceSeparate && activity.posterUrl) {
        const response = await fetch(activity.posterUrl, { cache: "no-store" });
        if (!response.ok) throw new Error("活动封面读取失败，请重试。");
        const blob = await response.blob();
        const cover = await readPoster(new File([blob], "当前活动封面", { type: blob.type }));
        displayPosterRef.current = cover;
        originalDisplayPosterRef.current = cover;
        setDisplayPoster(cover);
      }
      setView("edit");
    } catch (cause) {
      setError(cause instanceof Error ? `${cause.message}；仍可编辑活动信息。` : "海报读取失败；仍可编辑活动信息。");
      setView("edit");
    }
    finally { setBusy(false); }
  };
  const closeEditor = () => {
    if (view === "edit" && dirtyRef.current && !savedRef.current && !window.confirm("修改尚未保存。确定离开编辑页面吗？")) return;
    savedRef.current = false;
    dirtyRef.current = false;
    clearPoster(); selectDisplayPoster(null); originalPosterRef.current = null; originalDisplayPosterRef.current = null; setEditing(null); setView("list");
  };
  const saveImport = async (data: ActivityRecord["data"], _images: Record<string, string>, selected: PosterSource | null, city: string, groupBindings: GroupBindings) => {
    if (busy) throw new Error("正在保存，请稍后重试。");
    setBusy(true); setError("");
    try {
      if (view === "edit" && editing) {
        const replacement = selected && selected !== originalPosterRef.current ? selected : undefined;
        const coverReplacement = displayPosterRef.current && displayPosterRef.current !== originalDisplayPosterRef.current ? displayPosterRef.current : undefined;
        await updateActivity(editing.id, city, data, editing.cropSourceSeparate ? coverReplacement : replacement, editing.cropSourceSeparate ? replacement : undefined, groupBindings);
        setNotice("活动修改已保存。");
      } else {
        await createActivity(city, data, displayPosterRef.current ?? selected, selected, groupBindings);
        setNotice("新活动已发布，所有访客现在都可以查看。");
      }
      await refresh();
      savedRef.current = true;
      dirtyRef.current = false;
      clearPoster(); selectDisplayPoster(null); originalPosterRef.current = null; originalDisplayPosterRef.current = null; setEditing(null); setView("list");
    } catch (cause) {
      if (cause instanceof Error && "status" in cause && cause.status === 401) setAuthenticated(false);
      throw cause;
    } finally { setBusy(false); }
  };
  const remove = async (activity: ActivityRecord) => {
    if (!window.confirm(`确认删除活动？\n\n${activity.data.event.title}\n${activity.data.event.date} · ${activity.city}\n\n删除后无法从网站活动列表恢复。`)) return;
    if (busy) return;
    setBusy(true); setError("");
    try { await deleteActivity(activity.id); await refresh(); setNotice("活动已删除。"); }
    catch { setError("活动删除失败，请重试。"); }
    finally { setBusy(false); }
  };
  if (authenticated === null) return <div className="sync-screen" role="status"><h1>管理员验证</h1><p>正在检查登录状态…</p></div>;
  if (!authenticated) return (
    <div className="admin-shell admin-login">
      <a className="detail-back" href="/"><ArrowLeft size={18} /> 返回活动列表</a>
      <div className="admin-login-card"><ShieldCheck size={34} /><h1>管理员验证</h1><p>输入管理密钥，进入活动管理。</p>
        <label htmlFor="admin-access-key">管理密钥</label>
        <input id="admin-access-key" type="password" autoComplete="current-password" value={key} onChange={(event) => setKey(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void signIn(); }} />
        <button className="primary-button" onClick={() => void signIn()} disabled={!key.trim() || busy}>{busy ? "验证中…" : "进入管理"}</button>
        {error && <p className="form-error" role="alert">{error}</p>}
      </div>
    </div>
  );
  const cities = [...new Set(activities.map((item) => item.city))].sort((a, b) => a.localeCompare(b, "zh-CN"));
  const shown = activities.filter((item) => (!cityFilter || item.city === cityFilter) && (!search.trim() || `${item.data.event.title} ${item.data.event.venue ?? ""}`.toLowerCase().includes(search.trim().toLowerCase())))
    .sort((a, b) => {
      const today = localDateKey(new Date());
      const aFuture = a.data.event.date >= today ? 0 : 1;
      const bFuture = b.data.event.date >= today ? 0 : 1;
      return aFuture - bFuture || (aFuture === 0 ? a.data.event.date.localeCompare(b.data.event.date) : b.data.event.date.localeCompare(a.data.event.date));
    });
  return (
    <div className="admin-shell">
      <a className="detail-back" href="/"><ArrowLeft size={18} /> 返回活动列表</a>
      <header className="admin-header"><div><p>LIVE IDOL TIMETABLE</p><h1>活动管理</h1></div><button className="text-button" onClick={() => void signOut()} disabled={busy}><LogOut size={17} /> 退出管理</button></header>
      <div className="smart-mode-tabs admin-section-tabs"><button className={section === "activities" ? "selected" : ""} onClick={() => setSection("activities")}>活动管理</button><button className={section === "groups" ? "selected" : ""} onClick={() => setSection("groups")}>团体管理</button></div>
      {notice && <p className="form-success" role="status">{notice}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {section === "activities" ? <>
      <button className="primary-button admin-add" disabled={busy} onClick={() => { clearPoster(); selectDisplayPoster(null); dirtyRef.current = false; setEditing(null); setView("create"); }}><Plus size={19} /> 导入新活动</button>
      <div className="admin-filters"><input aria-label="搜索活动" placeholder="搜索活动或场地" value={search} onChange={(event) => setSearch(event.target.value)} />
        <select aria-label="筛选城市" value={cityFilter} onChange={(event) => setCityFilter(event.target.value)}><option value="">全部城市</option>{cities.map((city) => <option key={city}>{city}</option>)}</select></div>
      <div className="admin-activities">{shown.length ? shown.map((activity) => <article className="admin-activity" key={activity.id}>
        {activity.thumbnailUrl ? <img src={activity.thumbnailUrl} alt="" loading="lazy" /> : <span className="admin-poster-placeholder">✦</span>}
        <div><strong>{activity.data.event.title}</strong><small>{displayDate(activity.data.event.date)} · {activity.city} · {activity.data.event.venue || "场地待公布"}</small><a href={`/events/${activity.id}`}>查看详情</a></div>
        <div className="admin-row-actions"><button disabled={busy} onClick={() => void beginEdit(activity)}><Pencil size={16} /> 编辑</button><button disabled={busy} onClick={() => void remove(activity)}><Trash2 size={16} /> 删除</button></div>
      </article>) : <p className="activity-empty">暂无活动</p>}</div>
      {(view === "create" || (view === "edit" && editing)) && <ImportBottomSheet
        key={view === "edit" ? editing!.id : "new"}
        mode="paste" poster={poster} initialData={editing?.data} initialCity={editing?.city ?? ""} initialBindings={editing?.groupBindings}
        sheetTitle={view === "edit" ? "编辑活动" : "导入新活动"}
        submitLabel={view === "edit" ? "保存修改" : "确认导入"}
        duplicateTitles={activities.map((item) => `${item.data.event.date}:${item.data.event.title}`)}
        originalPosterRatio={originalPosterRef.current ? originalPosterRef.current.width / originalPosterRef.current.height : undefined}
        replacementPending={view === "edit" && !!poster && poster !== originalPosterRef.current}
        smartEnabled={view === "create"} onDisplayPosterSelect={selectDisplayPoster}
        displayPoster={displayPoster} showDisplayPosterEditor={view === "edit" && !!editing?.cropSourceSeparate}
        coverReplacementPending={view === "edit" && !!displayPoster && displayPoster !== originalDisplayPosterRef.current}
        onPosterSelect={selectPoster} onPosterClear={clearPoster} onDirtyChange={(dirty) => { dirtyRef.current = dirty; }} onImport={saveImport} onClose={closeEditor} />}
      </> : <GroupManager />}
    </div>
  );
}
