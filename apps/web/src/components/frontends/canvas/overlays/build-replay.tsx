import { useEffect } from "react";
import type { AgentColor } from "@/components/ui/agent-tone";
import { elementOf } from "../geometry";
import { useCanvasRuntime } from "../runtime";

/** The colour an agent's mark has: its tone token, so the outline follows the theme. */
const toneVar: Record<AgentColor, string> = { "agent-1": "var(--color-agent-1)", "agent-2": "var(--color-agent-2)", "agent-3": "var(--color-agent-3)", "agent-4": "var(--color-agent-4)" };

/**
 * The replay of what an agent builds: the node it is "drawing" now carries `data-build="current"` and `--build` (its colour),
 * and the world's CSS outlines it. The owner steps the walk on its own clock; this writes the attribute on the elements and takes it
 * off the ones the walk left. No React state, no node renders: only the elements that change are touched.
 */
export function BuildReplay() {
  const rt = useCanvasRuntime();
  useEffect(() => {
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
    paint();
    const offCollab = rt.collab?.subscribe(paint);
    // A node the agent has just created may reach the DOM after the step that names it.
    const offDoc = rt.index.subscribeDoc(paint);
    return () => {
      offCollab?.();
      offDoc();
      for (const el of marked.keys()) {
        el.removeAttribute("data-build");
        el.style.removeProperty("--build");
      }
    };
  }, [rt]);
  return null;
}
