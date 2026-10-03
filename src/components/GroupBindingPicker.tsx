import { useEffect, useRef, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import type { GroupLibraryRecord } from "../types/groupLibrary";
import { groupMatchKey } from "../utils/groupMatching";

export function GroupBindingPicker({ groupName, value, library, disabled, onChange }: {
  groupName: string;
  value: string;
  library: GroupLibraryRecord[];
  disabled: boolean;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const selected = library.find((entry) => entry.id === value);
  const searchKey = groupMatchKey(query);
  const matches = open ? library.filter((entry) => groupMatchKey(entry.name).includes(searchKey)) : [];

  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const choose = (id: string) => {
    onChange(id);
    setOpen(false);
    setQuery("");
  };

  return <div className="group-binding-picker" onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) { setOpen(false); setQuery(""); }
  }} onKeyDown={(event) => {
    if (event.key === "Escape" && open) { event.stopPropagation(); setOpen(false); setQuery(""); }
  }}>
    <button type="button" className="group-binding-trigger" aria-label={`${groupName} 的团体库绑定`}
      aria-expanded={open} disabled={disabled} onClick={() => setOpen((current) => !current)}>
      <span>{selected ? `${selected.name}${selected.avatarUrl ? " · 有头像" : " · 无头像"}` : "未绑定 · 使用本场 crop"}</span>
      <ChevronDown size={14} aria-hidden="true" />
    </button>
    {open && <div className="group-binding-menu">
      <label className="group-binding-search"><Search size={15} aria-hidden="true" />
        <input ref={searchRef} type="search" aria-label={`搜索${groupName}的团体库头像`}
          placeholder="搜索团体名称" value={query} onChange={(event) => setQuery(event.target.value)} />
      </label>
      <div className="group-binding-options">
        <button type="button" className={!value ? "selected" : ""} onClick={() => choose("")}>未绑定 · 使用本场 crop</button>
        {matches.map((entry) => <button type="button" key={entry.id} className={value === entry.id ? "selected" : ""}
          onClick={() => choose(entry.id)}>
          {entry.avatarUrl ? <img src={entry.avatarUrl} alt="" loading="lazy" /> : <span className="group-binding-avatar-placeholder">✦</span>}
          <span>{entry.name}</span>
          <small>{entry.avatarUrl ? "有头像" : "无头像"}</small>
        </button>)}
        {!matches.length && <p>没有找到匹配的团体</p>}
      </div>
    </div>}
  </div>;
}
