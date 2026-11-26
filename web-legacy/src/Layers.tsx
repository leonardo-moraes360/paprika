import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { defaultRangeExtractor, useVirtualizer, type Range } from "@tanstack/react-virtual";
import { ChevronDown, ChevronRight, Circle, Component, Diamond, Eye, EyeOff, File, Frame, Group, Image, Lock, LockOpen, MoveUpRight, PenTool, RectangleHorizontal, Square, Type, type LucideIcon } from "lucide-react";
import { copyOwner, isContainer, isInstance, isScene, pageRoots, revealOps, type ConnectorEnd, type Document, type Node, type Op } from "@paprika/core";
import { Button } from "./components/ui/button";
import { Hint } from "./components/ui/tooltip";
import { InlineName } from "./InlineName";
import { useT } from "./i18n";
import { cn } from "./lib/cn";

const ICON: Record<string, LucideIcon> = { frame: Frame, rect: RectangleHorizontal, ellipse: Circle, text: Type, image: Image, path: PenTool, group: Group, page: File, shape: Square, connector: MoveUpRight };

export function layerIcon(n: Node): LucideIcon {
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

export function layerLabel(doc: Document, n: Node): string {
  return n.name || layerFallback(doc, n);
}

function isUnder(doc: Document, id: string, ancestor: string): boolean {
  for (let p = doc.nodes[id]?.parentId; p; p = doc.nodes[p]?.parentId ?? null) if (p === ancestor) return true;
  return false;
}

type DropPlace = { parentId: string | null; index: number };

interface FlatRow {
  id: string;
  depth: number;
  pos: number;
  size: number;
  kids: number;
}

const ROW_HEIGHT = 26;
const OVERSCAN = 12;

function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if (o === "auto" || o === "scroll") return p;
  }
  return null;
}

