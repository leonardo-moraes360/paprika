import { useCallback, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { HistoryPanel } from "@/components/frontends/history-panel";
import { pageOfNodes, toHistorySteps } from "@/adapters/history";
import { resolvePageId } from "@/adapters/pages";
import { useLive, useLiveClient } from "@/data/live";
import { useHistory } from "@/data/queries/history";
import { showStatusToast } from "@/lib/notify";
import { errorText } from "@/lib/use-async-action";
import { useEditor, useEditorActions, useEditorStore } from "../editor-store";
import { useHistoryActions } from "../use-history-actions";

const historyShortcut = ["Ctrl", "H"] as const;

/** The panel itself, mounted only while it is open: it reads the document version and the roster, the closed editor does not. */
function HistoryOpen() {
  const { t } = useTranslation();
  const client = useLiveClient();
  const editor = useEditorActions();
  const store = useEditorStore();
  const history = useHistoryActions();
  const workspaceId = useLive((s) => s.doc?.id ?? "");
  const version = useLive((s) => s.version);
  const actors = useLive((s) => [...new Set(s.agents.map((a) => a.actor))].join("\n"));
  const query = useHistory(workspaceId, version);
  const steps = useMemo(() => toHistorySteps(query.data?.steps, actors ? actors.split("\n") : []), [query.data, actors]);

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
    <div className="fixed end-4 top-16 bottom-4 z-30 flex max-w-[calc(100vw-2rem)]">
      <HistoryPanel steps={steps} loading={query.isPending} onUndoStep={history.undoStep} onRedoStep={history.redoStep} onSelectNodes={onSelectNodes} onClose={onClose} shortcut={historyShortcut} />
    </div>
  );
}

/** The history panel over the editor, opened by the flag in the editor store (toolbar, Ctrl+H, toasts). */
export function History() {
  const open = useEditor((s) => s.dialogs.history);
  return open ? <HistoryOpen /> : null;
}
