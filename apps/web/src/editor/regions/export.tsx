import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ExportDialog, type ExportRequest } from "@/components/frontends/export-dialog";
import { activePageId, codeRootId, exportCode, exportCodeFormats, exportFileName, exportImageFormats, exportRootId, exportScales, exportSize, exportSvgText, hasExportSelection } from "@/adapters/export";
import { useLiveClient } from "@/data/live";
import { fetchPng } from "@/data/queries/export";
import { useEditor, useEditorActions, useEditorStore } from "../editor-store";

/**
 * The dialog is made while it is open, from what the editor holds at that moment (the selection, the page and the
 * document), so a delta never re-renders it. SVG and code are made here with `@paprika/core`; the PNG is the server's screenshot and only when the workspace in view is the one the server has open (export never opens a workspace).
 */
function ExportContainer() {
  const { t } = useTranslation();
  const client = useLiveClient();
  const editor = useEditorStore();
  const { closeDialog } = useEditorActions();
  const [opened] = useState(() => ({ doc: client.store.state.doc, selection: editor.state.selection, pageId: editor.state.pageId }));
  const { doc, selection, pageId } = opened;
  const selected = doc ? hasExportSelection(doc, selection) : false;
  const scopes = useMemo(
    () => [
      ...(selected ? [{ value: "selection", label: t("app.collab.export.scopeSelection") }] : []),
      { value: "page", label: doc && activePageId(doc, pageId) ? t("app.collab.export.scopePage") : t("app.collab.export.scopeCanvas") },
    ],
    [selected, doc, pageId, t],
  );
  // The dialog has one size and does not say when the scope changes: with two scopes the size is left out.
  const size = useMemo(() => (doc && !selected ? exportSize(doc, exportRootId(doc, "page", selection, pageId), pageId) : undefined), [doc, selected, selection, pageId]);
  const fileName = doc ? exportFileName(doc, exportRootId(doc, selected ? "selection" : "page", selection, pageId)) : "paprika";
  const onOpenChange = useCallback((next: boolean) => !next && closeDialog("export"), [closeDialog]);
  const onRequestExport = useCallback(
    async (request: ExportRequest): Promise<Blob | string> => {
      const current = client.store.state.doc;
      if (!current) throw new Error(t("app.offline"));
      if (request.kind === "code") {
        const root = codeRootId(current, selection, pageId);
        if (!root) throw new Error(t("app.collab.export.noFrame"));
        return exportCode(current, root, request.tokens);
      }
      const root = exportRootId(current, request.scope, selection, pageId);
      if (request.format === "svg") return exportSvgText(current, root);
      return fetchPng(current.id, root, request.scale);
    },
    [client, selection, pageId, t],
  );
  return (
    <ExportDialog
      open
      onOpenChange={onOpenChange}
      onRequestExport={onRequestExport}
      fileName={fileName}
      imageFormats={exportImageFormats}
      codeFormats={exportCodeFormats}
      scales={exportScales}
      scopes={scopes}
      size={size}
    />
  );
}

export function Export() {
  const open = useEditor((s) => s.dialogs.export);
  return open ? <ExportContainer /> : null;
}