function flatten(doc: Document, roots: string[], collapsed: Set<string>): FlatRow[] {
  const out: FlatRow[] = [];
  const walk = (ids: string[], depth: number) => {
    const shown = ids.filter((id) => {
      const n = doc.nodes[id];
      return n && n.type !== "page";
    });
    shown.forEach((id, i) => {
      const n = doc.nodes[id]!;
      const kids = isContainer(n) ? n.children.length : 0;
      out.push({ id, depth, pos: i + 1, size: shown.length, kids });
      if (kids > 0 && !collapsed.has(id)) walk((n as { children: string[] }).children, depth + 1);
    });
  };
  walk(roots, 0);
  return out;
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
  const [dragging, setDragging] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ overId: string; where: "before" | "after" | "into" } | null>(null);
  const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  const listRef = useRef<HTMLUListElement | null>(null);
  const pinned = useRef<{ editing: string | null; dragging: string | null }>({ editing: null, dragging: null });
  const rows = useMemo(() => flatten(doc, roots, collapsed), [doc, roots, collapsed]);
  const indexOf = useMemo(() => new Map(rows.map((r, i) => [r.id, i])), [rows]);
  pinned.current = { editing, dragging };
  const idsRef = useRef<{ rows: FlatRow[]; indexOf: Map<string, number> }>({ rows, indexOf });
  idsRef.current = { rows, indexOf };
  const rangeExtractor = useCallback((range: Range) => {
    const base = defaultRangeExtractor(range);
    const { rows: rs, indexOf: at } = idsRef.current;
    const active = document.activeElement;
    const focused = active && listRef.current?.contains(active) ? (active.closest<HTMLElement>("[data-layer-id]")?.dataset.layerId ?? null) : null;
    const keep = [focused, pinned.current.editing, pinned.current.dragging];
    const extra = keep.map((id) => (id ? at.get(id) : undefined)).filter((i): i is number => i !== undefined && i < rs.length && !base.includes(i));
    return extra.length ? [...base, ...extra].sort((a, b) => a - b) : base;
  }, []);
  const virtual = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollEl,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
    scrollMargin,
    getItemKey: (i) => rows[i]?.id ?? i,
    rangeExtractor,
  });
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list || !scrollEl) return;
    const margin = list.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top + scrollEl.scrollTop;
    setScrollMargin((m) => (Math.abs(m - margin) < 0.5 ? m : margin));
  });
  const tabStops = (el: HTMLElement) => [el, ...el.querySelectorAll<HTMLElement>("button")].filter((b) => b.tabIndex >= 0 && getComputedStyle(b).visibility !== "hidden");
  const focusRow = (id: string, last: boolean, tries = 8) => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-layer-id="${CSS.escape(id)}"]`);
    if (el) {
      const stops = tabStops(el);
      (last ? stops[stops.length - 1]! : el).focus();
      return;
    }
    if (tries > 0) requestAnimationFrame(() => focusRow(id, last, tries - 1));
  };
  const onTreeKeyDown = (e: React.KeyboardEvent<HTMLUListElement>) => {
    if (e.key !== "Tab" || e.altKey || e.ctrlKey || e.metaKey) return;
    const rowEl = (e.target as HTMLElement).closest<HTMLElement>("[data-layer-id]");
    if (!rowEl) return;
    const index = indexOf.get(rowEl.dataset.layerId!);
    if (index === undefined) return;
    const stops = tabStops(rowEl);
    const step = e.shiftKey ? -1 : 1;
    if (e.target !== (step === 1 ? stops[stops.length - 1] : rowEl)) return;
    const next = rows[index + step];
    if (!next) return;
    e.preventDefault();
    virtual.scrollToIndex(index + step, { align: "auto" });
    focusRow(next.id, step === -1);
  };
  const selectedKey = selected.join(",");
  useEffect(() => {
    const own = fromList.current === selectedKey;
    fromList.current = null;
    if (own || !scrollEl || selected.length === 0) return;
    const at = indexOf.get(selected[selected.length - 1]!);
    if (at === undefined) return;
    virtual.scrollToIndex(at, { align: "auto" });
  }, [selectedKey, scrollEl]);
  const toggle = (id: string) =>
    setCollapsed((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const fromList = useRef<string | null>(null);
  const pick = (ids: string[]) => {
    fromList.current = ids.join(",");
    onSelect(ids);
  };
  const selectFrom = (e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }, id: string) =>
    pick(e.shiftKey || e.metaKey || e.ctrlKey ? (selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]) : [id]);

  const resolvePlace = (overId: string, where: "before" | "after" | "into"): DropPlace | null => {
    if (!dragging || dragging === overId || isUnder(doc, overId, dragging)) return null;
    const over = doc.nodes[overId];
    if (!over) return null;
    if (where === "into") {
      if (!isContainer(over) || over.type === "page" || isInstance(over) || copyOwner(doc, over)) return null;
      return { parentId: overId, index: over.children.length };
    }
    const parentId = over.parentId;
    if (parentId) {
      const parent = doc.nodes[parentId];
      if (parent && (isInstance(parent) || copyOwner(doc, parent))) return null;
    }
    const siblings = parentId ? (isContainer(doc.nodes[parentId]) ? doc.nodes[parentId]!.children : []) : roots;
    const at = siblings.indexOf(overId);
    if (at < 0) return null;
    return { parentId: parentId === pageId ? pageId : parentId, index: where === "before" ? at : at + 1 };
  };

  const onDropRow = (overId: string, where: "before" | "after" | "into") => {
    const place = resolvePlace(overId, where);
    setDrop(null);
    setDragging(null);
    if (!place || !dragging) return;
    const node = doc.nodes[dragging];
    if (!node || !isScene(node) || node.locked || copyOwner(doc, node)) return;
    const fromParent = node.parentId;
    const fromSiblings = fromParent ? (isContainer(doc.nodes[fromParent]) ? doc.nodes[fromParent]!.children : []) : roots;
    const fromIndex = fromSiblings.indexOf(dragging);
    let index = place.index;
    if (fromParent === place.parentId && fromIndex >= 0 && fromIndex < index) index -= 1;
    if (fromParent === place.parentId && fromIndex === index) return;
    apply([{ op: "move", id: dragging, parentId: place.parentId, index }], fromParent === place.parentId ? "reordenar camada" : "reparentear camada");
  };

  const row = ({ id, depth, pos, size }: FlatRow, start: number, index: number): React.ReactNode => {
    const n = doc.nodes[id];
    if (!n || n.type === "page") return null;
    const kids = isContainer(n) ? n.children : [];
    const open = !collapsed.has(id);
    const TypeIcon = layerIcon(n);
    const canDrag = n.sourceId === undefined && !n.locked && !copyOwner(doc, n) && n.type !== "connector";
    const dropHere = drop?.overId === id ? drop.where : null;
    return (
      <li key={id} role="none" className="absolute top-0 left-0 w-full" style={{ height: ROW_HEIGHT, transform: `translateY(${start - scrollMargin}px)` }}>
        <div
          className={cn(
            "layer group relative flex h-6.5 cursor-default items-center gap-1 rounded-sm pr-1.5",
            selected.includes(id) ? "is-selected bg-accent-soft text-accent-pale" : "hover:bg-ui-secondary",
            !n.visible && "is-hidden",
            dragging === id && "opacity-45",
            dropHere === "into" && "ring-1 ring-select",
          )}
          style={{ paddingLeft: 8 + depth * 14 }}
          role="treeitem"
          aria-level={depth + 1}
          aria-posinset={pos}
          aria-setsize={size}
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
          draggable={canDrag && editing !== id}
          onDragStart={(e) => {
            if (!canDrag) return;
            e.dataTransfer.setData("text/paprika-layer", id);
            e.dataTransfer.effectAllowed = "move";
            setDragging(id);
            if (!selected.includes(id)) pick([id]);
          }}
          onDragEnd={() => {
            setDragging(null);
            setDrop(null);
          }}
          onDragOver={(e) => {
            if (!dragging || dragging === id) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            const rect = e.currentTarget.getBoundingClientRect();
            const y = e.clientY - rect.top;
            const into = isContainer(n) && !isInstance(n) && !copyOwner(doc, n) && y > rect.height * 0.28 && y < rect.height * 0.72;
            const where: "before" | "after" | "into" = into ? "into" : y < rect.height / 2 ? "before" : "after";
            if (!resolvePlace(id, where)) return;
            setDrop({ overId: id, where });
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as globalThis.Node)) setDrop((d) => (d?.overId === id ? null : d));
          }}
          onDrop={(e) => {
            e.preventDefault();
            const where = drop?.overId === id ? drop.where : "after";
            onDropRow(id, where);
          }}
        >
          {dropHere === "before" && <span className="pointer-events-none absolute inset-x-1 top-0 h-0.5 rounded-sm bg-select" data-testid="layer-drop-marker" />}
          {dropHere === "after" && <span className="pointer-events-none absolute inset-x-1 bottom-0 h-0.5 rounded-sm bg-select" data-testid="layer-drop-marker" />}
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
          {!copyOwner(doc, n) && (
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "inline-flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-sm border-0 bg-transparent p-0 hover:bg-transparent",
                n.locked ? "text-ui-destructive opacity-100" : "text-ui-muted-foreground opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 hover:text-ui-foreground",
              )}
              aria-label={(n.locked ? m.unlockLayer : m.lockLayer)(n.name || layerFallback(doc, n))}
              tabIndex={-1}
              data-testid="layer-lock"
              onClick={(e) => {
                e.stopPropagation();
                apply([{ op: "update", id, props: { locked: !n.locked } }], n.locked ? "destravar" : "travar");
              }}
            >
              {n.locked ? <Lock size={13} aria-hidden /> : <LockOpen size={13} aria-hidden />}
            </Button>
          )}
        </div>
      </li>
    );
  };

  const flags = { hidden: 0, locked: 0 };
  const tally = (id: string) => {
    const n = doc.nodes[id];
    if (!n || n.type === "page") return;
    if (!n.visible) flags.hidden += 1;
    if (n.locked && !copyOwner(doc, n)) flags.locked += 1;
    if (isContainer(n)) n.children.forEach(tally);
  };
  roots.forEach(tally);
  const reveal = (kind: "hidden" | "locked") => {
    const page = pageId ?? undefined;
    if (!revealOps(doc, kind, page).ops.length) return;
    apply([{ op: "reveal", kind, ...(page ? { pageId: page } : {}) }], kind === "hidden" ? "mostrar todos" : "destravar todos");
  };

  return (
    <div className="flex flex-col gap-1 p-2">
      <div className="mb-1 flex items-center justify-between gap-1">
        <h2 className="mx-0 my-0 text-xs font-bold uppercase tracking-[0.06em] text-ui-muted-foreground">{m.layers}</h2>
        <div className="flex gap-0.5">
          <Hint label={m.showAll}>
            <Button type="button" variant="ghost" size="icon" className="size-6" aria-label={m.showAll} data-testid="show-all" disabled={flags.hidden === 0} onClick={() => reveal("hidden")}>
              <Eye aria-hidden />
            </Button>
          </Hint>
          <Hint label={m.unlockAll}>
            <Button type="button" variant="ghost" size="icon" className="size-6" aria-label={m.unlockAll} data-testid="unlock-all" disabled={flags.locked === 0} onClick={() => reveal("locked")}>
              <LockOpen aria-hidden />
            </Button>
          </Hint>
        </div>
      </div>
      {roots.length === 0 ? (
        <p className="text-ui-muted-foreground">Vazio. Desenhe um frame (F) ou peça a um agente via MCP.</p>
      ) : (
        <ul ref={(el) => {
            listRef.current = el;
            setScrollEl((cur) => (el ? (cur ?? scrollParent(el)) : cur));
          }} className="relative m-0 list-none p-0" style={{ height: virtual.getTotalSize() }} role="tree" aria-label={m.layers} onKeyDown={onTreeKeyDown}>
          {virtual.getVirtualItems().map((v) => row(rows[v.index]!, v.start, v.index))}
        </ul>
      )}
    </div>
  );
}
