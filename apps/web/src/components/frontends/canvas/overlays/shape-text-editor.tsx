import { nodeStyle, SHAPE_TEXT_CSS, type Node } from "@paprika/core";
import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { TextArea } from "@/components/ui/text-area";
import { useCanvasState } from "../region";
import { useCanvasRuntime } from "../runtime";
import { confirmKey, editorOutline } from "./editor-chrome";
import { useNode } from "./use-node";

type ShapeNode = Extract<Node, { type: "shape" }>;

/**
 * The text of a diagram shape: a textarea laid over the shape, in the shape's own typography, opened by a double click or right
 * after the shape is drawn. It confirms on Escape, Ctrl or Cmd with Enter, or leaving it, with one `apply` and only when the text changed.
 */
export function ShapeTextEditor() {
  const id = useCanvasState((s) => s.editingId);
  return id ? <ShapeTextEditorFor key={id} id={id} /> : null;
}

function ShapeTextEditorFor({ id }: { id: string }) {
  const node = useNode(id);
  return node?.type === "shape" ? <ShapeSurface node={node} /> : null;
}

function ShapeSurface({ node }: { node: ShapeNode }) {
  const rt = useCanvasRuntime();
  const [initial] = useState(node);
  const shell = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);

  useLayoutEffect(() => {
    const box = rt.measure(initial.id);
    const el = shell.current;
    if (el && box) {
      el.style.left = `${box.x}px`;
      el.style.top = `${box.y}px`;
      el.style.width = `${box.width}px`;
      el.style.height = `${box.height}px`;
      el.style.transform = box.rotation ? `rotate(${box.rotation}deg)` : "";
    }
    field.current?.focus();
    field.current?.select();
  }, [rt, initial]);

  const finish = (refocus: boolean) => {
    if (done.current) return;
    done.current = true;
    const value = field.current?.value ?? initial.text;
    if (value !== initial.text) void rt.apply([{ op: "update", id: initial.id, props: { text: value } }], rt.t("app.canvas.creation.labels.editText"));
    rt.store.actions.setEditing(null);
    if (refocus) rt.viewport()?.focus({ preventScroll: true });
  };

  // The shape's box carries its typography and lays its text out (centred or not); the editor repeats it and paints nothing else.
  const css = { ...nodeStyle(rt.doc(), initial) } as CSSProperties;
  const style: CSSProperties = { ...css, position: "absolute", visibility: "visible", pointerEvents: "none", background: "none", border: "none", boxShadow: "none", outline: "none", filter: "none" };

  return (
    <div ref={shell} data-testid="shape-text-editor-shell" style={style}>
      <div style={SHAPE_TEXT_CSS as CSSProperties}>
        <TextArea
          ref={field}
          data-testid="shape-text-editor"
          aria-label={rt.t("app.canvas.creation.shapeText")}
          defaultValue={initial.text}
          rows={Math.max(1, initial.text.split("\n").length)}
          className={`pointer-events-auto min-h-0 border-0 bg-transparent has-[:focus-visible]:border-0 has-[:focus-visible]:outline-0 outline-1 ${editorOutline}`}
          inputClassName="field-sizing-content min-h-0 w-full resize-none overflow-hidden p-0 text-inherit [font:inherit] [letter-spacing:inherit] [line-height:inherit] [text-align:inherit]"
          onPointerDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          onPaste={(e) => e.stopPropagation()}
          onBlur={() => finish(false)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (confirmKey(e)) {
              e.preventDefault();
              finish(true);
            }
          }}
        />
      </div>
    </div>
  );
}
