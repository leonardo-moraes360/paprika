import { useState } from "react";
import { isContainer, isInstance, pageRoots, type Document, type Op } from "@paprika/core";
import { InlineName } from "./InlineName";

const ICON: Record<string, string> = { frame: "#", rect: "▭", ellipse: "◯", text: "T", image: "▣", path: "✒", group: "⧉", page: "▤" };

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

  const row = (id: string, depth: number): React.ReactNode => {
    const n = doc.nodes[id];
    if (!n || n.type === "page") return null;
    const kids = isContainer(n) ? n.children : [];
    const open = !collapsed.has(id);
    return (
      <li key={id}>
        <div
          className={`layer${selected.includes(id) ? " is-selected" : ""}${n.visible ? "" : " is-hidden"}`}
          style={{ paddingLeft: 8 + depth * 14 }}
          onClick={(e) =>
            onSelect(e.shiftKey || e.metaKey || e.ctrlKey ? (selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]) : [id])
          }
          data-layer-id={id}
        >
          <button
            className="twisty"
            aria-label={open ? "Recolher" : "Expandir"}
            style={{ visibility: kids.length ? "visible" : "hidden" }}
            onClick={(e) => {
              e.stopPropagation();
              toggle(id);
            }}
          >
            {open ? "▾" : "▸"}
          </button>
          <span className="layer-icon">{n.type === "frame" && n.component ? "◆" : isInstance(n) ? "◇" : ICON[n.type]}</span>
          {editing === id ? (
            <InlineName
              className="layer-name-input"
              label="Nome da camada"
              value={n.name}
              onCommit={(name) => apply([{ op: "update", id, props: { name } }], "renomear camada")}
              onDone={() => setEditing(null)}
            />
          ) : (
            <span
              className="layer-name"
              // Cópias de instância não aceitam nome próprio: o nome vem do componente.
              title={n.sourceId === undefined ? "Duplo clique para renomear" : undefined}
              onDoubleClick={(e) => {
                if (n.sourceId !== undefined) return;
                e.stopPropagation();
                setEditing(id);
              }}
            >
              {n.name || (n.type === "text" ? n.text.slice(0, 24) : n.type)}
            </span>
          )}
          <button
            className="eye"
            aria-label={n.visible ? "Ocultar" : "Mostrar"}
            onClick={(e) => {
              e.stopPropagation();
              apply([{ op: "update", id, props: { visible: !n.visible } }], n.visible ? "ocultar" : "mostrar");
            }}
          >
            {n.visible ? "◉" : "○"}
          </button>
        </div>
        {kids.length > 0 && open && <ul>{kids.map((c) => row(c, depth + 1))}</ul>}
      </li>
    );
  };

  return (
    <div className="panel-section">
      <h2>Camadas</h2>
      {roots.length === 0 ? (
        <p className="muted">Vazio. Desenhe um frame (F) ou peça a um agente via MCP.</p>
      ) : (
        <ul className="layers">{roots.map((id) => row(id, 0))}</ul>
      )}
    </div>
  );
}
