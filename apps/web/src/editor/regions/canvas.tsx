import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Canvas } from "@/components/frontends/canvas";
import { useLiveClient } from "@/data/live";
import { showStatusToast } from "@/lib/notify";
import { vectorDefaults } from "../canvas-defaults";
import { createEditorFeed } from "../canvas-feed";
import { useEditorStore } from "../editor-store";
import { useApplyOps } from "../use-apply";
import { useSelectionActions } from "../use-selection-actions";

/**
 * The canvas of the editor. It reads NOTHING through React state: the document and the editor's selection, hover, tool, page
 * and zoom reach the canvas as a feed it subscribes to itself, so this component renders once and a delta, a click or a zoom
 * commits only the nodes and overlays that show it. Its callbacks are stable.
 */
export function CanvasRegion() {
  const { t } = useTranslation();
  const client = useLiveClient();
  const editor = useEditorStore();
  const apply = useApplyOps();
  const selection = useSelectionActions();
  const feed = useMemo(() => createEditorFeed(client.store, editor), [client, editor]);
  const onSelect = useCallback((ids: readonly string[]) => editor.actions.select(ids), [editor]);
  const onHover = useCallback((id: string | null) => editor.actions.setHovered(id), [editor]);
  const onZoomChange = useCallback((zoom: number) => editor.actions.setZoom(zoom), [editor]);
  const onToolDone = useCallback(() => editor.actions.setTool("select"), [editor]);
  const onError = useCallback((message: string) => showStatusToast({ status: "danger", title: t("app.shell.actionFailedTitle"), description: message }), [t]);
  // The layers menu acts on the ids it was opened on.
  const onConvertToPath = useCallback((ids: readonly string[]) => void selection.convert(ids), [selection]);
  const onCenterContent = useCallback((ids: readonly string[]) => void selection.center(ids), [selection]);
  return <Canvas feed={feed} onSelect={onSelect} onHover={onHover} onZoomChange={onZoomChange} onApply={apply} vectorDefaults={vectorDefaults} onToolDone={onToolDone} onError={onError} onConvertToPath={onConvertToPath} onCenterContent={onCenterContent} />;
}
