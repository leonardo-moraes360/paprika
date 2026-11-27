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
  rememberNudges,
  type PendingNudges,
  selectAllIds,
  ungroupPlan,
  wrapPlan,
  type SelectionPlan,
  type SelectionResult,
} from "@/adapters/selection-ops";
import { childrenSelection, cycleSibling, stackPlan, type StackStep } from "@/adapters/canvas-keys";
import { resolvePageId } from "@/adapters/pages";
import { selectionErrorNote } from "@/adapters/selection-errors";
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
    // Held arrow key: the ack comes before the delta, so each step starts from where the previous one is going (E3).
    let pendingNudges: PendingNudges | undefined;

    const run = async (result: SelectionResult): Promise<boolean> => {
      if (!result) return false;
      if ("error" in result) {
        // The core's sentence is English: the toast says it in the language of the app, and keeps the core's text only for a refusal it does not know.
        const { key, values } = selectionErrorNote(result.error);
        showStatusToast({ status: "danger", title: t("app.shell.actionFailedTitle"), description: (t as (key: string, options: object) => string)(`app.shell.selectionErrors.${key}`, values) });
        return false;
      }
      const ok = await apply(result.ops, t(`app.shell.labels.${result.label}`));
      if (ok && result.select) editor.actions.select(result.select);
      return ok;
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
        if (!d) return Promise.resolve();
        const { version } = client.store.state;
        const plan = nudgePlan(d, selection(), dx, dy, pendingNudges, version);
        if (!plan) return Promise.resolve();
        pendingNudges = rememberNudges(d, plan, version, pendingNudges);
        return run(plan).then((ok) => {
          if (!ok) pendingNudges = undefined;
        });
      },
      /** Enter: select the children of the selection. `false` when there are none (the key is then not ours). */
      selectChildren: (): boolean => {
        const d = doc();
        const kids = d ? childrenSelection(d, selection()) : [];
        if (kids.length === 0) return false;
        editor.actions.select(kids);
        return true;
      },
      /** Tab and Shift+Tab: the next or previous sibling. `false` when there is none. */
      selectSibling: (dir: 1 | -1): boolean => {
        const d = doc();
        const next = d ? cycleSibling(d, selection(), dir) : null;
        if (!next) return false;
        editor.actions.select([next]);
        return true;
      },
      /** PageUp and PageDown: move the selection in the stack. */
      stack: (step: StackStep) => {
        const d = doc();
        const plan = d ? stackPlan(d, selection(), step) : null;
        return plan ? apply(plan.ops, t(`app.canvas.order.${plan.step}`)) : Promise.resolve(false);
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
