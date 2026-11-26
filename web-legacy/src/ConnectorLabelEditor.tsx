import { useLayoutEffect, useRef } from "react";
import { connectorLabelAttrs, connectorMidpoint, type ConnectorNode, type Document } from "@paprika/core";

const WIDTH = 120;
const HEIGHT = 24;

export function ConnectorLabelEditor({ doc, node, onCommit, onDone }: { doc: Document; node: ConnectorNode; onCommit(text: string): void; onDone(): void }) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);
  const at = connectorMidpoint(node.d);
  const look = connectorLabelAttrs(doc, { ...node, label: node.label || " " });
  if (!at || !look) return null;
  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    const value = ref.current?.value ?? "";
    if (commit && value.trim() !== (node.label ?? "")) onCommit(value);
    onDone();
  };
  return (
    <foreignObject x={at.x - WIDTH / 2} y={at.y - HEIGHT / 2} width={WIDTH} height={HEIGHT} style={{ pointerEvents: "auto", overflow: "visible" }}>
      <input
        ref={ref}
        className="m-0 box-border size-full rounded-[3px] border border-select px-1 text-center outline-none"
        style={{ background: look.stroke, color: look.fill, fontFamily: look.fontFamily, fontSize: look.fontSize, fontWeight: look.fontWeight }}
        data-testid="connector-label-editor"
        aria-label="Rótulo da seta"
        defaultValue={node.label ?? ""}
        onPointerDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onBlur={() => finish(true)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") {
            e.preventDefault();
            finish(true);
          } else if (e.key === "Escape") {
            e.preventDefault();
            finish(false);
          }
        }}
      />
    </foreignObject>
  );
}
