import { useEffect, useRef } from "react";
import type { AgentColor } from "@/components/ui/agent-tone";
import { coveredBox, elementOf } from "../geometry";
import { useCanvasRuntime } from "../runtime";
import { ring } from "./stroke";

/** The colour an agent's mark has: its tone token, so the outline follows the theme. */
const toneVar: Record<AgentColor, string> = { "agent-1": "var(--color-agent-1)", "agent-2": "var(--color-agent-2)", "agent-3": "var(--color-agent-3)", "agent-4": "var(--color-agent-4)" };

/** The room between a node and its replay outline, and the outline's width, in screen pixels. */
const GAP = 1;
const WIDTH = 1.5;
const grow = `calc(${GAP + WIDTH}px / var(--view-zoom, 1))`;

/**
 * The replay of what an agent builds: the node it is "drawing" now carries `data-build="current"` and `--build` (its colour), and an
 * outline of that colour is drawn around it in the layer of the overlays (not on the node: the world is `scheme-light`, so a token
 * drawn there would take its light value in a dark app, and the width would not hold at any zoom). The owner steps the walk on its own
 * clock; this writes the attribute on the elements and takes it off the ones the walk left. No node renders: only the elements that change are touched.
 */
export function BuildReplay() {
  const rt = useCanvasRuntime();
  const layer = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = layer.current;
    const outlines = new Map<string, HTMLElement>();
    const marked = new Map<HTMLElement, string>();
    const paint = () => {
      const world = rt.world();
      const steps = rt.collab?.get().build ?? [];
      const next = new Map<HTMLElement, string>();
      if (world) {
        for (const step of steps) {
          const el = elementOf(world, step.id);
          if (el) next.set(el, toneVar[step.tone]);
        }
      }
      for (const el of [...marked.keys()]) {
        if (next.has(el)) continue;
        el.removeAttribute("data-build");
        el.style.removeProperty("--build");
        marked.delete(el);
      }
      for (const [el, color] of next) {
        if (el.getAttribute("data-build") !== "current") el.setAttribute("data-build", "current");
        if (marked.get(el) !== color) el.style.setProperty("--build", color);
        marked.set(el, color);
      }
    };
    // The outlines are plain elements written here, never React state: the walk steps without a commit.
    const outline = () => {
      const steps = rt.collab?.get().build ?? [];
      if (!host) return;
      const live = new Set(steps.map((step) => step.id));
      for (const [id, el] of outlines) {
        if (live.has(id)) continue;
        el.remove();
        outlines.delete(id);
      }
      for (const step of steps) {
        let el = outlines.get(step.id);
        if (!el) {
          el = document.createElement("div");
          el.setAttribute("data-build-outline", step.id);
          el.className = "pointer-events-none absolute box-content";
          el.style.boxShadow = String(ring(WIDTH, toneVar[step.tone]).boxShadow);
          el.style.padding = grow;
          el.style.margin = `calc(-1 * ${grow})`;
          host.append(el);
          outlines.set(step.id, el);
        }
        const measured = rt.measure(step.id);
        if (!measured) {
          el.style.display = "none";
          continue;
        }
        const box = coveredBox(measured);
        el.style.display = "block";
        el.style.left = `${box.x}px`;
        el.style.top = `${box.y}px`;
        el.style.width = `${box.width}px`;
        el.style.height = `${box.height}px`;
      }
    };
    const both = () => {
      paint();
      outline();
    };
    both();
    const offCollab = rt.collab?.subscribe(both);
    // A node the agent has just created may reach the DOM after the step that names it.
    const offDoc = rt.index.subscribeDoc(both);
    return () => {
      offCollab?.();
      offDoc();
      for (const el of outlines.values()) el.remove();
      for (const el of marked.keys()) {
        el.removeAttribute("data-build");
        el.style.removeProperty("--build");
      }
    };
  }, [rt]);
  return <div ref={layer} data-testid="build-outlines" aria-hidden="true" />;
}

