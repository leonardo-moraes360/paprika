import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import type { Document } from "@paprika/core";
import { useLive } from "./useDocument";
import { AGENT_IDLE_MS, AGENT_TTL_MS, ROSTER_HIDE_IDLE_MS, agentActive, agentInk, agentPage, byBusyness, clientGroups, toolActivity, toolVerb, topFrameId, type AgentPresence, type BuildReplay } from "./agents";
import { useT } from "./i18n";
import { Hint } from "./components/ui/tooltip";
import { cx } from "./ui";
import { useViewStore, useViewValue, type View } from "./viewStore";

function worldBox(vp: HTMLElement, id: string, view: View): Box | null {
  const el = vp.querySelector<HTMLElement>(`.world [data-paprika-id="${CSS.escape(id)}"]`);
  if (!el) return null;
  const vpr = vp.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  return { x: (r.left - vpr.left - view.x) / view.zoom, y: (r.top - vpr.top - view.y) / view.zoom, w: r.width / view.zoom, h: r.height / view.zoom };
}

const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function restorePaint(el: HTMLElement) {
  if (!el.hasAttribute("data-build-bg")) return;
  el.style.backgroundColor = el.getAttribute("data-build-bg") ?? "";
  el.style.color = el.getAttribute("data-build-color") ?? "";
  el.style.borderColor = el.getAttribute("data-build-border") ?? "";
  el.removeAttribute("data-build-bg");
  el.removeAttribute("data-build-color");
  el.removeAttribute("data-build-border");
}

function blankPaint(el: HTMLElement) {
  if (el.hasAttribute("data-build-bg")) return;
  el.setAttribute("data-build-bg", el.style.backgroundColor);
  el.setAttribute("data-build-color", el.style.color);
  el.setAttribute("data-build-border", el.style.borderColor);
  el.style.backgroundColor = "transparent";
  el.style.color = "transparent";
  el.style.borderColor = "transparent";
}

function paintBuild(vp: HTMLElement, build: BuildReplay | null, color: string) {
  const reduce = reduceMotion();
  const next = new Map<HTMLElement, string>();
  build?.ids.forEach((id, i) => {
    const el = vp.querySelector<HTMLElement>(`.world [data-paprika-id="${CSS.escape(id)}"]`);
    if (!el) return;
    next.set(el, i < build.index ? "shown" : i === build.index ? "current" : "wait");
  });
  for (const el of vp.querySelectorAll<HTMLElement>("[data-build]")) {
    if (next.has(el)) continue;
    restorePaint(el);
    el.removeAttribute("data-build");
    el.style.removeProperty("--build");
  }
  for (const [el, phase] of next) {
    if (el.getAttribute("data-build") !== phase) el.setAttribute("data-build", phase);
    if (phase === "current") {
      el.style.setProperty("--build", color);
      if (reduce) restorePaint(el);
      else blankPaint(el);
    } else {
      el.style.removeProperty("--build");
      restorePaint(el);
    }
  }
}

const union = (bs: Box[]): Box => {
  const x = Math.min(...bs.map((b) => b.x));
  const y = Math.min(...bs.map((b) => b.y));
  return { x, y, w: Math.max(...bs.map((b) => b.x + b.w)) - x, h: Math.max(...bs.map((b) => b.y + b.h)) - y };
};

const tagFont = "[font:600_11px/16px_system-ui,sans-serif]";
const FEW = 5;

