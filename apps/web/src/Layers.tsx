import { useState } from "react";
import { ChevronDown, ChevronRight, Circle, Component, Diamond, Eye, EyeOff, File, Frame, Group, Image, MoveUpRight, PenTool, RectangleHorizontal, Square, Type, type LucideIcon } from "lucide-react";
import { isContainer, isInstance, pageRoots, type ConnectorEnd, type Document, type Node, type Op } from "@paprika/core";
import { InlineName } from "./InlineName";
import { cx, ui } from "./ui";

const ICON: Record<string, LucideIcon> = { frame: Frame, rect: RectangleHorizontal, ellipse: Circle, text: Type, image: Image, path: PenTool, group: Group, page: File, shape: Square, connector: MoveUpRight };

/** Lucide icon of a layer row: component, instance or the node type. */
function layerIcon(n: Node): LucideIcon {
  if (n.type === "frame" && n.component) return Component;
  if (isInstance(n)) return Diamond;
  return ICON[n.type] ?? Square;
}

/** Camada sem nome: o texto (texto e forma), "A → B" (conector) ou o tipo. */
function layerFallback(doc: Document, n: Node): string {
  if (n.type === "text" || (n.type === "shape" && n.text)) return n.text.slice(0, 24);
  if (n.type === "connector") {
    const end = (e: ConnectorEnd) => {
      const t = e.nodeId ? doc.nodes[e.nodeId] : undefined;
      return t ? t.name || (t.type === "shape" || t.type === "text" ? t.text.slice(0, 12) : t.id) : "•";
    };
    return `${end(n.from)} → ${end(n.to)}`;
  }
  return n.type;
}

/** Expand/collapse and show/hide glyphs of a layer row. */
const glyphBtn = "inline-flex w-4 cursor-pointer items-center justify-center border-0 bg-transparent p-0 text-muted";

interface Props {
  doc: Document;
  pageId: string | null;
  selected: string[];
  onSelect(ids: string[]): void;
  apply(ops: Op[], label?: string): void;
}

export function Layers({ doc, pageId, selected, onSelect, apply }: Props) {
  const roots = pageRoots(doc, pageId);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const toggle = (id: string) =>
    setCollapsed((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  // Selection from a click or from Enter/Space, same modifier behaviour in both.
  const selectFrom = (e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }, id: string) =>
    onSelect(e.shiftKey || e.metaKey || e.ctrlKey ? (selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]) : [id]);

  const row = (id: string, depth: number): React.ReactNode => {
    const n = doc.nodes[id];
    if (!n || n.type === "page") return null;
    const kids = isContainer(n) ? n.children : [];
    const open = !collapsed.has(id);
    const TypeIcon = layerIcon(n);
    return (
      <li key={id} role="none">
        <div
          className={cx(
            "layer group flex h-6.5 cursor-default items-center gap-1 rounded-sm pr-1.5",
            selected.includes(id) ? "is-selected bg-accent-soft text-accent-pale" : "hover:bg-panel-2",
            !n.visible && "is-hidden",
          )}
          style={{ paddingLeft: 8 + depth * 14 }}
          // S6848: the row is a control, not a plain div. As a treeitem it is reachable by Tab,
          // announces what is selected and expanded, and answers Enter/Space like a click does.
          role="treeitem"
          aria-selected={selected.includes(id)}
          aria-expanded={kids.length > 0 ? open : undefined}
          tabIndex={editing === id ? -1 : 0}
          onClick={(e) => selectFrom(e, id)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" && e.key !== " ") return;
            if (e.key === " ") e.preventDefault(); // Space would scroll the panel instead
            selectFrom(e, id);
          }}
          data-layer-id={id}
        >
          <button
            className={glyphBtn}
            aria-label={open ? "Recolher" : "Expandir"}
            style={{ visibility: kids.length ? "visible" : "hidden" }}
            onClick={(e) => {
              e.stopPropagation();
              toggle(id);
            }}
          >
            {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
          <TypeIcon className="w-4 shrink-0 text-muted" size={13} aria-hidden />
          {editing === id ? (
            <InlineName
              className={cx(ui.renameInput, "h-5 flex-1")}
              label="Nome da camada"
              value={n.name}
              onCommit={(name) => apply([{ op: "update", id, props: { name } }], "renomear camada")}
              onDone={() => setEditing(null)}
            />
          ) : (
            <span
              className={cx("layer-name flex-1 truncate", !n.visible && "opacity-45")}
              // Cópias de instância não aceitam nome próprio: o nome vem do componente.
              title={n.sourceId === undefined ? "Duplo clique para renomear" : undefined}
              onDoubleClick={(e) => {
                if (n.sourceId !== undefined) return;
                e.stopPropagation();
                setEditing(id);
              }}
            >
              {n.name || layerFallback(doc, n)}
            </span>
          )}
          <button
            className={cx(glyphBtn, n.visible ? "opacity-0 group-hover:opacity-100" : "opacity-100")}
            aria-label={n.visible ? "Ocultar" : "Mostrar"}
            onClick={(e) => {
              e.stopPropagation();
              apply([{ op: "update", id, props: { visible: !n.visible } }], n.visible ? "ocultar" : "mostrar");
            }}
          >
            {n.visible ? <Eye size={13} /> : <EyeOff size={13} />}
          </button>
        </div>
        {kids.length > 0 && open && <ul role="group">{kids.map((c) => row(c, depth + 1))}</ul>}
      </li>
    );
  };

  return (
    <div className={ui.section}>
      <h2 className={ui.h2}>Camadas</h2>
      {roots.length === 0 ? (
        <p className={ui.muted}>Vazio. Desenhe um frame (F) ou peça a um agente via MCP.</p>
      ) : (
        <ul className="m-0 list-none p-0 [&_ul]:m-0 [&_ul]:list-none [&_ul]:p-0" role="tree" aria-label="Camadas">{roots.map((id) => row(id, 0))}</ul>
      )}
    </div>
  );
}
