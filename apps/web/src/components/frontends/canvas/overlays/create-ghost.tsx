import { nodeStyle, shapeAttrs, SHAPE_SVG_CSS, SHAPE_TEXT_CSS } from "@paprika/core";
import type { CSSProperties } from "react";
import { CREATE_KEY, type CreateDraft } from "../gestures/create";
import { ghostDocument, ghostNode } from "../labels";
import { useOverlayValue } from "../overlay-bus";
import { useCanvasState } from "../region";
import { useCanvasRuntime } from "../runtime";
import { dashedRing } from "./stroke";

const DRAG_EDGE = dashedRing(1, "var(--color-select-brand)");

const GHOST_OPACITY = 0.45;
/** At least this much (in both directions) is a drag: the rectangle of the drag shows. */
const DRAG_SIZE = 4;

/**
 * What a creation tool is about to make, drawn over the page while the pointer is down: the node itself, faint, at the size
 * the release would give it, and the dashed box of the drag. It reads only the draft the gesture writes (one store slot), so
 * moving the pointer renders this and nothing else, and nothing is sent until release.
 */
export function CreateGhost() {
  const rt = useCanvasRuntime();
  const draft = useOverlayValue<CreateDraft>(CREATE_KEY);
  const tool = useCanvasState((s) => s.tool);
  // The tool changed in the middle of the drag (Escape, a key): the gesture is called off, and so is what it showed.
  if (!draft || draft.tool !== tool) return null;
  const { x, y, width, height, origin, clicked } = draft;
  const doc = rt.doc();
  const node = ghostNode(tool, width, height, rt.defaults());
  const ghostDoc = ghostDocument(doc, node);
  const css = nodeStyle(ghostDoc, node, { asRoot: true }) as CSSProperties;
  const shape = node.type === "shape" ? shapeAttrs(ghostDoc, node) : null;
  const left = origin.x + x;
  const top = origin.y + y;
  return (
    <div data-testid="create-ghost" aria-hidden="true">
      {!clicked && width >= DRAG_SIZE && height >= DRAG_SIZE ? (
        <div
          data-testid="create-drag"
          className="pointer-events-none absolute bg-select-brand/10"
          style={{ left, top, width, height, ...DRAG_EDGE }}
        />
      ) : null}
      <div data-testid="draft-ghost" data-ghost-tool={tool} className="pointer-events-none absolute overflow-visible" style={{ left, top, width, height }}>
        <div style={{ ...css, position: "relative", left: 0, top: 0, opacity: GHOST_OPACITY }}>
          {node.type === "text" ? node.text : null}
          {shape && node.type === "shape" ? (
            <>
              <svg xmlns="http://www.w3.org/2000/svg" width={shape.svg.width} height={shape.svg.height} style={SHAPE_SVG_CSS as CSSProperties}>
                {shape.svgInner ? <g dangerouslySetInnerHTML={{ __html: shape.svgInner }} /> : null}
                <path d={shape.path.d} fill={shape.path.fill} stroke={shape.path.stroke} strokeWidth={shape.path.strokeWidth} strokeLinejoin="round" />
                {shape.fold && <path d={shape.fold.d} fill={shape.fold.fill} />}
              </svg>
              <div style={SHAPE_TEXT_CSS as CSSProperties}>{node.text}</div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
