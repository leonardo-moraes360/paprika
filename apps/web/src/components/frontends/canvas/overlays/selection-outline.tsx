import { useLayoutEffect, useRef } from "react";
import { unionBox } from "../geometry";
import { useCanvasState } from "../region";
import { useCanvasRuntime } from "../runtime";
import type { NodeBox } from "../types";
import { placeBox } from "./place";
import { useDocVersion } from "./use-doc-version";

const stroke = (width: number) => ({ borderWidth: `calc(${width}px / var(--view-zoom))` });

/**
 * The outline of the selection: one box per selected node and, with several, the dashed box around all of them. Boxes are
 * measured from the DOM after each commit that painted something and written to the elements directly, so a node that moves
 * or grows moves its outline in the same frame without a second render, and the camera never touches it (the layer carries it).
 */
export function SelectionOutline() {
  const rt = useCanvasRuntime();
  const selection = useCanvasState((s) => s.selection);
  const preview = useCanvasState((s) => s.preview);
  const docVersion = useDocVersion();
  const nodes = useRef(new Map<string, HTMLElement>());
  const group = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const boxes: NodeBox[] = [];
    for (const id of selection) {
      const box = rt.measure(id);
      placeBox(nodes.current.get(id) ?? null, box);
      if (box) boxes.push(box);
    }
    const all = unionBox(boxes);
    placeBox(group.current, all && boxes.length > 1 ? { ...all, rotation: 0 } : null);
  }, [rt, selection, preview, docVersion]);

  if (selection.length === 0) return null;
  return (
    <div data-testid="selection" data-count={selection.length}>
      {selection.map((id) => (
        <div
          key={id}
          ref={(el) => {
            if (el) nodes.current.set(id, el);
            else nodes.current.delete(id);
          }}
          data-selection-box={id}
          className="pointer-events-none absolute hidden border-select-brand"
          style={{ ...stroke(1.5), transformOrigin: "center" }}
        />
      ))}
      <div ref={group} data-selection-group="" className="pointer-events-none absolute hidden border-select-brand" style={{ ...stroke(1.5), borderStyle: "dashed" }} />
    </div>
  );
}
