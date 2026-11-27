import { copyOwner, revealOps, type Op } from "@paprika/core";
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { LayersPanel, type LayerAgent, type LayerContextItem, type LayerMove, type LayerRowData, type LayerSelectMode } from "@/components/frontends/layers-panel";
import { createLayerRowsCache, deriveLayerRows, moveOps, resolveLayerSelection } from "@/adapters/layer-rows";
import { centerPlan, convertToPathPlan, groupPlan, sceneNodes, ungroupPlan, wrapPlan } from "@/adapters/selection-ops";
import { useLiveClient } from "@/data/live";
import { useEditor, useEditorActions, useEditorStore } from "../editor-store";
import { useActiveAgents } from "../use-active-agents";
import { useActivePageId, useCorrectSelection } from "../use-active-page";
import { useAfterFirstPaint } from "../use-after-paint";
import { useApplyOps } from "../use-apply";
import { useSelectionActions } from "../use-selection-actions";

const noRows: readonly LayerRowData[] = [];

type Inputs = { doc: unknown; pageId: string | null; selection: ReadonlySet<string>; touched: ReadonlyMap<string, LayerAgent> };

/**
 * Rows of the page in view as a store: it re-reads on every live update but hands React the SAME array unless a row
 * changed (see `deriveLayerRows`), so a delta that moves a node commits nothing here. The walk itself is skipped when
 * none of its inputs is a different object than last time.
 */
function useLayerRows(pageId: string | null, selection: readonly string[], touched: ReadonlyMap<string, LayerAgent>) {
  const client = useLiveClient();
  const [memo] = useState(() => ({ cache: createLayerRowsCache(), last: null as (Inputs & { rows: readonly LayerRowData[] }) | null }));
  const set = useMemo(() => new Set(selection), [selection]);
  const subscribe = useCallback((notify: () => void) => client.store.subscribe(notify).unsubscribe, [client]);
  const read = () => {
    const doc = client.store.state.doc;
    if (!doc) return noRows;
    const last = memo.last;
    if (last && last.doc === doc && last.pageId === pageId && last.selection === set && last.touched === touched) return last.rows;
    const rows = deriveLayerRows(memo.cache, doc, pageId, set, touched);
    memo.last = { doc, pageId, selection: set, touched, rows };
    return rows;
  };
  return useSyncExternalStore(subscribe, read, () => noRows);
}

/**
 * The layers of the page in view. The body mounts in a transition right after the first paint (a document of thousands of
 * nodes would otherwise make the opening one long task); the panel is empty for that one frame.
 */
export function Layers() {
  return useAfterFirstPaint() ? <LayersBody /> : null;
}

/** Selection, rename, move, visibility, lock, context menu and "show all"/"unlock all", all by ops. */
function LayersBody() {
  const { t } = useTranslation();
  const client = useLiveClient();
  const editor = useEditorActions();
  const store = useEditorStore();
  const apply = useApplyOps();
  const actions = useSelectionActions();
  const pageId = useActivePageId();
  const selection = useEditor((s) => s.selection);
  const touched = useActiveAgents((a) => a.nodes);
  useCorrectSelection();
  const rows = useLayerRows(pageId, selection, touched);

  const onSelect = useCallback((ids: string[], mode: LayerSelectMode) => editor.select(resolveLayerSelection(store.state.selection, ids, mode)), [editor, store]);
  const onRename = useCallback((id: string, name: string) => void apply([{ op: "update", id, props: { name } }], t("app.shell.labels.renameLayer")), [apply, t]);
  const onMove = useCallback(
    (move: LayerMove) => {
      const doc = client.store.state.doc;
      if (!doc) return;
      const ops = moveOps(doc, move);
      if (ops.length === 0) return;
      const target = doc.nodes[move.targetId];
      const sameParent = move.position !== "inside" && ops.every((op) => op.op === "move" && doc.nodes[op.id]?.parentId === target?.parentId);
      void apply(ops, t(sameParent ? "app.shell.labels.reorderLayer" : "app.shell.labels.reparentLayer"));
    },
    [client, apply, t],
  );
  const flag = useCallback(
    (prop: "visible" | "locked", labelOn: string, labelOff: string) => (ids: readonly string[], value: boolean) => {
      const doc = client.store.state.doc;
      if (!doc) return;
      const ops: Op[] = ids
        .filter((id) => {
          const node = doc.nodes[id];
          return node && node.type !== "page" && node[prop] !== value && (prop !== "locked" || !copyOwner(doc, node));
        })
        .map((id) => ({ op: "update", id, props: { [prop]: value } }));
      if (ops.length) void apply(ops, value ? labelOn : labelOff);
    },
    [client, apply],
  );
  const onToggleVisible = useMemo(() => flag("visible", t("app.shell.labels.show"), t("app.shell.labels.hide")), [flag, t]);
  const onToggleLocked = useMemo(() => flag("locked", t("app.shell.labels.lock"), t("app.shell.labels.unlock")), [flag, t]);

  const onRevealAll = useCallback(
    (kind: "hidden" | "locked") => {
      const doc = client.store.state.doc;
      if (!doc) return;
      const page = (store.state.pageId && doc.nodes[store.state.pageId]?.type === "page" ? store.state.pageId : undefined) ?? pageId ?? undefined;
      if (!revealOps(doc, kind, page).ops.length) return;
      void apply([{ op: "reveal", kind, ...(page ? { pageId: page } : {}) }], t(kind === "hidden" ? "app.shell.labels.showAll" : "app.shell.labels.unlockAll"));
    },
    [client, store, pageId, apply, t],
  );

  const contextActions = useCallback(
    (ids: readonly string[]): readonly LayerContextItem[] => {
      const doc = client.store.state.doc;
      if (!doc) return [];
      const nodes = sceneNodes(doc, ids);
      if (nodes.length === 0) return [];
      const valid = (result: ReturnType<typeof groupPlan>) => result !== null && !("error" in result);
      const items: LayerContextItem[] = [
        { id: "group", label: t("app.shell.layerMenu.group"), disabled: !valid(groupPlan(doc, ids, () => "x")), separatorBefore: true },
        { id: "wrap", label: t("app.shell.layerMenu.wrap"), disabled: !valid(wrapPlan(doc, ids, () => "x")) },
      ];
      if (ungroupPlan(doc, ids)) items.push({ id: "ungroup", label: t("app.shell.layerMenu.ungroup") });
      items.push({ id: "duplicate", label: t("app.shell.layerMenu.duplicate") });
      const center = centerPlan(doc, ids);
      if (center.plan) items.push({ id: "center", label: t("app.shell.layerMenu.center"), checked: !center.centered });
      if (convertToPathPlan(doc, ids)) items.push({ id: "convert", label: t("app.shell.layerMenu.convert") });
      items.push({ id: "delete", label: t("app.shell.layerMenu.delete"), destructive: true, separatorBefore: true });
      return items;
    },
    [client, t],
  );
  const onContextAction = useCallback(
    (action: string, ids: readonly string[]) => {
      const run = { group: actions.group, wrap: actions.wrap, ungroup: actions.ungroup, duplicate: actions.duplicate, center: actions.center, convert: actions.convert, delete: actions.remove }[action];
      void run?.(ids);
    },
    [actions],
  );

  return (
    <LayersPanel
      rows={rows}
      onSelect={onSelect}
      onRename={onRename}
      onMove={onMove}
      onToggleVisible={onToggleVisible}
      onToggleLocked={onToggleLocked}
      onRevealAll={onRevealAll}
      contextActions={contextActions}
      onContextAction={onContextAction}
      storageKey="layers.open"
    />
  );
}
