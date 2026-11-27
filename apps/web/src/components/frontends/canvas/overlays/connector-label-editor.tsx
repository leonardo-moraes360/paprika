import { connectorLabelAttrs, connectorMidpoint, type Node } from "@paprika/core";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { TextField } from "@/components/ui/text-field";
import { useCanvasState } from "../region";
import { useCanvasRuntime } from "../runtime";
import { useNode } from "./use-node";

type ConnectorNode = Extract<Node, { type: "connector" }>;

const WIDTH = 120;
const HEIGHT = 24;

/**
 * The label of an arrow: a field centred on the middle of the line, in the label's own look, opened by a double click on the
 * arrow. Enter or leaving it confirms, Escape drops the change; an empty label is removed (`null`). One `apply`, only when it changed.
 */
export function ConnectorLabelEditor() {
  const id = useCanvasState((s) => s.editingId);
  return id ? <ConnectorLabelEditorFor key={id} id={id} /> : null;
}

function ConnectorLabelEditorFor({ id }: { id: string }) {
  const node = useNode(id);
  return node?.type === "connector" ? <LabelSurface node={node} /> : null;
}

function LabelSurface({ node }: { node: ConnectorNode }) {
  const rt = useCanvasRuntime();
  const [initial] = useState(node);
  const shell = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  /** The label the document had last: what the field started from, or what another client wrote since. A change is measured against it. */
  const base = useRef(initial.label ?? "");
  const at = connectorMidpoint(initial.d);
  const look = connectorLabelAttrs(rt.doc(), { ...initial, label: initial.label || " " });

  useLayoutEffect(() => {
    const box = rt.measure(initial.id);
    const el = shell.current;
    if (el && box && at) {
      el.style.left = `${box.x + at.x - WIDTH / 2}px`;
      el.style.top = `${box.y + at.y - HEIGHT / 2}px`;
    }
    field.current?.focus();
    field.current?.select();
  }, [rt, initial, at]);

  // Another client wrote the label while this one is open: a field nobody has touched shows it, one with typing in it keeps what was typed.
  const label = node.label ?? "";
  useEffect(() => {
    const el = field.current;
    const last = base.current;
    if (!el || done.current || label === last) return;
    base.current = label;
    if (el.value !== last) return;
    const { selectionStart, selectionEnd } = el;
    el.value = label;
    el.setSelectionRange(Math.min(selectionStart ?? label.length, label.length), Math.min(selectionEnd ?? label.length, label.length));
  }, [label]);

  const finish = (commit: boolean, refocus: boolean) => {
    if (done.current) return;
    done.current = true;
    const value = field.current?.value ?? "";
    if (commit && value.trim() !== base.current) {
      void rt.apply([{ op: "update", id: initial.id, props: { label: value.trim() ? value.trim() : null } }], rt.text("history.editLabel"));
    }
    rt.store.actions.setEditing(null);
    if (refocus) rt.viewport()?.focus({ preventScroll: true });
  };

  if (!at || !look) return null;
  return (
    <div ref={shell} className="pointer-events-none absolute" style={{ width: WIDTH, height: HEIGHT }}>
      <TextField
        ref={field}
        data-testid="connector-label-editor"
        aria-label={rt.text("editors.connectorLabel")}
        defaultValue={initial.label ?? ""}
        className="pointer-events-auto box-border h-full w-full rounded-xs border-select px-1 text-center outline-none"
        // The label keeps the look of the arrow's own label (its colour over its halo): both are the document's.
        style={{ background: look.stroke, color: look.fill, fontFamily: look.fontFamily, fontSize: look.fontSize, fontWeight: look.fontWeight }}
        onPointerDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onBlur={() => finish(true, false)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") {
            e.preventDefault();
            finish(true, true);
          } else if (e.key === "Escape") {
            e.preventDefault();
            finish(false, true);
          }
        }}
      />
    </div>
  );
}
