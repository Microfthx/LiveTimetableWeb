import {
  ArrowRight,
  CalendarDays,
  ChevronRight,
  Clock3,
  Cloud,
  Info,
  RotateCcw,
  Settings2,
  Sparkles,
  Star,
} from "lucide-react";
import type { EventData, IdolGroup } from "../types/timetable";
import {
  formatTime,
  getEffectiveTime,
  getGroupWindow,
  getPerformanceProgress,
  getPerformanceStatus,
  minutesUntil,
} from "../utils/time";
import { GroupImage } from "./GroupImage";

export function Header({
  data,
  onSettings,
}: {
  data: EventData;
  onSettings: () => void;
}) {
  const date = data.event.date.replaceAll("-", ".");
  return (
    <header className="app-header">
      <div className="header-decor decor-cloud">
        <Cloud size={62} strokeWidth={2.3} />
      </div>
      <Star className="header-decor decor-star-one" size={25} />
      <Sparkles className="header-decor decor-star-two" size={24} />
      <div className="header-copy">
        <h1>{data.event.title}</h1>
        <p>
          {date}
          <span aria-hidden="true"> · </span>
          {data.event.venue || "演出现场"}
        </p>
      </div>
      <button
        className="icon-circle settings-trigger"
        onClick={onSettings}
        aria-label="打开设置"
      >
        <Settings2 size={23} />
      </button>
    </header>
  );
}

