import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { stepNumber, stepOutcome, type StepOutcome } from "@/adapters/history";
import { useLiveActions, type StepResult } from "@/data/live";
import { showStatusToast, showUndoToast } from "@/lib/notify";
import { useEditorActions } from "./editor-store";
import { useFailureText } from "./use-apply";

type Call = () => Promise<StepResult | undefined>;

/**
 * Undo and redo, with the toast the person reads (the old app's wording). `undoOwn`/`redoOwn` are the keyboard's and
 * the toolbar's; `undoStep`/`redoStep` are the history panel's, which want a failure to REACH it (its own alert), so
 * they throw what the server or the socket said; conflicts, "nothing" and "missing" are answers, not failures.
 */
export function useHistoryActions() {
  const { t } = useTranslation();
  const live = useLiveActions();
  const editor = useEditorActions();
  const failure = useFailureText();

  return useMemo(() => {
    const announce = (outcome: StepOutcome, redoStep: (ord: number) => void) => {
      const history = { label: t("app.shell.toast.viewHistory"), onAction: () => editor.openDialog("history") };
      switch (outcome.kind) {
        case "undone": {
          const title = outcome.agent
            ? t("app.shell.toast.undoneAgent", { label: outcome.label, agent: outcome.agent })
            : outcome.own && outcome.newer > 0
              ? t("app.shell.toast.undoneOwn", { label: outcome.label, count: outcome.newer })
              : t("app.shell.toast.undone", { label: outcome.label });
          showUndoToast({ title, action: { label: t("app.shell.toast.redo"), onAction: () => redoStep(outcome.ord) } });
          return;
        }
        case "redone":
          showStatusToast({ status: "success", title: t("app.shell.toast.redone", { label: outcome.label }) });
          return;
        case "nothing-mine":
          showStatusToast({ status: "info", title: t("app.shell.toast.nothingMine", { agent: outcome.agent }), action: history });
          return;
        case "nothing":
          showStatusToast({ status: "info", title: t("app.shell.toast.nothingAtAll") });
          return;
        case "nothing-redo":
          showStatusToast({ status: "info", title: t("app.shell.toast.nothingToRedo") });
          return;
        case "conflict":
          showStatusToast({ status: "info", title: t(outcome.redo ? "app.shell.toast.conflictRedo" : "app.shell.toast.conflictUndo"), action: history });
          return;
        default:
          showStatusToast({ status: "info", title: t("app.shell.toast.missing") });
      }
    };

    const redoByOrd = (ord: number) => void run(() => live.redoStep(ord), true, false, false);

    async function run(call: Call, redo: boolean, own: boolean, rethrow: boolean): Promise<void> {
      let result: StepResult | undefined;
      try {
        result = await call();
      } catch (error) {
        if (rethrow) throw new Error(failure(error));
        showStatusToast({ status: "danger", title: t("app.shell.actionFailedTitle"), description: failure(error) });
        return;
      }
      if (result) announce(stepOutcome(result, redo, own), redoByOrd);
    }

    const step = (id: string, redo: boolean) => {
      const ord = stepNumber(id);
      if (ord === null) return Promise.reject(new Error(t("app.shell.toast.missing")));
      return run(() => (redo ? live.redoStep(ord) : live.undoStep(ord)), redo, false, true);
    };

    return {
      undoOwn: () => run(() => live.undoOwn(), false, true, false),
      redoOwn: () => run(() => live.redoOwn(), true, true, false),
      undoStep: (id: string) => step(id, false),
      redoStep: (id: string) => step(id, true),
    };
  }, [t, live, editor, failure]);
}
