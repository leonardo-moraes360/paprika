import type { Node } from "@paprika/core";
import { memo, useCallback, useSyncExternalStore } from "react";
import { useCanvasState } from "../region";
import { useCanvasRuntime } from "../runtime";

type FrameNode = Extract<Node, { type: "frame" }>;

/** Where the label goes: the top-left of the frame, or of its bounding box when it is turned. */
function anchorOf(node: FrameNode, x: number, y: number, width: unknown, height: unknown) {
  if (!node.rotation || typeof width !== "number" || typeof height !== "number") return { x, y };
  const a = (node.rotation * Math.PI) / 180;
  const w = Math.abs(width * Math.cos(a)) + Math.abs(height * Math.sin(a));
  const h = Math.abs(width * Math.sin(a)) + Math.abs(height * Math.cos(a));
  return { x: x + width / 2 - w / 2, y: y + height / 2 - h / 2 };
}

const FrameLabel = memo(function FrameLabel({ id }: { id: string }) {
  const rt = useCanvasRuntime();
  const subscribe = useCallback((listener: () => void) => rt.index.subscribe(id, listener), [rt, id]);
  const read = useCallback(() => rt.index.snapshot(id), [rt, id]);
  const { node } = useSyncExternalStore(subscribe, read, read);
  const patch = useCanvasState((s) => s.preview[id]);
  const selected = useCanvasState((s) => s.selected.has(id));
  if (!node || node.type !== "frame") return null;
  const at = anchorOf(node, patch?.x ?? node.x, patch?.y ?? node.y, patch?.width ?? node.width, patch?.height ?? node.height);
  return (
    <div
      data-frame-label={id}
      data-selected={selected ? "" : undefined}
      className="pointer-events-auto absolute cursor-default text-xs leading-4 font-medium whitespace-nowrap text-label select-none"
      // The layer is scaled by the camera: counter-scaling about the label's own corner keeps its size and its gap to the frame on screen.
      style={{ left: at.x, top: at.y, transformOrigin: "0 0", transform: "scale(calc(1 / var(--view-zoom))) translateY(calc(-100% - 4px))" }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.stopPropagation();
        const additive = event.shiftKey || event.metaKey || event.ctrlKey;
        const have = rt.selection();
        rt.select(additive ? (have.includes(id) ? have.filter((s) => s !== id) : [...have, id]) : [id]);
      }}
    >
      {node.name || node.id}
    </div>
  );
});

/** The name of each root frame above its top-left corner, as in the design (Figma-style). */
export function FrameLabels() {
  const { index } = useCanvasRuntime();
  const roots = useSyncExternalStore(index.subscribeRoots, index.roots, index.roots);
  return (
    <>
      {roots.map((id) => (
        <FrameLabel key={id} id={id} />
      ))}
    </>
  );
}
