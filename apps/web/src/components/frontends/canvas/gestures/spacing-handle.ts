import { copyOwner, isInstance, modeOf, type FrameNode, type Layout } from "@paprika/core";
import { withPatch } from "../preview-node";
import type { CanvasRuntime, Gesture } from "../types";
import { layoutAfterDrag, layoutAfterStep, spacingOf, unchangedSpacing, type Axis, type Side, type SpacingHandle } from "../vector/spacing";

export const SPACING_LABELS = { gap: "history.gap", padding: "history.padding" } as const;
/** A press that never moved this far (world px) leaves the layout alone. */
const MOVED = 0.5;

/** The frame the handles belong to: with auto-layout, not locked, not an instance nor a copy inside one. */
export function spacingFrame(rt: CanvasRuntime, id: string): (FrameNode & { layout: Layout }) | null {
  const node = rt.doc().nodes[id];
  if (!node || node.type !== "frame" || !node.layout || node.layout.mode === "none") return null;
  if (node.locked || isInstance(node) || copyOwner(rt.doc(), node)) return null;
  return node as FrameNode & { layout: Layout };
}

/** The frame as the previews show it (its layout may be one a drag is holding). */
export function shownFrame(rt: CanvasRuntime, id: string) {
  const node = spacingFrame(rt, id);
  const patch = rt.store.state.preview[id];
  return node && patch ? (withPatch(node, patch) as FrameNode & { layout: Layout }) : node;
}

type Handle = Pick<SpacingHandle, "kind" | "side" | "axis">;
export function handleOf(el: Element | null): (Handle & { frame: string }) | null {
  const host = el?.closest<HTMLElement>("[data-spacing]");
  const kind = host?.dataset.spacingKind;
  const frame = host?.dataset.spacingFrame;
  if (!host || !frame || (kind !== "padding" && kind !== "gap")) return null;
  return { frame, kind, axis: (host.dataset.spacingAxis === "x" ? "x" : "y") as Axis, side: host.dataset.spacingSide as Side | undefined };
}

/** Sends a layout: the frame shows it at once and one `update` goes out. */
export function commitLayout(rt: CanvasRuntime, id: string, layout: Layout, kind: "gap" | "padding") {
  rt.preview.set({ [id]: { layout } });
  rt.preview.commit([id], rt.apply([{ op: "update", id, props: { layout } }], rt.text(SPACING_LABELS[kind])));
}

/** The values a drag starts from, in pixels (tokens and modes resolved). */
export function startOf(rt: CanvasRuntime, frame: FrameNode & { layout: Layout }) {
  return spacingOf(rt.doc(), frame, modeOf(rt.doc(), frame));
}

/** Arrow keys on a focused handle: one step per press, one `update` per press. */
export function stepSpacing(rt: CanvasRuntime, handle: Handle & { frame: string }, delta: number, all: boolean) {
  const frame = shownFrame(rt, handle.frame);
  const start = frame && startOf(rt, frame);
  if (!frame || !start) return;
  const layout = layoutAfterStep(frame.layout, start, handle, delta, all);
  if (layout && !unchangedSpacing(handle.kind, layout, start)) commitLayout(rt, handle.frame, layout, handle.kind);
}

/**
 * Dragging a gap or padding handle of the selected auto-layout frame (Alt: the four paddings at once). The frame shows the
 * layout as the pointer moves; releasing sends one `update`, and nothing at all when it did not move.
 */
export const spacingHandle: Gesture = {
  id: "spacing-handle",
  accepts: (rt, event) => event.button === 0 && rt.tool() === "select" && handleOf(event.target as Element | null) !== null,
  start: (rt, event) => {
    const handle = handleOf(event.target as Element | null);
    const frame = handle && shownFrame(rt, handle.frame);
    const start = frame && startOf(rt, frame);
    if (!handle || !frame || !start || (handle.kind === "padding" && !handle.side)) return undefined;
    const { clientX: sx, clientY: sy } = event;
    const held = { alt: event.altKey };
    let at = { x: sx, y: sy };
    let last = frame.layout;
    let moved = false;
    const id = handle.frame;
    const rotation = frame.rotation || 0;
    const apply = () => {
      const zoom = rt.view.get().zoom;
      const dx = (at.x - sx) / zoom;
      const dy = (at.y - sy) / zoom;
      if (Math.hypot(dx, dy) >= MOVED) moved = true;
      const layout = layoutAfterDrag(frame.layout, start, handle, { dx, dy }, rotation, held.alt);
      if (!layout) return;
      last = layout;
      rt.preview.set({ [id]: { layout } });
    };
    // Alt can go down or up in the middle of the drag: the padding follows at the pointer's last place.
    const onKey = (ev: KeyboardEvent) => {
      held.alt = ev.altKey || ev.getModifierState("Alt");
      apply();
    };
    const off = () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    return {
      move: (ev) => {
        held.alt = ev.altKey;
        at = { x: ev.clientX, y: ev.clientY };
        apply();
      },
      up: () => {
        off();
        if (!moved || unchangedSpacing(handle.kind, last, start)) {
          rt.preview.clear([id]);
          return;
        }
        commitLayout(rt, id, last, handle.kind);
      },
      cancel: () => {
        off();
        rt.preview.clear([id]);
      },
    };
  },
};
