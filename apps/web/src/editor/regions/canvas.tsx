import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Canvas } from "@/components/frontends/canvas";
import { useLiveClient } from "@/data/live";
import { showStatusToast } from "@/lib/notify";
import { createEditorFeed } from "../canvas-feed";
import { useEditorStore } from "../editor-store";
import { useApplyOps } from "../use-apply";

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
  const feed = useMemo(() => createEditorFeed(client.store, editor), [client, editor]);
  const onSelect = useCallback((ids: readonly string[]) => editor.actions.select(ids), [editor]);
  const onHover = useCallback((id: string | null) => editor.actions.setHovered(id), [editor]);
  const onZoomChange = useCallback((zoom: number) => editor.actions.setZoom(zoom), [editor]);
  const onToolDone = useCallback(() => editor.actions.setTool("select"), [editor]);
  const onError = useCallback((message: string) => showStatusToast({ status: "danger", title: t("app.shell.actionFailedTitle"), description: message }), [t]);
  return <Canvas feed={feed} onSelect={onSelect} onHover={onHover} onZoomChange={onZoomChange} onApply={apply} onToolDone={onToolDone} onError={onError} />;
}
