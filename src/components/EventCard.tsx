import { useEffect, useState } from "react";
import { CalendarDays, MapPin, Music2, Sparkles } from "lucide-react";
import type { ActivityRecord } from "../types/activity";
import { bucketFor, displayDate, todayStatus } from "../utils/activityList";

export function EventCard({ activity, now }: { activity: ActivityRecord; now: Date }) {
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => setImageFailed(false), [activity.posterUrl]);
  const bucket = bucketFor(activity, now);
  const status = bucket === "today" ? todayStatus(activity, now) : undefined;
  const label = bucket === "today"
    ? status === "live" ? "● LIVE NOW" : status === "ended" ? "已结束" : status === "not-started" ? "今日 · 即将开始" : "今日活动"
    : bucket === "tomorrow" ? "明日" : bucket === "upcoming" ? "即将到来" : "已结束";
  const badgeClass = status === "live" ? "event-badge-live" : bucket === "ended" || status === "ended" ? "event-badge-ended" : "";
  return (
    <a href={`/events/${activity.id}`} className={`event-card ${bucket === "ended" ? "event-card-ended" : ""}`}>
      <div className="event-poster">
        {activity.posterUrl && !imageFailed ? (
          <img src={activity.posterUrl} alt={`${activity.data.event.title} 海报`} loading="lazy" onError={() => setImageFailed(true)} />
        ) : (
          <div className="event-poster-placeholder" aria-hidden="true">
            <Sparkles size={21} />
            <Music2 size={38} />
            <strong>{activity.data.event.title.slice(0, 2)}</strong>
          </div>
        )}
      </div>
      <div className="event-card-copy">
        <span className={`event-badge ${badgeClass}`}>{label}</span>
        <h3>{activity.data.event.title}</h3>
        <p className="event-place"><MapPin size={15} /> {activity.city} · {activity.data.event.venue || "场地待公布"}</p>
        <p className="event-date"><CalendarDays size={15} /> {displayDate(activity.data.event.date)}</p>
        <div className="event-times">
          {activity.data.event.doors_time && <span>OPEN <strong>{activity.data.event.doors_time}</strong></span>}
          {activity.data.event.start_time && <span>START <strong>{activity.data.event.start_time}</strong></span>}
        </div>
      </div>
    </a>
  );
}
