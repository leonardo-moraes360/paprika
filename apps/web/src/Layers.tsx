import { useState } from "react";
import type { Document, Op } from "@paprika/core";

const ICON: Record<string, string> = { frame: "#", rect: "▭", ellipse: "◯", text: "T", image: "▣", path: "✒" };

interface Props {
  doc: Document;
  selected: string | null;
  onSelect(id: string): void;
  apply(ops: Op[], label?: string): void;
}

export function Layers({ doc, selected, onSelect, apply }: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setCollapsed((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const row = (id: string, depth: number): React.ReactNode => {
    const n = doc.nodes[id];
    if (!n) return null;
    const kids = n.type === "frame" ? n.children : [];
    const open = !collapsed.has(id);
    return (
      <li key={id}>
        <div
          className={`layer${selected === id ? " is-selected" : ""}${n.visible ? "" : " is-hidden"}`}
          style={{ paddingLeft: 8 + depth * 14 }}
          onClick={() => onSelect(id)}
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
          <span className="layer-icon">{ICON[n.type]}</span>
          <span className="layer-name">{n.name || (n.type === "text" ? n.text.slice(0, 24) : n.type)}</span>
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
      {doc.rootIds.length === 0 ? (
        <p className="muted">Vazio. Desenhe um frame (F) ou peça a um agente via MCP.</p>
      ) : (
        <ul className="layers">{doc.rootIds.map((id) => row(id, 0))}</ul>
      )}
    </div>
  );
}
