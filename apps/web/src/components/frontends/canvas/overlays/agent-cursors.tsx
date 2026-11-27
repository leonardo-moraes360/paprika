import { isRootFrame, type Document } from "@paprika/core";
import { Eye, Pencil } from "lucide-react";
import { memo, useCallback, useLayoutEffect, useRef } from "react";
import { toneSurface, type AgentColor } from "@/components/ui/agent-tone";
import { Cursor } from "@/components/ui/cursor";
import { useCollab, type CanvasAgent } from "../collab";
import { coveredBox } from "../geometry";
import { useCanvasRuntime } from "../runtime";
import type { Box } from "../types";
import { useDocVersion } from "./use-doc-version";

/** The outlines of one agent's nodes drawn at most; an agent that touches thousands of nodes is shown by the first of them. */
export const MAX_OUTLINES = 60;

const toneBorder: Record<AgentColor, string> = { "agent-1": "border-agent-1", "agent-2": "border-agent-2", "agent-3": "border-agent-3", "agent-4": "border-agent-4" };
const cornerGap = 12;

/** The frame an agent is working in: the root frame above a node (or the outermost frame when none is a root). */
export function topFrameId(doc: Document, nodeId: string): string | undefined {
  let current = doc.nodes[nodeId];
  let frame: string | undefined;
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    if (current.type === "frame") {
      frame = current.id;
      if (isRootFrame(doc, current)) return current.id;
    }
    current = current.parentId ? doc.nodes[current.parentId] : undefined;
  }
  return frame;
}

type Measured = { outlines: Box[]; frame: Box | null };

const union = (boxes: readonly Box[]): Box => {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const b of boxes) {
    left = Math.min(left, b.x);
    top = Math.min(top, b.y);
    right = Math.max(right, b.x + b.width);
    bottom = Math.max(bottom, b.y + b.height);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
};

type Refs = {
  outlines: HTMLElement[];
  cursor: HTMLElement | null;
  tag: HTMLElement | null;
  frame: HTMLElement | null;
};

/**
 * The layer above sets `--view-x` and `--view-y` on every pan frame. Nothing here reads them (only `--view-zoom`), but a changed custom
 * property restyles everything below it: a fixed value here stops the pan from reaching the marks of every agent.
 */
const noPan = { "--view-x": "0px", "--view-y": "0px" } as React.CSSProperties;
const scaled = { transformOrigin: "0 0", scale: "calc(1 / var(--view-zoom))" } as const;

/** One agent: a box around each node it touches, its cursor at the corner of them, a tag above, and the frame it is writing in. Placed by the parent. */
const AgentMark = memo(function AgentMark({ agent, refs, working }: { agent: CanvasAgent; refs: (id: string) => Refs; working: string }) {
  const mine = refs(agent.id);
  const writing = agent.activity === "writing" && !agent.idle;
  const nodes = agent.nodes.length > MAX_OUTLINES ? agent.nodes.slice(0, MAX_OUTLINES) : agent.nodes;
  const Icon = agent.activity === "writing" ? Pencil : Eye;
  return (
    <div data-testid="agent-cursor" data-agent={agent.id} data-activity={agent.activity} data-idle={agent.idle ? "" : undefined} className={`transition-opacity duration-600 ease-[ease] ${agent.idle ? "opacity-45" : ""}`}>
      {writing ? (
        <div data-testid="agent-working" ref={(el) => void (mine.frame = el)} className="absolute hidden">
          <div aria-hidden="true" className={`absolute inset-0 rounded-xs ${toneBorder[agent.tone]}`} style={{ borderWidth: "calc(2px / var(--view-zoom))" }} />
          <span
            className={`absolute top-0 left-1/2 rounded-md px-1.5 py-0.5 text-xs font-semibold whitespace-nowrap ${toneSurface[agent.tone]}`}
            style={{ transformOrigin: "50% 100%", transform: "translate(-50%, -100%) scale(calc(1 / var(--view-zoom)))" }}
          >
            {working}
          </span>
        </div>
      ) : null}
      {nodes.map((id, i) => (
        <div
          key={id}
          ref={(el) => {
            if (el) mine.outlines[i] = el;
          }}
          aria-hidden="true"
          data-agent-box={id}
          className={`absolute box-border hidden rounded-xs transition-[left,top,width,height] duration-450 ease-out motion-reduce:transition-none ${toneBorder[agent.tone]}`}
          style={{ borderWidth: "calc(1.5px / var(--view-zoom))" }}
        />
      ))}
      {!agent.idle ? (
        <div ref={(el) => void (mine.tag = el)} data-testid="agent-frame-state" data-activity={agent.activity} className="absolute hidden" style={scaled}>
          <span className={`inline-flex -translate-y-full items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${toneSurface[agent.tone]}`}>
            <Icon aria-hidden="true" className="size-3" />
            {agent.name} {agent.tool}
          </span>
        </div>
      ) : null}
      <div ref={(el) => void (mine.cursor = el)} className="absolute top-0 left-0 hidden transition-[translate] duration-550 ease-out motion-reduce:transition-none" style={scaled}>
        <Cursor tone={agent.tone} label={`${agent.name} · ${agent.verb}`} />
      </div>
    </div>
  );
});

