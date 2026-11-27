import { createMenuController } from "@ui-sdk/react/menu";
import { useVirtualizer, defaultRangeExtractor, type Range } from "@tanstack/react-virtual";
import { useHotkey } from "@tanstack/react-hotkeys";
import { visibleTreeRows } from "@ui-sdk/react/tree";
import { Ellipsis } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { DragOverlay } from "@/components/ui/drag-overlay";
import { IconButton } from "@/components/ui/icon-button";
import { LayerTree } from "@/components/ui/layer-row";
import { Menu, MenuCheckboxItem, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SectionHeader } from "@/components/ui/section-header";
import { Tooltip } from "@/components/ui/tooltip";
import { booleanCodec } from "@/lib/persist";
import { cn } from "@/lib/utils";
import { usePersistedState } from "@/lib/use-persisted-state";
import { LAYER_ROW_PITCH, LayerItem } from "./layer-item";
import { initialLayersPanelState, LayersPanelRegion } from "./store";
import { buildItems, keyboardMove, sameStrings, sameStructure, type LayerMoveKey } from "./tree-data";
import type { LayerContextItem, LayerRowData, LayerSelectMode, LayersPanelProps } from "./types";
import { useLayerDrag } from "./use-layer-drag";

export function LayersPanel(props: LayersPanelProps) {
  return (
    <LayersPanelRegion.Provider initial={initialLayersPanelState}>
      <LayersPanelView {...props} />
    </LayersPanelRegion.Provider>
  );
}

const noItems: readonly LayerContextItem[] = [];

function selectMode(event: Event | undefined): LayerSelectMode {
  const modifiers = event as Partial<globalThis.MouseEvent> | undefined;
  if (modifiers?.shiftKey) return "extend";
  if (event?.type === "click" && (modifiers?.ctrlKey || modifiers?.metaKey)) return "toggle";
  return "replace";
}

function enterTarget(event: Event | undefined): string | null {
  const key = event as Partial<globalThis.KeyboardEvent> | undefined;
  if (key?.type !== "keydown" || key.key !== "Enter" || key.shiftKey || key.ctrlKey || key.metaKey) return null;
  const target = key.target instanceof Element ? key.target.closest<HTMLElement>("[data-layer-id]") : null;
  return target?.dataset.layerId ?? null;
}

