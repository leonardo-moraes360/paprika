import { useFormatForDisplay } from "@tanstack/react-hotkeys";
import { useCallback, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { HistoryPanel } from "@/components/frontends/history-panel";
import { pageOfNodes, stepActors, toHistorySteps } from "@/adapters/history";
import { resolvePageId } from "@/adapters/pages";
import { useLive, useLiveClient } from "@/data/live";
import { useHistory } from "@/data/queries/history";
import { showStatusToast } from "@/lib/notify";
import { errorText } from "@/lib/use-async-action";
import { useAgentTones, useAssignTones } from "../collab";
import { useEditor, useEditorActions, useEditorStore } from "../editor-store";
import { useHistoryActions } from "../use-history-actions";

/**
 * The panel itself, mounted only while it is open. It reads the workspace id and the roster, never the document version:
 * `useHistory` follows the version through the store without rendering, so a stream of deltas does not re-render the panel.
 */
function HistoryOpen() {
  const { t } = useTranslation();
  const client = useLiveClient();
  const editor = useEditorActions();
  const store = useEditorStore();
  const history = useHistoryActions();
  const workspaceId = useLive((s) => s.doc?.id ?? "");
  const format = useFormatForDisplay();
  const historyShortcut = useMemo(() => format("Mod+H", { parts: true }), [format]);
  const tones = useAgentTones();
  const query = useHistory(workspaceId);
  const steps = useMemo(() => toHistorySteps(query.data?.steps, tones), [query.data, tones]);
  useAssignTones(useMemo(() => stepActors(query.data?.steps), [query.data]));

  const failure = query.error ? errorText(query.error) || t("app.shell.actionFailed") : null;
  useEffect(() => {
    if (failure !== null) showStatusToast({ status: "danger", title: t("app.shell.history.loadFailed"), description: failure });
  }, [failure, t]);

  const onClose = useCallback(() => editor.closeDialog("history"), [editor]);
  const onSelectNodes = useCallback(
    (nodeIds: string[]) => {
      const doc = client.store.state.doc;
      if (!doc) return;
      const hit = pageOfNodes(doc.nodes, nodeIds);
      if (hit.ids.length === 0) {
        showStatusToast({ status: "info", title: t("app.shell.history.nodesGone") });
        return;
      }
      if (hit.pageId && hit.pageId !== resolvePageId(doc, store.state.pageId)) editor.setPage(hit.pageId);
      editor.select(hit.ids);
    },
    [client, editor, store, t],
  );

  return (
    <div className="fixed end-2 top-14 bottom-16 z-30 flex w-76 max-w-[calc(100vw-1rem)]">
      <HistoryPanel steps={steps} loading={query.isPending} onUndoStep={history.undoStep} onRedoStep={history.redoStep} onSelectNodes={onSelectNodes} onClose={onClose} shortcut={historyShortcut} className="w-full" />
    </div>
  );
}

/** The history panel over the editor, opened by the flag in the editor store (toolbar, Ctrl+H, toasts). */
export function History() {
  const open = useEditor((s) => s.dialogs.history);
  return open ? <HistoryOpen /> : null;
}