const show = (el: HTMLElement | null, on: boolean) => {
  if (el) el.style.display = on ? "block" : "none";
};

/**
 * Who is working where. For each agent: the boxes of the nodes it touches that are on this page, its cursor at their corner (agents on
 * the same spot stack), the tag above, and the frame it is writing in. Everything is measured after a commit that painted
 * something and written to the elements; a presence heartbeat renders nothing, and a node never re-renders for an agent.
 */
export function AgentCursors() {
  const rt = useCanvasRuntime();
  const agents = useCollab(rt.collab, (c) => c.agents);
  const working = useCollab(rt.collab, (c) => c.working);
  const docVersion = useDocVersion();
  const all = useRef(new Map<string, Refs>());
  const refs = useCallback((id: string) => {
    let entry = all.current.get(id);
    if (!entry) all.current.set(id, (entry = { outlines: [], cursor: null, tag: null, frame: null }));
    return entry;
  }, []);

  // What was read last for each agent, with what it was read for: a flush of presence measures the agents that changed (or came), and
  // only a new document (a node may have moved or grown) measures them all again.
  const known = useRef(new Map<string, { key: string; measured: Measured }>());
  const seen = useRef(-1);

  useLayoutEffect(() => {
    const doc = rt.doc();
    const live = new Set(agents.map((agent) => agent.id));
    for (const id of [...all.current.keys()]) if (!live.has(id)) all.current.delete(id);
    for (const id of [...known.current.keys()]) if (!live.has(id)) known.current.delete(id);
    const documentMoved = seen.current !== docVersion;
    seen.current = docVersion;
    // Read every box first, write after (one layout).
    const fresh = new Set<string>();
    for (const agent of agents) {
      const key = `${agent.activity}|${agent.idle}|${agent.nodes.join(",")}`;
      const have = known.current.get(agent.id);
      if (have && have.key === key && !documentMoved) continue;
      const outlines: Box[] = [];
      for (const id of agent.nodes.length > MAX_OUTLINES ? agent.nodes.slice(0, MAX_OUTLINES) : agent.nodes) {
        const box = rt.measure(id);
        outlines.push(box ? coveredBox(box) : { x: NaN, y: NaN, width: 0, height: 0 });
      }
      let frame: Box | null = null;
      if (agent.activity === "writing" && !agent.idle) {
        for (const id of agent.nodes) {
          const top = topFrameId(doc, id);
          if (!top) continue;
          const box = rt.measure(top);
          if (box) {
            frame = coveredBox(box);
            break;
          }
        }
      }
      known.current.set(agent.id, { key, measured: { outlines, frame } });
      fresh.add(agent.id);
    }
    const stacked = new Map<string, number>();
    for (const agent of agents) {
      const mine = all.current.get(agent.id);
      const m = known.current.get(agent.id)?.measured;
      if (!mine || !m) continue;
      const present = m.outlines.filter((b) => !Number.isNaN(b.x));
      // The elements of an agent that did not change are as they were left: only the stack (who shares a spot) is worked out again for all.
      if (fresh.has(agent.id)) {
        m.outlines.forEach((b, i) => {
          const el = mine.outlines[i];
          if (!el) return;
          const ok = !Number.isNaN(b.x);
          show(el, ok);
          if (ok) Object.assign(el.style, { left: `${b.x}px`, top: `${b.y}px`, width: `${b.width}px`, height: `${b.height}px` });
        });
        show(mine.cursor, present.length > 0);
        show(mine.tag, present.length > 0);
        if (mine.frame) {
          show(mine.frame, !!m.frame);
          if (m.frame) Object.assign(mine.frame.style, { left: `${m.frame.x}px`, top: `${m.frame.y}px`, width: `${m.frame.width}px`, height: `${m.frame.height}px` });
        }
      }
      if (present.length === 0) continue;
      const box = union(present);
      const key = `${Math.round(box.x)},${Math.round(box.y)},${Math.round(box.width)},${Math.round(box.height)}`;
      const stack = stacked.get(key) ?? 0;
      stacked.set(key, stack + 1);
      const zoom = rt.view.get().zoom;
      const tipX = box.x + box.width - Math.min(cornerGap / zoom, box.width / 4) + (stack * 10) / zoom;
      const tipY = box.y + box.height - Math.min(cornerGap / zoom, box.height / 4) + (stack * 24) / zoom;
      const cursorAt = `${tipX}px ${tipY}px`;
      const tagAt = `${box.x}px ${box.y - (stack * 18) / zoom - 4 / zoom}px`;
      if (mine.cursor && mine.cursor.style.translate !== cursorAt) mine.cursor.style.translate = cursorAt;
      if (mine.tag && mine.tag.style.translate !== tagAt) mine.tag.style.translate = tagAt;
    }
  }, [rt, agents, docVersion]);

  if (agents.length === 0) return null;
  return (
    <div data-testid="agent-layer" aria-hidden="true" style={noPan}>
      {agents.map((agent) => (
        <AgentMark key={agent.id} agent={agent} refs={refs} working={working} />
      ))}
    </div>
  );
}
