import { useEffect, useState, type ReactNode } from "react";
import { AGENT_COLORS } from "./agents";
import type { Activity as ActivityEntry } from "./useDocument";
import { cx, ui } from "./ui";

function isStep(label: string): boolean {
  return /^(desfazer|refazer):/i.test(label);
}

function markerIndex(entries: ActivityEntry[]): number {
  let i = 0;
  while (i < entries.length && isStep(entries[i]!.label)) i++;
  return i;
}

function actorName(actor: string): string {
  if (actor === "user") return "você";
  if (actor.startsWith("agent:")) return actor.slice(6) || "agente";
  if (actor.startsWith("agent")) return actor.replace(/^agent:?/, "") || "agente";
  return actor;
}

function actorColor(actor: string): string {
  if (!actor.startsWith("agent")) return "var(--color-muted)";
  let h = 0;
  for (let i = 0; i < actor.length; i++) h = (h * 31 + actor.charCodeAt(i)) | 0;
  return AGENT_COLORS[Math.abs(h) % AGENT_COLORS.length]!;
}

function relativeTime(at: number, now: number): string {
  const s = Math.max(0, Math.floor((now - at) / 1000));
  if (s < 5) return "agora";
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h`;
  return `${Math.floor(h / 24)} d`;
}

function batchFlags(entries: ActivityEntry[]): boolean[] {
  const flags = entries.map(() => false);
  let i = 0;
  while (i < entries.length) {
    if (isStep(entries[i]!.label)) {
      i++;
      continue;
    }
    let j = i + 1;
    while (j < entries.length && !isStep(entries[j]!.label) && entries[j]!.actor === entries[i]!.actor) j++;
    if (j - i >= 2) {
      for (let k = i; k < j; k++) flags[k] = true;
    }
    i = Math.max(j, i + 1);
  }
  return flags;
}

function Marker() {
  return (
    <li data-testid="activity-marker" className={ui.activityMarker} aria-label="Posição atual no histórico">
      <span className={ui.activityMarkerLine} aria-hidden />
      <span>agora</span>
      <span className={ui.activityMarkerLine} aria-hidden />
    </li>
  );
}

export function Activity({ activity }: { activity: ActivityEntry[] }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const entries = activity.slice(0, 15);
  if (entries.length === 0) {
    return <p className={ui.muted}>Nenhuma edição ainda.</p>;
  }

  const mark = markerIndex(entries);
  const batched = batchFlags(entries);
  const rows: ReactNode[] = [];
  for (let i = 0; i < entries.length; i++) {
    if (i === mark) rows.push(<Marker key="activity-marker" />);
    const a = entries[i]!;
    const name = actorName(a.actor);
    const color = actorColor(a.actor);
    const label = a.label || "edição";
    const step = isStep(label);
    rows.push(
      <li
        key={a.id}
        data-testid="activity-row"
        data-actor={name}
        className={cx(ui.activityRow, batched[i] && ui.activityBatch, step && "opacity-70")}
      >
        <span className={ui.activityDot} style={{ background: color }} aria-hidden />
        <span className={ui.activityActor}>{name}</span>
        <span className={ui.activityLabel} aria-label={label}>
          {label}
        </span>
        <time className={ui.activityTime} dateTime={new Date(a.at).toISOString()}>
          {relativeTime(a.at, now)}
        </time>
      </li>,
    );
  }
  if (mark >= entries.length) rows.push(<Marker key="activity-marker" />);

  return (
    <ul className={ui.activityList} data-testid="activity-list">
      {rows}
    </ul>
  );
}
