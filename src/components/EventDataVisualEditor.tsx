import type { EventData, IdolGroup } from "../types/timetable";

const EMPTY_CROP = { x: 0, y: 0, width: 0, height: 0 };

export function EventDataVisualEditor({
  data,
  onChange,
}: {
  data: EventData;
  onChange: (next: EventData) => void;
}) {
  const updateEvent = (field: keyof EventData["event"], value: string) =>
    onChange({ ...data, event: { ...data.event, [field]: value } });
  const updateGroup = (index: number, field: string, value: string) => {
    const groups = data.groups.map((group, at) => {
      if (at !== index) return group;
      if (field.startsWith("crop.")) {
        const key = field.slice(5) as keyof typeof EMPTY_CROP;
        return {
          ...group,
          crop: { ...EMPTY_CROP, ...group.crop, [key]: Number(value) },
        };
      }
      if (field === "benefit_type" && value !== "normal")
        return {
          ...group,
          benefit_type: value as "final" | "none",
          benefit_time_start: "",
          benefit_time_end: "",
        };
      return { ...group, [field]: value };
    });
    onChange({ ...data, groups });
  };
  const addGroup = () => {
    const group: IdolGroup = {
      id: `draft_${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`}`,
      name: "",
      start_time: "",
      end_time: "",
      benefit_type: "none",
      benefit_time_start: "",
      benefit_time_end: "",
      image_base64: "",
      image_mime: "image/jpeg",
      crop: { ...EMPTY_CROP },
    };
    onChange({ ...data, groups: [...data.groups, group] });
  };

  return (
    <>
      <div className="smart-editor-grid">
        {(["title", "date", "venue", "doors_time", "start_time"] as const).map((field) => (
          <label key={field}>
            {{ title: "活动名称", date: "日期 YYYY-MM-DD", venue: "场地", doors_time: "OPEN", start_time: "START" }[field]}
            <input value={data.event[field] ?? ""} onChange={(event) => updateEvent(field, event.target.value)} />
          </label>
        ))}
      </div>
      <div className="smart-group-list">
        {data.groups.map((group, index) => (
          <div className="smart-group-editor" key={`${index}-${group.id}`}>
            <strong>团体 {index + 1}</strong>
            <button className="text-button" onClick={() => onChange({
              ...data, groups: data.groups.filter((_, at) => at !== index),
            })}>删除</button>
            <div className="smart-editor-grid">
              <label>团名
                <input value={group.name} onChange={(event) => updateGroup(index, "name", event.target.value)} />
              </label>
              <label>开始
                <input value={group.start_time} onChange={(event) => updateGroup(index, "start_time", event.target.value)} />
              </label>
              <label>结束
                <input value={group.end_time} onChange={(event) => updateGroup(index, "end_time", event.target.value)} />
              </label>
              <label>特典类型
                <select value={group.benefit_type ?? "none"} onChange={(event) => updateGroup(index, "benefit_type", event.target.value)}>
                  <option value="none">无特典信息</option>
                  <option value="normal">普通特典</option>
                  <option value="final">终特</option>
                </select>
              </label>
              {group.benefit_type === "normal" && (
                <>
                  <label>特典开始
                    <input placeholder="HH:mm" value={group.benefit_time_start ?? ""} onChange={(event) => updateGroup(index, "benefit_time_start", event.target.value)} />
                  </label>
                  <label>特典结束
                    <input placeholder="HH:mm" value={group.benefit_time_end ?? ""} onChange={(event) => updateGroup(index, "benefit_time_end", event.target.value)} />
                  </label>
                </>
              )}
              {(["x", "y", "width", "height"] as const).map((field) => (
                <label key={field}>crop.{field}
                  <input type="number" min="0" max="1" step="0.001" value={group.crop?.[field] ?? 0}
                    onChange={(event) => updateGroup(index, `crop.${field}`, event.target.value)} />
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
      <button className="secondary-button" onClick={addGroup}>+ 添加团体</button>
    </>
  );
}
