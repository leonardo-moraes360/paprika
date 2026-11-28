import { useLayoutEffect, useRef } from "react";
import { useCanvasState } from "../region";
import { useCanvasRuntime } from "../runtime";
import { placeBox } from "./place";
import { ring, tinted } from "./stroke";
import { useDocVersion } from "./use-doc-version";

const HOVER = ring(1, tinted("--color-select-brand", 70));

/** The outline of the node under the pointer (or the one hovered in the layers panel), unless it is selected already. */
export function HoverOutline() {
  const rt = useCanvasRuntime();
  const id = useCanvasState((s) => (s.hoveredId !== null && !s.selected.has(s.hoveredId) ? s.hoveredId : null));
  const preview = useCanvasState((s) => (id === null ? undefined : s.preview[id]));
  const docVersion = useDocVersion();
  const el = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    placeBox(el.current, id === null ? null : rt.measure(id));
  }, [rt, id, preview, docVersion]);
  if (id === null) return null;
  return <div ref={el} data-hover-outline={id} className="pointer-events-none absolute hidden" style={{ ...HOVER, transformOrigin: "center" }} />;
}
