import { bindDrag, bindDragPreview, createAutoScroll, dragThreshold } from "@ui-sdk/core";
import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { blockedIndexes, canDrop, dropPosition, acceptsChildren, topmostIds } from "./tree-data";
import { LayersPanelRegion } from "./store";
import type { LayerDropPosition, LayerMove, LayerRowData } from "./types";

type Target = { targetId: string; position: LayerDropPosition };

export type LayerDragOptions = {
  rows: readonly LayerRowData[];
  wrapper: RefObject<HTMLElement | null>;
  overlay: RefObject<HTMLElement | null>;
  onMove: (move: LayerMove) => void;
};

const INDENT = 20;
const BASE_START = 8;

export function useLayerDrag({ rows, wrapper, overlay, onMove }: LayerDragOptions) {
  const actions = LayersPanelRegion.useRegionActions();
  const latest = useRef({ rows, onMove });
  latest.current = { rows, onMove };
  const stop = useRef<(() => void) | null>(null);

  useEffect(() => () => stop.current?.(), []);

  const hideOverlay = useCallback(() => {
    const el = overlay.current;
    if (el) el.dataset.mode = "none";
  }, [overlay]);

  const showOverlay = useCallback(
    (rowEl: HTMLElement, level: number, position: LayerDropPosition) => {
      const el = overlay.current;
      const box = wrapper.current;
      if (!el || !box) return;
      const rect = rowEl.getBoundingClientRect();
      const base = box.getBoundingClientRect();
      const rtl = getComputedStyle(box).direction === "rtl";
      const start = (rtl ? base.right - rect.right : rect.left - base.left) + level * INDENT + BASE_START;
      const top = rect.top - base.top;
      el.style.setProperty("--drop-start", `${start}px`);
      if (position === "inside") {
        el.style.setProperty("--drop-top", `${top}px`);
        el.style.setProperty("--drop-height", `${rect.height}px`);
        el.style.setProperty("--drop-start", `${rtl ? base.right - rect.right : rect.left - base.left}px`);
        el.dataset.mode = "ring";
      } else {
        el.style.setProperty("--drop-top", `${position === "before" ? top : top + rect.height}px`);
        el.dataset.mode = "line";
      }
    },
    [overlay, wrapper],
  );

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0 || !event.isPrimary) return;
      const source = event.target instanceof Element ? event.target : null;
      const rowEl = source?.closest<HTMLElement>("[data-layer-id]");
      if (!rowEl || source?.closest("button, input")) return;
      const { rows: current } = latest.current;
      const id = rowEl.dataset.layerId as string;
      const row = current.find((candidate) => candidate.id === id);
      if (!row || row.draggable === false) return;
      // A plain click is a press too: the work that only a drag needs (the set being moved, the blocked rows, the index) waits for the drag to start.
      let moving: string[] = [];
      let blocked: ReadonlySet<number> = new Set();
      let indexOf: ReadonlyMap<string, number> = new Map();
      let preview: ReturnType<typeof bindDragPreview> | null = null;
      let target: Target | null = null;
      let last = { x: event.clientX, y: event.clientY };
      const scroll = createAutoScroll({ edge: 36, speed: 12, ignore: () => preview?.el, onScroll: () => aim(last.x, last.y) });

      function aim(x: number, y: number) {
        const hit = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-layer-id]");
        const hitId = hit && wrapper.current?.contains(hit) ? (hit.dataset.layerId as string) : null;
        const index = hitId === null ? undefined : indexOf.get(hitId);
        const over = index === undefined ? undefined : current[index];
        if (!hit || !over || index === undefined) {
          target = null;
          hideOverlay();
          return;
        }
        const box = hit.getBoundingClientRect();
        const position = dropPosition((y - box.top) / box.height, acceptsChildren(over));
        if (!canDrop(current, blocked, index, position)) {
          target = null;
          hideOverlay();
          return;
        }
        target = { targetId: over.id, position };
        showOverlay(hit, over.level, position);
      }

      const end = () => {
        scroll.stop();
        preview?.remove();
        preview = null;
        hideOverlay();
        actions.endDrag();
        stop.current = null;
      };

      const release = bindDrag(rowEl, event.nativeEvent, {
        threshold: dragThreshold,
        cancelOnEscape: true,
        onStart: () => {
          const chosen = row.selected ? new Set(current.filter((candidate) => candidate.selected && candidate.draggable !== false).map((candidate) => candidate.id)) : new Set([id]);
          moving = topmostIds(current, chosen);
          blocked = blockedIndexes(current, moving);
          indexOf = new Map(current.map((candidate, index) => [candidate.id, index]));
          actions.startDrag(moving);
          preview = bindDragPreview(rowEl, { x: event.clientX, y: event.clientY });
          preview.el.classList.add("opacity-80", "shadow-pin", "rounded-md", "bg-surface");
        },
        onMove: ({ x, y }) => {
          last = { x, y };
          preview?.move(x, y);
          scroll.update(x, y);
          aim(x, y);
        },
        onEnd: (_event, canceled) => {
          const drop = target;
          end();
          if (canceled || !drop) return;
          // The owner may have changed the rows during the drag: only emit what still holds in the rows as they are now.
          const now = latest.current.rows;
          const index = now.findIndex((candidate) => candidate.id === drop.targetId);
          const stillThere = moving.every((movingId) => now.some((candidate) => candidate.id === movingId));
          if (!stillThere || index < 0 || !canDrop(now, blockedIndexes(now, moving), index, drop.position)) return;
          latest.current.onMove({ ids: moving, ...drop });
        },
      });
      stop.current = () => {
        release();
        end();
      };
    },
    [actions, hideOverlay, showOverlay, wrapper],
  );

  return onPointerDown;
}
