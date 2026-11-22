import { useState } from "react";
import { ChevronDown, ChevronRight, Circle, Component, Diamond, Eye, EyeOff, File, Frame, Group, Image, MoveUpRight, PenTool, RectangleHorizontal, Square, Type, type LucideIcon } from "lucide-react";
import { isContainer, isInstance, pageRoots, type ConnectorEnd, type Document, type Node, type Op } from "@paprika/core";
import { Button } from "./components/ui/button";
import { Hint } from "./components/ui/tooltip";
import { InlineName } from "./InlineName";
import { useT } from "./i18n";
import { cn } from "./lib/cn";

const ICON: Record<string, LucideIcon> = { frame: Frame, rect: RectangleHorizontal, ellipse: Circle, text: Type, image: Image, path: PenTool, group: Group, page: File, shape: Square, connector: MoveUpRight };

function layerIcon(n: Node): LucideIcon {
  if (n.type === "frame" && n.component) return Component;
  if (isInstance(n)) return Diamond;
  return ICON[n.type] ?? Square;
}

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

interface Props {
  doc: Document;
  pageId: string | null;
  selected: string[];
  onSelect(ids: string[]): void;
  apply(ops: Op[], label?: string): void;
}

export function Layers({ doc, pageId, selected, onSelect, apply }: Props) {
  const m = useT();
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
          className={cn(
            "layer group flex h-6.5 cursor-default items-center gap-1 rounded-sm pr-1.5",
            selected.includes(id) ? "is-selected bg-accent-soft text-accent-pale" : "hover:bg-ui-secondary",
            !n.visible && "is-hidden",
          )}
          style={{ paddingLeft: 8 + depth * 14 }}
          role="treeitem"
          aria-selected={selected.includes(id)}
          aria-expanded={kids.length > 0 ? open : undefined}
          tabIndex={editing === id ? -1 : 0}
          onClick={(e) => selectFrom(e, id)}
          aria-labelledby={editing === id ? undefined : `layer-name-${id}`}
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget) return;
            if (e.key === "F2" && n.sourceId === undefined) {
              e.preventDefault();
              setEditing(id);
              return;
            }
            if (e.key !== "Enter" && e.key !== " ") return;
            if (e.key === " ") e.preventDefault();
            selectFrom(e, id);
          }}
          data-layer-id={id}
        >
          <Button
            variant="ghost"
            size="icon"
            className="inline-flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-sm border-0 bg-transparent p-0 text-ui-muted-foreground hover:bg-transparent hover:text-ui-foreground"
            aria-label={`${open ? "Recolher" : "Expandir"} ${n.name || layerFallback(doc, n)}`}
            style={{ visibility: kids.length ? "visible" : "hidden" }}
            onClick={(e) => {
              e.stopPropagation();
              toggle(id);
            }}
          >
            {open ? <ChevronDown size={12} aria-hidden /> : <ChevronRight size={12} aria-hidden />}
          </Button>
          <TypeIcon className="w-4 shrink-0 text-ui-muted-foreground" size={13} aria-hidden />
          {editing === id ? (
            <InlineName
              className="h-5 flex-1"
              label={m.layerName}
              value={n.name}
              onCommit={(name) => apply([{ op: "update", id, props: { name } }], "renomear camada")}
              onDone={() => setEditing(null)}
            />
          ) : (
            <Hint label={n.sourceId === undefined ? m.renameLayerHint : undefined}>
              <span
                id={`layer-name-${id}`}
                className={cn("layer-name flex-1 truncate", !n.visible && "opacity-45")}
                onDoubleClick={(e) => {
                  if (n.sourceId !== undefined) return;
                  e.stopPropagation();
                  setEditing(id);
                }}
              >
                {n.name || layerFallback(doc, n)}
              </span>
            </Hint>
          )}
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "inline-flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-sm border-0 bg-transparent p-0 text-ui-muted-foreground hover:bg-transparent hover:text-ui-foreground",
              n.visible ? "opacity-0 group-focus-within:opacity-100 group-hover:opacity-100" : "opacity-100",
            )}
            aria-label={(n.visible ? m.hideLayer : m.showLayer)(n.name || layerFallback(doc, n))}
            onClick={(e) => {
              e.stopPropagation();
              apply([{ op: "update", id, props: { visible: !n.visible } }], n.visible ? "ocultar" : "mostrar");
            }}
          >
            {n.visible ? <Eye size={13} aria-hidden /> : <EyeOff size={13} aria-hidden />}
          </Button>
        </div>
        {kids.length > 0 && open && <ul role="group">{kids.map((c) => row(c, depth + 1))}</ul>}
      </li>
    );
  };

  return (
    <div className="flex flex-col gap-1 p-2">
      <h2 className="mx-0 mt-0 mb-1 text-xs font-bold uppercase tracking-[0.06em] text-ui-muted-foreground">{m.layers}</h2>
      {roots.length === 0 ? (
        <p className="text-ui-muted-foreground">Vazio. Desenhe um frame (F) ou peça a um agente via MCP.</p>
      ) : (
        <ul className="m-0 list-none p-0 [&_ul]:m-0 [&_ul]:list-none [&_ul]:p-0" role="tree" aria-label={m.layers}>
          {roots.map((id) => row(id, 0))}
        </ul>
      )}
    </div>
  );
}