function RosterSection({
  title,
  people,
  showRest,
  onMore,
  focusButton,
  faded,
}: {
  title: string;
  people: AgentPresence[];
  showRest: boolean;
  onMore(): void;
  focusButton(agent: AgentPresence, expanded: boolean): ReactNode;
  faded?: boolean;
}) {
  if (!people.length) return null;
  const sorted = byBusyness(people);
  const shown = showRest ? sorted : sorted.slice(0, FEW);
  const hidden = sorted.length - shown.length;
  const counts = new Map(clientGroups(sorted).map((group) => [group.actor, group.agents.length]));
  return (
    <section className={cx("mt-1", faded && "opacity-55")}>
      <h3 className={cx("m-0 px-1 py-1 text-ui-muted-foreground", tagFont)}>{title}</h3>
      {clientGroups(shown).map((group) => {
        const count = counts.get(group.actor) ?? group.agents.length;
        const writing = group.agents.filter((agent) => toolActivity(agent.tool) === "writing");
        const reading = group.agents.filter((agent) => toolActivity(agent.tool) === "reading");
        return (
          <div key={group.actor} data-testid="agent-client">
            {count > 1 && (
              <p className={cx("m-0 px-1 py-0.5 text-ui-foreground", tagFont)}>
                {group.label} ×{count}
              </p>
            )}
            {writing.length > 0 && (
              <div data-activity="writing">
                <p className={cx("m-0 px-1 py-0.5 text-ui-muted-foreground", tagFont)}>Escrevendo</p>
                <ul className="m-0 flex list-none flex-col gap-1 p-0">
                  {writing.map((agent) => (
                    <li key={agent.agent} className="flex" data-activity="writing">{focusButton(agent, true)}</li>
                  ))}
                </ul>
              </div>
            )}
            {reading.length > 0 && (
              <div data-activity="reading">
                <p className={cx("m-0 px-1 py-0.5 text-ui-muted-foreground", tagFont)}>Lendo</p>
                <ul className="m-0 flex list-none flex-col gap-1 p-0">
                  {reading.map((agent) => (
                    <li key={agent.agent} className="flex" data-activity="reading">{focusButton(agent, true)}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        );
      })}
      {hidden > 0 && (
        <button type="button" className={cx("m-0 cursor-pointer border-0 bg-transparent px-1 py-0.5 text-ui-muted-foreground", tagFont)} data-testid="agent-roster-more" onClick={onMore}>
          +{hidden}
        </button>
      )}
    </section>
  );
}

export type Box = { x: number; y: number; w: number; h: number };

interface Props {
  doc: Document;
  viewportRef: RefObject<HTMLDivElement | null>;
  layoutKey?: unknown;
  pageId?: string | null;
  onOpenPage?(id: string): void;
  onFocus?(box: Box): void;
}

export function AgentCursors({ doc, viewportRef, layoutKey, pageId, onOpenPage, onFocus }: Props) {
  const agents = useLive((s) => s.agents);
  const build = useLive((s) => s.build);
  const m = useT();
  const viewStore = useViewStore();
  const view = useViewValue(viewStore);
  const [boxes, setBoxes] = useState<Record<string, Box[]>>({});
  const [frames, setFrames] = useState<Record<string, Box>>({});
  const [now, setNow] = useState(() => Date.now());
  const [open, setOpen] = useState(false);
  const [showRest, setShowRest] = useState(false);
  const [inset, setInset] = useState({ top: 64, right: 12 });
  const rosterRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!agents.length) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 2000);
    return () => clearInterval(t);
  }, [agents]);

  useLayoutEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const vpr = vp.getBoundingClientRect();
    const v = viewStore.get();
    const next: Record<string, Box[]> = {};
    const nextFrames: Record<string, Box> = {};
    for (const a of agents) {
      next[a.agent] = a.nodes.flatMap((id) => {
        const el = vp.querySelector<HTMLElement>(`.world [data-paprika-id="${CSS.escape(id)}"]`);
        if (!el) return [];
        const r = el.getBoundingClientRect();
        return [{ x: (r.left - vpr.left - v.x) / v.zoom, y: (r.top - vpr.top - v.y) / v.zoom, w: r.width / v.zoom, h: r.height / v.zoom }];
      });
      const frameId = a.nodes.map((id) => topFrameId(doc, id)).find((id): id is string => !!id);
      const frame = frameId ? worldBox(vp, frameId, v) : null;
      if (frame) nextFrames[a.agent] = frame;
    }
    setBoxes(next);
    setFrames(nextFrames);
    const writer = agents.find((a) => a.actor === build?.actor && toolActivity(a.tool) === "writing") ?? agents.find((a) => a.actor === build?.actor);
    paintBuild(vp, build, writer?.color ?? "#3b82f6");
  }, [doc, agents, build, viewportRef, layoutKey, pageId, viewStore]);

  const pending = useRef<string | null>(null);
  useEffect(() => {
    const bs = pending.current ? boxes[pending.current] : undefined;
    if (!bs?.length) return;
    pending.current = null;
    onFocus?.(union(bs));
  }, [boxes, onFocus]);

  useLayoutEffect(() => {
    const place = () => {
      const roster = rosterRef.current;
      const vp = viewportRef.current;
      const host = vp?.parentElement;
      if (!roster || !vp || !host) return;
      const vpBox = vp.getBoundingClientRect();
      const bar = host.querySelector<HTMLElement>("[data-toolbar-dock]");
      const dock = bar?.getAttribute("data-toolbar-dock");
      const toggle = host.querySelector<HTMLElement>("[data-panel-toggle=right]");
      let top = 12;
      let right = 12;
      if (dock === "top" && bar) top = Math.max(top, bar.getBoundingClientRect().bottom - vpBox.top + 8);
      if (dock === "right" && bar) right = Math.max(right, vpBox.right - bar.getBoundingClientRect().left + 8);
      if (toggle) {
        const box = toggle.getBoundingClientRect();
        const x = vpBox.right - right - roster.offsetWidth;
        const y = vpBox.top + top;
        const hit = x < box.right && box.left < x + roster.offsetWidth && y < box.bottom && box.top < y + roster.offsetHeight;
        if (hit) top = Math.max(top, box.bottom - vpBox.top + 8);
      }
      if (dock === "bottom" && bar) {
        const box = bar.getBoundingClientRect();
        const y = vpBox.top + top;
        const height = roster.offsetHeight;
        if (y + height > box.top - 8) top = Math.max(12, box.top - vpBox.top - height - 8);
      }
      setInset((cur) => (cur.top === top && cur.right === right ? cur : { top, right }));
    };
    place();
    const host = viewportRef.current?.parentElement;
    const mo = new MutationObserver(place);
    if (host) mo.observe(host, { attributes: true, subtree: true, attributeFilter: ["data-toolbar-dock", "data-panel-toggle", "class"] });
    window.addEventListener("resize", place);
    return () => {
      mo.disconnect();
      window.removeEventListener("resize", place);
    };
  }, [viewportRef, open, showRest, agents]);

  const visible = agents.filter((a) => now - a.at < AGENT_TTL_MS);
  if (!visible.length) return null;
  const z = view.zoom;
  const tipKey = (bs: Box[]) => (bs.length ? bs.map((b) => `${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.w)},${Math.round(b.h)}`).join(";") : "");
  const tips = visible.map((a) => tipKey(boxes[a.agent] ?? []));

  const label = "font-normal not-italic text-muted";
  const where = (a: AgentPresence) => {
    if ((boxes[a.agent]?.length ?? 0) || !a.nodes.length) return <em className={label}>{toolVerb(a.tool)}</em>;
    const p = agentPage(doc, a.nodes);
    if (!p || p.id === pageId) return <em className={label}>em outra página</em>;
    return <em className={label} data-testid="agent-page">em {p.name || "outra página"}</em>;
  };
  const target = (a: AgentPresence): (() => void) | undefined => {
    const bs = boxes[a.agent] ?? [];
    if (bs.length) return onFocus && (() => onFocus(union(bs)));
    const p = agentPage(doc, a.nodes);
    if (!p || p.id === pageId || !onOpenPage) return undefined;
    return () => {
      pending.current = a.agent;
      onOpenPage(p.id);
    };
  };

  const roster = visible.filter((a) => now - a.at <= ROSTER_HIDE_IDLE_MS);
  const active = byBusyness(roster.filter((a) => agentActive(a, now)));
  const idlePeople = byBusyness(roster.filter((a) => !agentActive(a, now)));
  const dots = active.slice(0, 8);
  const focusButton = (a: AgentPresence, expanded: boolean) => {
    const go = target(a);
    const p = !boxes[a.agent]?.length && agentPage(doc, a.nodes);
    const idle = !agentActive(a, now);
    const tip = go ? (p ? `Ir até ${a.name} na página ${p.name || "dele"}` : `Ir até o cursor de ${a.name}`) : `${a.name}: ${toolVerb(a.tool)}`;
    const btn = (
      <button
        type="button"
        className={cx(
          expanded
            ? "m-0 flex w-full items-center gap-1.5 rounded-full border border-[color-mix(in_srgb,var(--agent)_55%,transparent)] bg-ui-card py-0.75 pr-2.25 pl-1.75 text-left text-ui-foreground"
            : "m-0 size-4 overflow-hidden rounded-full border-0 p-0",
          "enabled:pointer-events-auto enabled:cursor-pointer enabled:hover:border-(--agent) focus-visible:outline-2 focus-visible:outline-(--agent)",
          tagFont,
          idle && "opacity-55",
        )}
        style={{ ["--agent" as string]: a.color, ["--agent-ink" as string]: agentInk(a.color), ...(expanded ? {} : { background: a.color, color: agentInk(a.color) }) }}
        disabled={!go}
        onClick={go}
        data-testid="agent-focus"
      >
        {expanded && <span className="size-2 shrink-0 rounded-full bg-(--agent)" />}
        <span className={cx(expanded ? "min-w-0 truncate" : "block whitespace-nowrap")} style={expanded ? undefined : { textIndent: -9999 }}>
          {a.name} {where(a)}
        </span>
      </button>
    );
    return (
      <Hint label={tip}>
        {go ? btn : <span className="inline-flex" tabIndex={0}>{btn}</span>}
      </Hint>
    );
  };

  return (
    <>
      <div className="pointer-events-none absolute top-0 left-0 z-5 origin-top-left" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${z})` }} aria-hidden>
        {visible.map((a) => {
          if (!agentActive(a, now) || toolActivity(a.tool) !== "writing") return null;
          const frame = frames[a.agent];
          if (!frame) return null;
          return (
            <div
              key={`work-${a.agent}`}
              className="absolute top-0 left-0 origin-top-left"
              style={{ ["--agent" as string]: a.color, ["--agent-ink" as string]: agentInk(a.color), translate: `${frame.x}px ${frame.y}px` }}
              data-testid="agent-working"
              data-agent={a.agent}
            >
              <div className="absolute box-border rounded-xs border-(--agent)" style={{ width: frame.w, height: frame.h, borderWidth: 2 / z }} />
              <span
                className={cx("agent-working absolute top-0 left-0 rounded-md bg-(--agent) px-1.5 py-0.5 whitespace-nowrap text-(--agent-ink) shadow-tag", tagFont)}
                style={{ translate: `${Math.max(0, frame.w / 2)}px ${-22 / z}px`, scale: `${1 / z}` }}
              >
                {m.verbGeneric}
              </span>
            </div>
          );
        })}
        {visible.map((a, i) => {
          const bs = boxes[a.agent] ?? [];
          if (!bs.length) return null;
          const left = Math.min(...bs.map((b) => b.x));
          const top = Math.min(...bs.map((b) => b.y));
          const right = Math.max(...bs.map((b) => b.x + b.w));
          const bottom = Math.max(...bs.map((b) => b.y + b.h));
          const stack = tips.slice(0, i).filter((t) => t === tipKey(bs)).length;
          const tipX = right - Math.min(12 / z, (right - left) / 4) + (stack * 10) / z;
          const tipY = bottom - Math.min(12 / z, (bottom - top) / 4) + (stack * 24) / z;
          const idle = now - a.at > AGENT_IDLE_MS;
          const activity = toolActivity(a.tool);
          return (
            <div key={a.agent} className={cx("transition-opacity duration-600 ease-[ease]", idle && "opacity-45")} style={{ ["--agent" as string]: a.color, ["--agent-ink" as string]: agentInk(a.color) }} data-agent={a.agent} data-testid="agent-cursor">
              {bs.map((b, i) => (
                <div
                  key={i}
                  className="absolute box-border rounded-xs border-[1.5px] border-(--agent) transition-[left,top,width,height] duration-450 ease-glide motion-reduce:transition-none"
                  style={{ left: b.x, top: b.y, width: b.w, height: b.h, borderWidth: 1.5 / z }} />
              ))}
              {!idle && (
                <div
                  className="absolute top-0 left-0 origin-top-left"
                  style={{ translate: `${left}px ${top - (22 + stack * 18) / z}px`, scale: `${1 / z}` }}
                  data-testid="agent-frame-state"
                  data-activity={activity}
                >
                  <span className={cx("rounded-md bg-(--agent) px-1.5 py-0.5 whitespace-nowrap text-(--agent-ink) shadow-tag", tagFont)}>
                    {activity === "writing" ? "escrevendo" : "lendo"}
                  </span>
                </div>
              )}
              <div
                className="agent-cursor absolute top-0 left-0 flex origin-top-left items-start transition-[translate] duration-550 ease-glide motion-reduce:transition-none"
                style={{ translate: `${tipX}px ${tipY}px`, scale: `${1 / z}` }}>
                <svg className="-mt-[1.5px] -ml-[1.5px] drop-shadow-cursor" width="18" height="20" viewBox="0 0 18 20" aria-hidden>
                  <path className="fill-(--agent) stroke-white stroke-[1.2] [stroke-linejoin:round]" d="M1.5 1.5 L1.5 16.5 L5.6 12.6 L8.4 18.6 L11.1 17.4 L8.4 11.5 L14.2 11.5 Z" />
                </svg>
                <span className={cx("mt-3.5 -ml-0.5 rounded-md bg-(--agent) px-1.75 py-0.5 whitespace-nowrap text-(--agent-ink) shadow-tag", tagFont)}>
                  {a.name} <em className={cx("font-normal not-italic opacity-85", !idle && "after:content-['…']")}>{toolVerb(a.tool)}</em>
                </span>
              </div>
            </div>
          );
        })}
      </div>
      {roster.length > 0 && (
        <div
          ref={rosterRef}
          className="pointer-events-none absolute z-6 flex flex-col items-end gap-1"
          style={{ top: inset.top, right: inset.right }}
          aria-label="Agentes no workspace"
          data-testid="agent-roster"
        >
          <div className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-ui-border bg-ui-card py-1 pr-2 pl-2.5 shadow-float">
            <button
              type="button"
              className={cx("m-0 cursor-pointer border-0 bg-transparent p-0 text-ui-foreground", tagFont)}
              aria-expanded={open}
              aria-controls="agent-roster-panel"
              data-testid="agent-roster-toggle"
              onClick={() => setOpen((value) => !value)}
            >
              {active.length} {active.length === 1 ? "ativo" : "ativos"}
            </button>
            {!open && (
              <ul className="m-0 flex list-none items-center gap-1 p-0">
                {dots.map((a) => (
                  <li key={a.agent} className="flex" data-activity={toolActivity(a.tool)}>
                    {focusButton(a, false)}
                  </li>
                ))}
                {active.length > dots.length && (
                  <li className="flex">
                    <button
                      type="button"
                      className={cx("pointer-events-auto m-0 cursor-pointer border-0 bg-transparent p-0 text-ui-muted-foreground", tagFont)}
                      data-testid="agent-roster-more"
                      onClick={() => {
                        setShowRest(true);
                        setOpen(true);
                      }}
                    >
                      +{active.length - dots.length}
                    </button>
                  </li>
                )}
              </ul>
            )}
            {open && (
              <span className="flex gap-1" aria-hidden>
                {active.slice(0, 8).map((a) => (
                  <span key={a.agent} className="size-2 rounded-full" style={{ background: a.color }} />
                ))}
              </span>
            )}
          </div>
          {open && (
            <div id="agent-roster-panel" className="pointer-events-auto w-[240px] rounded-xl border border-ui-border bg-ui-card p-2 shadow-float">
              <RosterSection title="Ativos" people={active} showRest={showRest} onMore={() => setShowRest(true)} focusButton={focusButton} />
              <RosterSection title="Ociosos" people={idlePeople} showRest={showRest} onMore={() => setShowRest(true)} focusButton={focusButton} faded />
            </div>
          )}
        </div>
      )}
    </>
  );
}
