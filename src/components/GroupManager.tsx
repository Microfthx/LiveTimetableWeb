import { useEffect, useState } from "react";
import { ImageUp, Plus, RefreshCw, Trash2 } from "lucide-react";
import type { GroupLibraryRecord } from "../types/groupLibrary";
import { createGroup, deleteGroup, importWeiboGroupProfile, listGroups, updateGroup, type GroupDraft } from "../utils/activitiesApi";
import { groupMatchKey, groupNameFromWeiboHandle } from "../utils/groupMatching";

const emptyDraft = (): GroupDraft => ({ name: "", weiboUid: "", weiboUrl: "" });
const weiboCookie = () => { try { return localStorage.getItem("live-idol-weibo-cookie") ?? ""; } catch { return ""; } };

function fileDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("头像读取失败，请重新选择。"));
    reader.readAsDataURL(file);
  });
}

export function GroupManager() {
  const [groups, setGroups] = useState<GroupLibraryRecord[]>([]);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<GroupLibraryRecord | null>(null);
  const [draft, setDraft] = useState<GroupDraft | null>(null);
  const [aliasText, setAliasText] = useState("");
  const [cookie, setCookie] = useState(weiboCookie);
  const [rememberCookie, setRememberCookie] = useState(() => Boolean(weiboCookie()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [imagePreview, setImagePreview] = useState("");

  const refresh = async () => setGroups(await listGroups());
  useEffect(() => { void refresh().catch(() => setError("团体库加载失败，请刷新重试。")); }, []);
  useEffect(() => {
    try {
      if (rememberCookie && cookie.trim()) localStorage.setItem("live-idol-weibo-cookie", cookie);
      else localStorage.removeItem("live-idol-weibo-cookie");
    } catch { /* Browsers may deny storage; the current input still works. */ }
  }, [cookie, rememberCookie]);
  const open = (group?: GroupLibraryRecord) => {
    setEditing(group ?? null);
    setDraft(group ? { name: group.name, weiboUid: group.weiboUid ?? "", weiboUrl: group.weiboUrl ?? "", avatarSourceUrl: group.avatarSourceUrl ?? "" } : emptyDraft());
    setAliasText(group?.aliases?.join("\n") ?? "");
    setImagePreview(group?.avatarUrl ?? "");
    setError("");
  };
  const save = async () => {
    if (!draft || busy) return;
    setBusy(true); setError("");
    try {
      const savedDraft = { ...draft, aliases: aliasText.split(/\r?\n/).map((alias) => alias.trim()).filter(Boolean) };
      if (editing) await updateGroup(editing.id, savedDraft);
      else await createGroup(savedDraft);
      await refresh();
      setDraft(null); setEditing(null); setImagePreview("");
      setNotice(editing ? "团体资料已更新。" : "团体已加入团体库。");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "保存失败，请重试。"); }
    finally { setBusy(false); }
  };
  const remove = async (group: GroupLibraryRecord) => {
    if (group.boundActivityCount) { setError(`该团体已被 ${group.boundActivityCount} 场活动引用，请先在活动编辑中解除绑定。`); return; }
    if (!window.confirm(`确认删除团体「${group.name}」？删除后无法恢复。`)) return;
    setBusy(true); setError("");
    try { await deleteGroup(group.id); await refresh(); setNotice("团体已删除。"); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "删除失败，请重试。"); }
    finally { setBusy(false); }
  };
  const importProfile = async () => {
    if (!draft?.weiboUrl || busy) return;
    setBusy(true); setError("");
    try {
      const profile = await importWeiboGroupProfile(draft.weiboUrl, cookie);
      setDraft((previous) => previous && ({ ...previous, name: previous.name.trim() || groupNameFromWeiboHandle(profile.name), weiboUid: profile.weiboUid, weiboUrl: profile.weiboUrl,
        ...(profile.avatarSourceUrl ? { avatarSourceUrl: profile.avatarSourceUrl } : {}),
        ...(profile.avatarDataUrl ? { avatarDataUrl: profile.avatarDataUrl } : {}) }));
      if (profile.avatarDataUrl) setImagePreview(profile.avatarDataUrl);
      setNotice("微博资料已填入草稿。请核对标准团体名后保存。");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "微博资料读取失败。"); }
    finally { setBusy(false); }
  };
  const searchKey = groupMatchKey(search);
  const visible = groups.filter((group) => [group.name, ...(group.aliases ?? [])].some((name) => groupMatchKey(name).includes(searchKey))
    || !!group.weiboUid?.includes(search.trim()));
  return <section className="group-manager">
    <div className="group-manager-toolbar"><h2>团体管理 <small>{groups.length}</small></h2><button className="primary-button" onClick={() => open()} disabled={busy}><Plus size={18} /> 新增团体</button></div>
    <input aria-label="搜索团体" placeholder="搜索团体名称、别名或微博 UID" value={search} onChange={(event) => setSearch(event.target.value)} />
    {notice && <p className="form-success" role="status">{notice}</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="group-manager-list">{visible.map((group) => <article key={group.id} className="group-manager-row">
      {group.avatarUrl ? <img src={group.avatarUrl} alt="" loading="lazy" /> : <span className="group-manager-placeholder">✦</span>}
      <div><strong>{group.name}</strong>{!!group.aliases?.length && <small>别名：{group.aliases.join("、")}</small>}<small>{group.weiboUid ? `微博 UID ${group.weiboUid}` : "未关联微博"} · {group.boundActivityCount ?? 0} 场活动</small></div>
      <div className="admin-row-actions"><button onClick={() => open(group)} disabled={busy}>编辑</button><button onClick={() => void remove(group)} disabled={busy}><Trash2 size={15} /> 删除</button></div>
    </article>)}{!visible.length && <p className="activity-empty">暂无匹配团体</p>}</div>
    {draft && <div className="group-manager-editor" role="dialog" aria-modal="true" aria-label={editing ? "编辑团体" : "新增团体"}>
      <div className="group-manager-editor-card"><h3>{editing ? "编辑团体" : "新增团体"}</h3>
        <label>标准团体名 *<input value={draft.name} maxLength={120} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
        <label>匹配别名（每行一个）<textarea value={aliasText} rows={3} onChange={(event) => setAliasText(event.target.value)} placeholder="例如：Toxic" /></label>
        <p className="sheet-description">活动团名与标准名或任一别名一致时自动匹配；括号内的地区标注会忽略。</p>
        <label>微博主页链接<input type="url" value={draft.weiboUrl ?? ""} placeholder="https://weibo.com/u/123456789" onChange={(event) => setDraft({ ...draft, weiboUrl: event.target.value })} /></label>
        <label>微博 Cookie（用于读取资料）<input type="password" value={cookie} onChange={(event) => setCookie(event.target.value)} placeholder="可使用当前浏览器已保存的 Cookie" /></label>
        <label className="group-manager-remember"><input type="checkbox" checked={rememberCookie} onChange={(event) => setRememberCookie(event.target.checked)} /> 在此浏览器记住微博 Cookie</label>
        <button className="secondary-button" onClick={() => void importProfile()} disabled={!draft.weiboUrl?.trim() || busy}><RefreshCw size={16} /> 从微博导入 / 更新资料</button>
        <label>微博 UID<input inputMode="numeric" value={draft.weiboUid ?? ""} onChange={(event) => setDraft({ ...draft, weiboUid: event.target.value })} /></label>
        <div className="group-manager-avatar">{imagePreview ? <img src={imagePreview} alt="团体头像预览" /> : <span className="group-manager-placeholder">✦</span>}
          <label className="secondary-button"><ImageUp size={16} /> 更换头像<input type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void fileDataUrl(file).then((value) => { setDraft((previous) => previous && ({ ...previous, avatarDataUrl: value })); setImagePreview(value); }).catch((cause) => setError(String(cause))); }} /></label>
          {imagePreview && <button className="text-button" onClick={() => { setDraft({ ...draft, avatarDataUrl: null }); setImagePreview(""); }}>移除头像</button>}</div>
        <p className="sheet-description">微博昵称和头像仅填入草稿；保存前请核对标准团体名，以便活动精确匹配。</p>
        <div className="group-manager-actions"><button className="text-button" onClick={() => { setDraft(null); setError(""); }} disabled={busy}>取消</button><button className="primary-button" onClick={() => void save()} disabled={!draft.name.trim() || busy}>{busy ? "保存中…" : "保存团体"}</button></div>
      </div>
    </div>}
  </section>;
}
