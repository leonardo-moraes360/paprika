import { useState } from "react";
import { Plus, X } from "lucide-react";
import { firstPage, newId, type Document, type Op } from "@paprika/core";
import { Button } from "./components/ui/button";
import { Hint } from "./components/ui/tooltip";
import { InlineName } from "./InlineName";
import { pageNameFor, useT } from "./i18n";
import { cn } from "./lib/cn";

interface Props {
  doc: Document;
  pageId: string | null;
  onOpen(id: string | null): void;
  apply(ops: Op[], label?: string): void;
}

const pageRow = "page group flex h-6.5 cursor-default items-center rounded-sm py-0 pr-1.5 pl-2";
const pageActive = "is-active bg-accent-soft text-accent-pale";
const placeholder = "placeholder";

export function Pages({ doc, pageId, onOpen, apply }: Props) {
  const m = useT();
  const [editing, setEditing] = useState<string | null>(null);
  const pages = firstPage(doc) ? doc.rootIds.map((id) => doc.nodes[id]!).filter((n) => n.type === "page") : [];
  const firstLabel = pageNameFor(1);

  const add = () => {
    const id = newId();
    const count = pages.length;
    const name = pageNameFor(count === 0 && doc.rootIds.length ? 2 : count + 1);
    const firstName = count === 0 && doc.rootIds.length ? pageNameFor(1) : undefined;
    apply([{ op: "add_page", id, name, ...(firstName ? { firstName } : {}) }], m.createPageLabel);
    onOpen(id);
  };
  const adopt = (name: string) => {
    const id = newId();
    apply(
      [
        { op: "create", parentId: null, index: 0, node: { type: "page", id, name } },
        ...doc.rootIds.map((r): Op => ({ op: "move", id: r, parentId: id })),
      ],
      m.renamePageLabel,
    );
    onOpen(id);
  };
  return (
    <div className="flex flex-col gap-1 border-b border-ui-border p-2">
      <h2 className="mx-0 mt-0 mb-1 text-xs font-bold uppercase tracking-[0.06em] text-ui-muted-foreground">
        {m.pages}
        <Hint label={m.newPage}>
          <Button
            variant="ghost"
            size="icon"
            className="float-right size-5 text-ui-muted-foreground hover:bg-ui-secondary hover:text-ui-foreground"
            onClick={add}
            aria-label={m.newPage}
            data-testid="add-page"
          >
            <Plus size={14} aria-hidden />
          </Button>
        </Hint>
      </h2>
      <ul className="m-0 list-none p-0" aria-label={m.pages}>
        {pages.length === 0 && (
          <li className={cn(pageRow, pageActive)} onDoubleClick={() => setEditing(placeholder)}>
            {editing === placeholder ? (
              <InlineName
                className="min-w-0 flex-1 px-1 py-px"
                label={m.pageName}
                value={firstLabel}
                onCommit={adopt}
                onDone={() => setEditing(null)}
              />
            ) : (
              <Hint label={m.pagesPlaceholderHint}>
                <button
                  type="button"
                  className="min-w-0 flex-1 cursor-default truncate border-0 bg-transparent p-0 text-left"
                  onKeyDown={(e) => {
                    if (e.key !== "F2") return;
                    e.preventDefault();
                    setEditing(placeholder);
                  }}
                >
                  {firstLabel}
                </button>
              </Hint>
            )}
          </li>
        )}
        {pages.map((p) => (
          <li
            key={p.id}
            className={cn(pageRow, p.id === pageId ? pageActive : "hover:bg-ui-secondary")}
            data-page-id={p.id}
            onClick={() => onOpen(p.id)}
            onDoubleClick={() => setEditing(p.id)}
          >
            {editing === p.id ? (
              <InlineName
                className="min-w-0 flex-1 px-1 py-px"
                label={m.pageName}
                value={p.name}
                onCommit={(name) => apply([{ op: "update", id: p.id, props: { name } }], m.renamePageLabel)}
                onDone={() => setEditing(null)}
              />
            ) : (
              <Hint label={m.renamePageHint}>
                <button
                  type="button"
                  className="min-w-0 flex-1 cursor-default truncate border-0 bg-transparent p-0 text-left"
                  aria-current={p.id === pageId ? "page" : undefined}
                  onKeyDown={(e) => {
                    if (e.key !== "F2") return;
                    e.preventDefault();
                    setEditing(p.id);
                  }}
                >
                  {p.name || p.id}
                </button>
              </Hint>
            )}
            {pages.length > 1 && editing !== p.id && (
              <Hint label={m.deletePageHint}>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-5 opacity-0 text-ui-muted-foreground group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-ui-secondary hover:text-ui-foreground"
                  aria-label={m.deletePageAria(p.name || p.id)}
                  onClick={(e) => {
                    e.stopPropagation();
                    apply([{ op: "delete", id: p.id }], m.deletePageLabel);
                    if (p.id === pageId) onOpen(null);
                  }}
                >
                  <X size={13} aria-hidden />
                </Button>
              </Hint>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