function LayersPanelView({
  rows,
  onSelect,
  onRename,
  onMove,
  onToggleVisible,
  onToggleLocked,
  onContextAction,
  contextActions,
  onRevealAll,
  collapsedIds,
  defaultCollapsedIds,
  onCollapsedChange,
  open,
  defaultOpen = true,
  onOpenChange,
  storageKey,
  virtualizeAfter = 120,
  className,
}: LayersPanelProps) {
  const { t } = useTranslation();
  const store = LayersPanelRegion.useRegionStore();
  const actions = LayersPanelRegion.useRegionActions();
  const root = useRef<HTMLDivElement>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  const [storedOpen, setStoredOpen] = usePersistedState(storageKey, defaultOpen, booleanCodec);
  const isOpen = open ?? storedOpen;
  const [ownCollapsed, setOwnCollapsed] = useState<readonly string[]>(defaultCollapsedIds ?? []);
  const collapsed = collapsedIds ?? ownCollapsed;
  const [menu] = useState(() => createMenuController<readonly string[]>());

  const changeOpen = (next: boolean) => {
    if (open === undefined) setStoredOpen(next);
    onOpenChange?.(next);
  };

  // The tree's data depends on ids, names and levels only: a new `rows` that changed just the selection, visibility or lock
  // (every click on a layer) keeps the same `items`, `branches`, `expanded` and `visible`, so the tree does not rebuild its collection.
  // The same structure is what makes `indexById` valid for the new `rows`, so a lookup by id is `rows[index]`, not a map of the rows rebuilt per change.
  const built = useRef<{ rows: readonly LayerRowData[]; items: ReturnType<typeof buildItems>; indexById: ReadonlyMap<string, number> } | null>(null);
  const structure = useMemo(() => {
    if (built.current && sameStructure(built.current.rows, rows)) return built.current;
    built.current = { rows, items: buildItems(rows), indexById: new Map(rows.map((row, index) => [row.id, index])) };
    return built.current;
  }, [rows]);
  const { items, indexById } = structure;
  const byId = useMemo(() => ({ get: (id: string): LayerRowData | undefined => rows[indexById.get(id) ?? -1], has: (id: string) => indexById.has(id) }), [rows, indexById]);
  // One pass over the rows for everything the panel counts or lists (it used to be five).
  const summary = useMemo(() => {
    const selected: string[] = [];
    const branchIds: string[] = [];
    let hidden = 0;
    let locked = 0;
    for (const row of rows) {
      if (row.selected) selected.push(row.id);
      if (row.hasChildren) branchIds.push(row.id);
      if (!row.visible) hidden += 1;
      if (row.locked && row.lockable !== false) locked += 1;
    }
    return { selected, branchIds, hidden, locked };
  }, [rows]);
  const lastSelected = useRef(summary.selected);
  const selectedIds = sameStrings(lastSelected.current, summary.selected) ? lastSelected.current : summary.selected;
  lastSelected.current = selectedIds;
  const branchList = summary.branchIds;
  const lastBranches = useRef(branchList);
  const branches = sameStrings(lastBranches.current, branchList) ? lastBranches.current : branchList;
  lastBranches.current = branches;
  const expanded = useMemo(() => {
    const closed = new Set(collapsed);
    return branches.filter((id) => !closed.has(id));
  }, [branches, collapsed]);
  const visible = useMemo(() => visibleTreeRows(items, expanded), [items, expanded]);
  const visibleIndex = useMemo(() => new Map(visible.map((row, index) => [row.item.value, index])), [visible]);
  const { hidden: hiddenCount, locked: lockedCount } = summary;

  const latest = useRef({ visibleIndex });
  latest.current = { visibleIndex };
  const rangeExtractor = useCallback((range: Range) => {
    const base = defaultRangeExtractor(range);
    const active = document.activeElement?.closest<HTMLElement>("[data-layer-id]")?.dataset.layerId;
    const { renamingId, dragging } = store.get();
    const keep = [active, renamingId, ...(dragging ?? [])];
    const extra = keep
      .map((id) => (id ? (latest.current.visibleIndex.get(id) ?? -1) : -1))
      .filter((index) => index >= 0 && !base.includes(index));
    return extra.length > 0 ? [...base, ...extra].sort((a, b) => a - b) : base;
  }, [store]);

  const virtual = useVirtualizer({
    count: visible.length,
    getScrollElement: () => viewport,
    estimateSize: () => LAYER_ROW_PITCH,
    overscan: 3,
    rangeExtractor,
    initialRect: { width: 0, height: LAYER_ROW_PITCH * 20 },
  });
  const virtualized = visible.length > virtualizeAfter;
  const indexes = virtualized ? virtual.getVirtualItems().map((item) => item.index) : visible.map((_, index) => index);

  // A selection made elsewhere (the canvas, an agent) brings its last row into view; a row already in view, or a pick made in this tree, does not move the list.
  const lastSelectedId = selectedIds[selectedIds.length - 1];
  const pickedHere = useRef<string | undefined>(undefined);
  useEffect(() => {
    const own = pickedHere.current === lastSelectedId;
    pickedHere.current = undefined;
    const index = lastSelectedId === undefined ? undefined : latest.current.visibleIndex.get(lastSelectedId);
    if (own || !viewport || index === undefined) return;
    const top = index * LAYER_ROW_PITCH;
    if (top >= viewport.scrollTop && top + LAYER_ROW_PITCH <= viewport.scrollTop + viewport.clientHeight) return;
    virtual.scrollToIndex(index, { align: "auto" });
  }, [lastSelectedId, viewport]);

  useLayoutEffect(() => {
    const renamingId = store.get().renamingId;
    if (renamingId !== null && !byId.has(renamingId)) actions.stopRename();
  }, [byId, store, actions]);

  useHotkey(
    "F2",
    () => {
      const id = document.activeElement?.closest<HTMLElement>("[data-layer-id]")?.dataset.layerId;
      const row = id ? byId.get(id) : undefined;
      if (row && row.renamable !== false) actions.startRename(row.id);
    },
    { target: root, ignoreInputs: true, preventDefault: true },
  );

  const onPointerDown = useLayerDrag({ rows, wrapper, overlay, onMove });

  const changeCollapsed = (next: string[]) => {
    if (collapsedIds === undefined) setOwnCollapsed(next);
    onCollapsedChange?.(next);
  };

  const openContext = (id: string, anchor: { x: number; y: number } | HTMLElement) => {
    const row = byId.get(id);
    if (!row) return;
    let ids: readonly string[] = selectedIds;
    if (!row.selected) {
      ids = [id];
      onSelect(ids as string[], "replace");
    }
    void menu.open({ payload: ids, anchor });
  };

  const onContextMenu = (event: MouseEvent<HTMLElement>) => {
    const id = (event.target as Element).closest<HTMLElement>("[data-layer-id]")?.dataset.layerId;
    if (!id) return;
    event.preventDefault();
    openContext(id, { x: event.clientX, y: event.clientY });
  };

  const toggleVisible = (ids: readonly string[]) => {
    const targets = ids.map((id) => byId.get(id)).filter((row): row is LayerRowData => row !== undefined);
    if (targets.length > 0) onToggleVisible(ids, !targets.every((row) => row.visible));
  };

  const toggleLocked = (ids: readonly string[]) => {
    const targets = ids.map((id) => byId.get(id)).filter((row): row is LayerRowData => row !== undefined && row.lockable !== false);
    if (targets.length > 0)
      onToggleLocked(
        targets.map((row) => row.id),
        !targets.every((row) => row.locked),
      );
  };

  // Runs in the capture phase so the tree's own arrow handling and the row's single-row shortcut never see these keys.
  const onKeyDownCapture = (event: KeyboardEvent<HTMLElement>) => {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[role='treeitem']") : null;
    const id = target?.dataset.layerId;
    if (!target || !id || event.target !== target || event.nativeEvent.isComposing) return;
    const focused = byId.get(id);
    if (!focused) return;
    const ids = focused.selected ? selectedIds : [id];
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && !event.altKey) {
      const key = event.key.toLowerCase();
      if (key !== "h" && key !== "l") return;
      event.preventDefault();
      event.stopPropagation();
      if (key === "h") toggleVisible(ids);
      else toggleLocked(ids);
      return;
    }
    if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const rtl = getComputedStyle(target).direction === "rtl";
    const keys: Record<string, LayerMoveKey> = {
      ArrowUp: "up",
      ArrowDown: "down",
      [rtl ? "ArrowLeft" : "ArrowRight"]: "indent",
      [rtl ? "ArrowRight" : "ArrowLeft"]: "outdent",
    };
    const step = keys[event.key];
    if (!step) return;
    event.preventDefault();
    event.stopPropagation();
    const move = keyboardMove(rows, ids, step);
    if (move) onMove(move);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    const id = target.dataset.layerId;
    if (!id || !((event.key === "F10" && event.shiftKey) || event.key === "ContextMenu")) return;
    event.preventDefault();
    openContext(id, target);
  };

  const rename = (ids: readonly string[]) => {
    const id = ids[0];
    if (id !== undefined) actions.startRename(id);
  };

  const hasLayers = rows.length > 0;

  return (
    <div ref={root} className={cn("flex min-h-0 flex-1 flex-col", className)}>
      <SectionHeader
        className="flex min-h-0 flex-1 flex-col"
        panelClassName="flex min-h-0 flex-1 flex-col"
        title={t("frontends.layersPanel.title")}
        headingLevel={2}
        open={isOpen}
        onOpenChange={changeOpen}
        actions={
          <Menu pendingAnnouncement={t("common.working")} onAction={(value) => (value === "show-all" || value === "unlock-all") && onRevealAll?.(value === "show-all" ? "hidden" : "locked")}>
            <Tooltip content={t("frontends.layersPanel.moreActions")} side="bottom">
              <MenuTrigger render={<IconButton size="xs" aria-label={t("frontends.layersPanel.moreActions")} />}>
                <Ellipsis aria-hidden="true" />
              </MenuTrigger>
            </Tooltip>
            <MenuContent align="end">
              <MenuItem value="show-all" disabled={hiddenCount === 0 || !onRevealAll}>
                {t("frontends.layersPanel.showAll")}
              </MenuItem>
              <MenuItem value="unlock-all" disabled={lockedCount === 0 || !onRevealAll}>
                {t("frontends.layersPanel.unlockAll")}
              </MenuItem>
            </MenuContent>
          </Menu>
        }
      >
        {hasLayers ? (
          <ScrollArea className="flex-1" viewportRef={setViewport}>
            <div ref={wrapper} className="relative pb-2 ps-2 pe-3.5" onContextMenu={onContextMenu}>
              <LayerTree
                aria-label={t("frontends.layersPanel.tree")}
                mode="multiple"
                items={items}
                value={selectedIds}
                expanded={expanded}
                onValueChange={(next, details) => {
                  const pressed = enterTarget(details.event);
                  pickedHere.current = pressed ?? next[next.length - 1];
                  const taken = pressed ? onSelect([pressed], "replace") : onSelect(next, selectMode(details.event));
                  // The owner kept the selection (a click on the only selected layer asks for none): say so, or the tree warns that its value stayed.
                  if (taken === false) details.cancel();
                }}
                onExpandedChange={(next) => changeCollapsed(branches.filter((id) => !next.includes(id)))}
                onHighlight={(_value, { index }) => virtual.scrollToIndex(index, { align: "auto" })}
                onPointerDown={onPointerDown}
                onKeyDown={onKeyDown}
                onKeyDownCapture={onKeyDownCapture}
                style={{ position: "relative", height: visible.length * LAYER_ROW_PITCH }}
              >
                {indexes.map((index) => {
                  const row = byId.get(visible[index]?.item.value as string) as LayerRowData;
                  return <LayerItem key={row.id} row={row} index={index} onToggleVisible={onToggleVisible} onToggleLocked={onToggleLocked} onRename={onRename} />;
                })}
              </LayerTree>
              <DragOverlay ref={overlay} />
            </div>
          </ScrollArea>
        ) : (
          <p className="px-3 pb-2 text-sm text-muted">{t("frontends.layersPanel.empty")}</p>
        )}
      </SectionHeader>
      <Menu controller={menu} pendingAnnouncement={t("common.working")} onAction={(value) => handleAction(String(value))}>
        <MenuContent aria-label={t("frontends.layersPanel.menuLabel")}>
          {(state: { payload?: unknown }) => {
            const ids = (state.payload as readonly string[] | undefined) ?? [];
            const targets = ids.map((id) => byId.get(id)).filter((row): row is LayerRowData => row !== undefined);
            const allVisible = targets.every((row) => row.visible);
            const lockable = targets.filter((row) => row.lockable !== false);
            const allLocked = lockable.length > 0 && lockable.every((row) => row.locked);
            const extras = contextActions?.(ids) ?? noItems;
            return (
              <>
                {targets.length === 1 && targets[0]?.renamable !== false ? <MenuItem value="rename" shortcut="f2">{t("frontends.layersPanel.rename")}</MenuItem> : null}
                <MenuItem value="toggle-visible" shortcut="mod+shift+h">{allVisible ? t("frontends.layersPanel.hide") : t("frontends.layersPanel.show")}</MenuItem>
                {lockable.length > 0 ? <MenuItem value="toggle-locked" shortcut="mod+shift+l">{allLocked ? t("frontends.layersPanel.unlock") : t("frontends.layersPanel.lock")}</MenuItem> : null}
                {extras.map((item) => (
                  <ExtraItem key={item.id} item={item} onChange={() => onContextAction?.(item.id, ids)} />
                ))}
              </>
            );
          }}
        </MenuContent>
      </Menu>
    </div>
  );

  function handleAction(value: string) {
    const ids = menu.getPayload() ?? [];
    if (value === "rename") rename(ids);
    else if (value === "toggle-visible") toggleVisible(ids);
    else if (value === "toggle-locked") toggleLocked(ids);
    else if (value.startsWith("extra:")) onContextAction?.(value.slice(6), ids);
  }
}

function ExtraItem({ item, onChange }: { item: LayerContextItem; onChange: () => void }) {
  return (
    <>
      {item.separatorBefore ? <MenuSeparator /> : null}
      {item.checked === undefined ? (
        <MenuItem value={`extra:${item.id}`} disabled={item.disabled} icon={item.icon} data-destructive={item.destructive ? "" : undefined}>
          {item.label}
        </MenuItem>
      ) : (
        <MenuCheckboxItem value={`extra:${item.id}`} checked={item.checked} disabled={item.disabled} onCheckedChange={onChange}>
          {item.label}
        </MenuCheckboxItem>
      )}
    </>
  );
}
