import { useCallback, useEffect, useMemo } from "react";
import { flushSync } from "react-dom";
import { useTranslation } from "react-i18next";
import { Canvas, type CanvasPinPoint, type CanvasRendererStatus } from "@/components/frontends/canvas";
import { useLiveClient } from "@/data/live";
import { showStatusToast } from "@/lib/notify";
import { canvasDefaults } from "../canvas-defaults";
import { createEditorFeed } from "../canvas-feed";
import { useCanvasCollab } from "../canvas-collab";
import { useCanvasInputHandler } from "../canvas-input";
import { readCaptureParams } from "../capture";
import { useEditorStore } from "../editor-store";
import { createWasmLoader } from "../wasm-module";
import { useApplyOps } from "../use-apply";
import { useSelectionActions } from "../use-selection-actions";

/**
 * The canvas of the editor. It reads NOTHING through React state: the document and the editor's selection, hover, tool, page
 * and zoom reach the canvas as a feed it subscribes to itself, so this component renders once and a delta, a click or a zoom
 * commits only the nodes and overlays that show it. Presence (agent cursors, the build replay) comes in a second feed kept
 * outside React; the pins come from the same query as the pins panel through a component that renders nothing. Its callbacks are stable.
 */
export function CanvasRegion() {
  const { t } = useTranslation();
  const client = useLiveClient();
  const editor = useEditorStore();
  const apply = useApplyOps();
  const selection = useSelectionActions();
  const feed = useMemo(() => createEditorFeed(client.store, editor), [client, editor]);
  const { collab, source } = useCanvasCollab();
  const onInput = useCanvasInputHandler();
  const capture = useMemo(readCaptureParams, []);
  const wasm = useMemo(createWasmLoader, []);
  const onSelect = useCallback((ids: readonly string[]) => editor.actions.select(ids), [editor]);
  const onHover = useCallback((id: string | null) => editor.actions.setHovered(id), [editor]);
  const onZoomChange = useCallback((zoom: number) => editor.actions.setZoom(zoom), [editor]);
  const onToolDone = useCallback(() => editor.actions.setTool("select"), [editor]);
  const onError = useCallback((message: string) => showStatusToast({ status: "danger", title: t("app.shell.actionFailedTitle"), description: message }), [t]);
  // The renderer reports to the editor's store, where the zoom bar's menu reads it. A build without the renderer cannot hold the choice;
  // a failure gives the nodes back to the DOM (the canvas already did) and tells the person, through the same toast as any failed action.
  const onRendererStatus = useCallback(
    (status: CanvasRendererStatus) => {
      editor.actions.setRendererStatus(status);
      if (status.backend === "unavailable") editor.actions.setRenderer("dom");
    },
    [editor],
  );
  const onRendererError = useCallback(
    (message: string) => {
      editor.actions.setRenderer("dom");
      // The exception ("Failed to fetch dynamically imported module: ...") is for the console; the person gets a sentence.
      console.warn("[paprika] WASM renderer stopped:", message);
      showStatusToast({ status: "danger", title: t("app.canvas.renderer.failedTitle"), description: t("app.canvas.renderer.failed") });
    },
    [editor, t],
  );
  // The layers menu acts on the ids it was opened on.
  const onConvertToPath = useCallback((ids: readonly string[]) => void selection.convert(ids), [selection]);
  const onCenterContent = useCallback((ids: readonly string[]) => void selection.center(ids), [selection]);
  // The form for the pin opens (and, being the first field, takes the focus) before the pointer's own event ends. React would
  // render it a task later, and a key typed in that gap lands on the canvas, whose letters are shortcuts (r, i, h...).
  const onPinPoint = useCallback(
    (point: CanvasPinPoint) => {
      flushSync(() => {
        editor.actions.setPinPoint(point);
        if (point.nodeId) editor.actions.select([point.nodeId]);
      });
    },
    [editor],
  );
  const onPinSelect = useCallback(
    (id: string) => {
      editor.actions.openDialog("pins");
      editor.actions.setPin(id);
    },
    [editor],
  );
  const onSample = useCallback(
    (color: string | null) => {
      const pick = editor.state.sampler;
      if (!color || !pick) return;
      editor.actions.endSampling();
      pick(color);
    },
    [editor],
  );

  // The screenshot asks for a page along with the node.
  useEffect(() => {
    if (capture?.page) editor.actions.setPage(capture.page);
  }, [capture, editor]);
  // The eyedropper has no other way out than a colour: Escape disarms it.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || editor.state.sampler === null) return;
      event.preventDefault();
      editor.actions.endSampling();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [editor]);

  return (
    <>
      <Canvas
        feed={feed}
        collab={collab}
        capture={capture?.id ?? null}
        onSelect={onSelect}
        onHover={onHover}
        onZoomChange={onZoomChange}
        onApply={apply}
        defaults={canvasDefaults}
        wasm={wasm}
        onRendererStatus={onRendererStatus}
        onRendererError={onRendererError}
        onConvertToPath={onConvertToPath}
        onCenterContent={onCenterContent}
        onToolDone={onToolDone}
        onError={onError}
        onInput={onInput}
        onPinPoint={onPinPoint}
        onPinSelect={onPinSelect}
        onSample={onSample}
      />
      {source}
    </>
  );
}
