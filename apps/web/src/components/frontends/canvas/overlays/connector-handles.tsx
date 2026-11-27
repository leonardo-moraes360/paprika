import { connectorCurveHandle, connectorEndPoints, type ConnectorNode, type Document } from "@paprika/core";
import { useTranslation } from "react-i18next";
import { editableConnector } from "../gestures/connector-edit";
import { linkedPatches, patchedDocument, sameLinked, withPatch } from "../preview-node";
import { useCanvasState } from "../region";
import { useCanvasRuntime } from "../runtime";
import type { LinkUi } from "../vector/ui";
import { UI_LINK } from "../vector/ui";
import { useDocVersion } from "./use-doc-version";

const size = "calc(10px / var(--view-zoom, 1))";
const stroke = (n: number) => ({ strokeWidth: `calc(${n}px / var(--view-zoom, 1))` });

type HandleProps = { kind: "from" | "to" | "curve"; x: number; y: number; label: string };

function Handle({ kind, x, y, label }: HandleProps) {
  return (
    <div
      role="button"
      tabIndex={-1}
      aria-label={label}
      title={label}
      data-connector-handle={kind}
      data-testid={`connector-${kind}-handle`}
      className="pointer-events-auto absolute cursor-grab rounded-full border-select-brand bg-panel active:cursor-grabbing"
      style={{ left: x, top: y, width: size, height: size, borderWidth: "calc(1.5px / var(--view-zoom, 1))", transform: "translate(-50%, -50%)" }}
    />
  );
}

/**
 * The handles of the selected arrow: one on each end (drag to attach it to another node or leave it at a point) and, on a
 * curve, one that bends it. They follow the arrow while it is previewed, so an end that moves shows where it will land.
 */
export function ConnectorHandles() {
  const rt = useCanvasRuntime();
  const { t } = useTranslation();
  const id = useCanvasState((s) => (s.selection.length === 1 ? s.selection[0]! : null));
  const linked = useCanvasState((s) => (id === null ? [] : linkedPatches(s.preview, rt.doc(), rt.doc().nodes[id])), sameLinked);
  useDocVersion();
  const conn = id ? editableConnector(rt) : null;
  if (!conn) return null;
  const doc: Document = linked.length > 0 ? patchedDocument(rt.doc(), linked) : rt.doc();
  const shown = (doc.nodes[conn.id] ?? conn) as ConnectorNode;
  const own = rt.store.state.preview[conn.id];
  const view = own ? withPatch(shown, own) : shown;
  const ends = connectorEndPoints(doc, view);
  const bend = view.route === "curve" ? connectorCurveHandle(doc, view) : null;
  if (!ends) return null;
  return (
    <div data-testid="connector-handles">
      <Handle kind="from" x={ends.from.x} y={ends.from.y} label={t("frontends.canvas.vector.connectorFrom")} />
      <Handle kind="to" x={ends.to.x} y={ends.to.y} label={t("frontends.canvas.vector.connectorTo")} />
      {bend && <Handle kind="curve" x={bend.x} y={bend.y} label={t("frontends.canvas.vector.connectorCurve")} />}
    </div>
  );
}

/** The dashed line of the arrow being drawn with the connector tool. */
export function LinkDraft() {
  const link: LinkUi | null = useCanvasState((s) => (s.ui[UI_LINK] as LinkUi | null | undefined) ?? null);
  if (!link) return null;
  return (
    <svg data-testid="link-draft" aria-hidden="true" className="pointer-events-none absolute top-0 left-0 size-px overflow-visible">
      <line
        x1={link.from.x}
        y1={link.from.y}
        x2={link.to.x}
        y2={link.to.y}
        className="stroke-select-brand"
        style={{ ...stroke(2), strokeDasharray: "calc(5px / var(--view-zoom, 1)) calc(4px / var(--view-zoom, 1))" }}
      />
      <circle r={4} className="fill-select-brand" style={{ transform: `translate(${link.to.x}px, ${link.to.y}px) scale(calc(1 / var(--view-zoom, 1)))` }} />
    </svg>
  );
}
