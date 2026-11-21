import { useState } from "react";
import { firstPage, newId, type Document, type Op } from "@paprika/core";
import { InlineName } from "./InlineName";
import { cx, ui } from "./ui";

interface Props {
  doc: Document;
  pageId: string | null;
  onOpen(id: string | null): void;
  apply(ops: Op[], label?: string): void;
}

/**
 * Páginas do arquivo. Um documento sem páginas mostra uma "Página 1" implícita; o primeiro "+"
 * a torna real (o conteúdo vai para ela) e cria a segunda, numa única transação.
 */
// "page" and "is-active" stay as hooks for the E2E suite ("layer", "is-selected" and "layer-name" in Layers too).
const pageRow = "page group flex h-6.5 cursor-default items-center rounded-sm py-0 pr-1.5 pl-2";
const pageActive = "is-active bg-accent-soft text-accent-pale";

export function Pages({ doc, pageId, onOpen, apply }: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const pages = firstPage(doc) ? doc.rootIds.map((id) => doc.nodes[id]!).filter((n) => n.type === "page") : [];

  const add = () => {
    const id = newId();
    apply([{ op: "add_page", id }], "criar página");
    onOpen(id);
  };
  return (
    <div className={cx(ui.section, "border-b border-line")}>
      <h2 className={ui.h2}>
        Páginas
        <button className={cx(ui.iconBtn, "float-right")} onClick={add} title="Nova página" aria-label="Nova página" data-testid="add-page">
          +
        </button>
      </h2>
      <ul className="m-0 list-none p-0">
        {pages.length === 0 && (
          <li className={cx(pageRow, pageActive)} title="Workspace sem páginas: o primeiro + cria a página 1 com este conteúdo">
            Página 1
          </li>
        )}
        {pages.map((p) => (
          <li
            key={p.id}
            className={cx(pageRow, p.id === pageId ? pageActive : "hover:bg-panel-2")}
            data-page-id={p.id}
            onClick={() => onOpen(p.id)}
            onDoubleClick={() => setEditing(p.id)}
          >
            {editing === p.id ? (
              <InlineName
                className="min-w-0 flex-1 rounded-[3px] border border-select bg-panel-2 px-1 py-px text-fg"
                label="Nome da página"
                value={p.name}
                onCommit={(name) => apply([{ op: "update", id: p.id, props: { name } }], "renomear página")}
                onDone={() => setEditing(null)}
              />
            ) : (
              <span className="flex-1 truncate">{p.name || p.id}</span>
            )}
            {pages.length > 1 && editing !== p.id && (
              <button
                className={cx(ui.iconBtn, "invisible group-hover:visible")}
                aria-label={`Apagar página ${p.name || p.id}`}
                title="Apagar página (desfazer com Ctrl+Z)"
                onClick={(e) => {
                  e.stopPropagation();
                  apply([{ op: "delete", id: p.id }], "apagar página");
                  if (p.id === pageId) onOpen(null);
                }}
              >
                ×
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