export function NowPlayingCard({
  data,
  now,
  current,
  next,
}: {
  data: EventData;
  now: Date;
  current?: IdolGroup;
  next?: IdolGroup;
}) {
  const scheduled = data.groups.filter((group) =>
    getEffectiveTime(data, group),
  );
  if (!scheduled.length)
    return (
      <section className="now-card" aria-label="当前演出">
        <div className="now-eyebrow">
          <span>TIME TO CHECK</span>
          <span>时间待核对</span>
        </div>
        <p className="state-note">
          这场活动的团体时间尚未确认，请查看下方时间表。
        </p>
      </section>
    );
  const first = scheduled[0];
  const firstStart = getEffectiveTime(data, first)!.start;
  const lastEnd = new Date(
    Math.max(
      ...scheduled.map((group) => getEffectiveTime(data, group)!.end.getTime()),
    ),
  );
  const isBefore = now < firstStart;
  const isEnded = now >= lastEnd;
  const featured = current ?? next ?? scheduled[scheduled.length - 1];
  const effective = getEffectiveTime(data, featured)!;
  const original = getGroupWindow(data, featured, false)!;
  const progress = current
    ? getPerformanceProgress(data, current, now)
    : undefined;
  const eyebrow = current
    ? "NOW PLAYING"
    : isBefore
      ? "LIVE STARTS SOON"
      : isEnded
        ? "TODAY'S LIVE ENDED"
        : "INTERMISSION";
  const chinese = current
    ? "正在演出"
    : isBefore
      ? "即将开场"
      : isEnded
        ? "演出结束"
        : "场间休息";
  return (
    <section className="now-card" aria-label="当前演出">
      <div className="now-top">
        <div className="now-eyebrow">
          <span>{eyebrow}</span>
          <span>{chinese}</span>
        </div>
        <Star className="now-star" size={22} />
      </div>
      <div className="now-body">
        <GroupImage group={featured} className="now-image" />
        <div className="now-info">
          <div className="now-name-row">
            <h2>{isEnded ? "Thank you for coming!" : featured.name}</h2>
            {data.delay_minutes !== 0 && (
              <span className="delay-pill">
                {data.delay_minutes > 0 ? "+" : ""}
                {data.delay_minutes} MIN DELAY
              </span>
            )}
          </div>
          {!isEnded && (
            <>
              <div className="now-time">
                {formatTime(original.start)}{" "}
                <ArrowRight size={20} aria-label="至" />{" "}
                {formatTime(original.end)}
              </div>
              {data.delay_minutes !== 0 && (
                <div className="time-comparison">
                  <div>
                    <span>原定</span>
                    <strong>
                      {formatTime(original.start)} – {formatTime(original.end)}
                    </strong>
                  </div>
                  <div>
                    <span>预计</span>
                    <strong>
                      {formatTime(effective.start)} –{" "}
                      {formatTime(effective.end)}
                    </strong>
                  </div>
                </div>
              )}
              {current && progress ? (
                <div className="progress-area">
                  <div
                    className="progress-track"
                    role="progressbar"
                    aria-label="演出进度"
                    aria-valuenow={Math.round(progress.percent)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <div style={{ width: `${progress.percent}%` }} />
                  </div>
                  <div className="progress-label">
                    <span>
                      {progress.elapsedMinutes} min / {progress.durationMinutes}{" "}
                      min
                    </span>
                    <strong>剩余 {progress.remainingMinutes} 分钟</strong>
                  </div>
                </div>
              ) : (
                <p className="state-note">
                  {isBefore
                    ? `距离开场还有 ${minutesUntil(effective.start, now)} 分钟`
                    : `下一组 ${formatTime(effective.start)} 开始 · 还有 ${minutesUntil(effective.start, now)} 分钟`}
                </p>
              )}
            </>
          )}
          {isEnded && (
            <p className="ended-note">今天的舞台已落幕，期待下次见面 ♡</p>
          )}
        </div>
      </div>
    </section>
  );
}

export function NextUpCard({
  data,
  now,
  current,
  next,
  onClick,
}: {
  data: EventData;
  now: Date;
  current?: IdolGroup;
  next?: IdolGroup;
  onClick: () => void;
}) {
  return (
    <button
      className="next-card"
      onClick={onClick}
      aria-label={next ? `查看下一组 ${next.name}` : "查看完整时间表"}
    >
      <span className="next-tag">NEXT UP</span>
      {next ? (
        <>
          <GroupImage group={next} className="next-image" />
          <span className="next-copy">
            <strong>{next.name}</strong>
            <b>预计 {formatTime(getEffectiveTime(data, next)!.start)}</b>
            <small>
              还有 {minutesUntil(getEffectiveTime(data, next)!.start, now)} 分钟
            </small>
          </span>
        </>
      ) : (
        <span className="next-copy">
          <strong>
            {current
              ? "最后一组正在演出"
              : data.groups.some((group) => getEffectiveTime(data, group))
                ? "Today's live has ended"
                : "暂无可用演出时间"}
          </strong>
          <small>
            {current
              ? current.name
              : data.groups.some((group) => getEffectiveTime(data, group))
                ? "感谢来到现场"
                : "请核对导入的时间"}
          </small>
        </span>
      )}
      <ChevronRight className="next-chevron" size={24} />
    </button>
  );
}

export function DelayControl({
  delay,
  onChange,
  onReset,
  onOpen,
  disabled = false,
}: {
  delay: number;
  onChange: (delta: number) => void;
  onReset: () => void;
  onOpen: () => void;
  disabled?: boolean;
}) {
  return (
    <section className="delay-card" aria-label="现场延迟">
      <div className="section-heading">
        <Clock3 size={22} />
        <h2>现场延迟</h2>
        <span>将整体应用到今天全部演出时间</span>
        <Info size={15} aria-label="调整不会修改原始时间" />
      </div>
      <div className="delay-actions">
        {[-5, -1].map((amount) => (
          <button
            key={amount}
            onClick={() => onChange(amount)}
            disabled={disabled}
            aria-label={`延迟减少 ${Math.abs(amount)} 分钟`}
          >
            {amount}
          </button>
        ))}
        <button
          className="current-delay"
          onClick={onOpen}
          disabled={disabled}
          aria-label={`设置现场延迟，当前 ${delay} 分钟`}
        >
          {delay > 0 ? "+" : ""}
          {delay} min
        </button>
        {[1, 5].map((amount) => (
          <button
            key={amount}
            onClick={() => onChange(amount)}
            disabled={disabled}
            aria-label={`延迟增加 ${amount} 分钟`}
          >
            +{amount}
          </button>
        ))}
        <span className="delay-divider" />
        <button className="reset-button" onClick={onReset} disabled={disabled}>
          <RotateCcw size={17} /> 重置
        </button>
        <button className="set-delay" onClick={onOpen} disabled={disabled}>
          设置延迟
        </button>
      </div>
    </section>
  );
}

export function TimetableList({
  data,
  now,
  nextId,
}: {
  data: EventData;
  now: Date;
  nextId?: string;
}) {
  return (
    <section className="timetable-card" id="timetable" aria-label="完整时间表">
      <div className="timetable-heading">
        <div className="section-heading">
          <CalendarDays size={22} />
          <h2>TIMETABLE</h2>
        </div>
        {data.delay_minutes !== 0 && (
          <span className="overall-delay">
            <Clock3 size={15} /> 已整体延迟 {data.delay_minutes > 0 ? "+" : ""}
            {data.delay_minutes} 分钟
          </span>
        )}
      </div>
      <div className="timeline-list">
        {data.groups.map((group) => {
          const original = getGroupWindow(data, group, false);
          const effective = getEffectiveTime(data, group);
          const status = getPerformanceStatus(data, group, now, nextId);
          return (
            <div className={`timeline-row row-${status}`} key={group.id}>
              {original ? (
                <time
                  className="timeline-time"
                  dateTime={original.start.toISOString()}
                >
                  {formatTime(original.start)}
                </time>
              ) : (
                <span className="timeline-time">--:--</span>
              )}
              <span className="timeline-node" aria-hidden="true" />
              <GroupImage group={group} className="timeline-image" />
              <div className="timeline-copy">
                <strong>{group.name}</strong>
                <small>
                  {!original || !effective ? (
                    "时间待核对"
                  ) : data.delay_minutes === 0 ? (
                    `${formatTime(original.start)} – ${formatTime(original.end)}`
                  ) : (
                    <>
                      原定 {formatTime(original.start)} –{" "}
                      {formatTime(original.end)} <ArrowRight size={12} />{" "}
                      <b>
                        {formatTime(effective.start)} –{" "}
                        {formatTime(effective.end)}
                      </b>
                    </>
                  )}
                </small>
              </div>
              <span className={`status-badge status-${status}`}>
                {status === "finished"
                  ? "✓ FINISHED"
                  : status === "live"
                    ? "● LIVE"
                    : status === "next"
                      ? "NEXT"
                      : status === "unscheduled"
                        ? "待核对"
                        : "UPCOMING"}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
