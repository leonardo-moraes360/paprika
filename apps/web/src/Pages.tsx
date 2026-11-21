import { useState } from "react";
import { firstPage, newId, type Document, type Op } from "@paprika/core";
import { InlineName } from "./InlineName";

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
export function Pages({ doc, pageId, onOpen, apply }: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const pages = firstPage(doc) ? doc.rootIds.map((id) => doc.nodes[id]!).filter((n) => n.type === "page") : [];

  const add = () => {
    const id = newId();
    apply([{ op: "add_page", id }], "criar página");
    onOpen(id);
  };
  return (
    <div className="panel-section pages">
      <h2>
        Páginas
        <button className="icon-btn" onClick={add} title="Nova página" aria-label="Nova página" data-testid="add-page">
          +
        </button>
      </h2>
      <ul className="page-list">
        {pages.length === 0 && (
          <li className="page is-active" title="Documento sem páginas: o primeiro + cria a página 1 com este conteúdo">
            Página 1
          </li>
        )}
        {pages.map((p) => (
          <li
            key={p.id}
            className={`page${p.id === pageId ? " is-active" : ""}`}
            data-page-id={p.id}
            onClick={() => onOpen(p.id)}
            onDoubleClick={() => setEditing(p.id)}
          >
            {editing === p.id ? (
              <InlineName
                label="Nome da página"
                value={p.name}
                onCommit={(name) => apply([{ op: "update", id: p.id, props: { name } }], "renomear página")}
                onDone={() => setEditing(null)}
              />
            ) : (
              <span className="page-name">{p.name || p.id}</span>
            )}
            {pages.length > 1 && editing !== p.id && (
              <button
                className="icon-btn page-delete"
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
