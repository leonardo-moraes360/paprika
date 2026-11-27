import type { Document } from "@paprika/core";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  centerPlan,
  convertToPathPlan,
  deletePlan,
  duplicatePlan,
  escapeSelection,
  groupPlan,
  nudgePlan,
  selectAllIds,
  ungroupPlan,
  wrapPlan,
  type SelectionPlan,
  type SelectionResult,
} from "@/adapters/selection-ops";
import { resolvePageId } from "@/adapters/pages";
import { useLiveClient } from "@/data/live";
import { showStatusToast } from "@/lib/notify";
import { useEditorStore } from "./editor-store";
import { useApplyOps } from "./use-apply";

/**
 * What the editor does with the selection, for the layers menu and the keyboard alike. Everything is read when the
 * action runs (the document and the selection are not subscribed here), so the object is stable for the life of the editor.
 */
export function useSelectionActions() {
  const client = useLiveClient();
  const editor = useEditorStore();
  const apply = useApplyOps();
  const { t } = useTranslation();

  return useMemo(() => {
    const doc = () => client.store.state.doc;
    const selection = () => editor.state.selection;

    const run = async (result: SelectionResult) => {
      if (!result) return;
      if ("error" in result) {
        showStatusToast({ status: "danger", title: t("app.shell.actionFailedTitle"), description: result.error });
        return;
      }
      const ok = await apply(result.ops, t(`app.shell.labels.${result.label}`));
      if (ok && result.select) editor.actions.select(result.select);
    };

    /** The same action on explicit ids (the layers menu acts on the ids it was opened on). */
    const on = (plan: (doc: Document, ids: readonly string[]) => SelectionResult | SelectionPlan | null) => (ids?: readonly string[]) => {
      const d = doc();
      return d ? run(plan(d, ids ?? selection())) : Promise.resolve();
    };

    return {
      group: on(groupPlan),
      wrap: on(wrapPlan),
      ungroup: on(ungroupPlan),
      duplicate: on((d, ids) => duplicatePlan(d, ids)),
      remove: on(deletePlan),
      center: on((d, ids) => centerPlan(d, ids).plan),
      convert: on(convertToPathPlan),
      nudge: (dx: number, dy: number) => {
        const d = doc();
        return d ? run(nudgePlan(d, selection(), dx, dy)) : Promise.resolve();
      },
      selectAll: () => {
        const d = doc();
        if (d) editor.actions.select(selectAllIds(d, selection(), resolvePageId(d, editor.state.pageId)));
      },
      escape: () => {
        const d = doc();
        editor.actions.setTool("select");
        editor.actions.select(d ? escapeSelection(d, selection()) : []);
      },
    };
  }, [client, editor, apply, t]);
}
