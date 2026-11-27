import { ArrowUpRight, Circle, Cloud, Cylinder, Diamond, Frame, MapPin, MousePointer2, PenTool, Shapes, Square, StickyNote, Triangle, Type } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Toolbar, type ToolbarTool } from "@/components/frontends/toolbar";
import { ZoomBar, type ZoomRenderer } from "@/components/frontends/zoom-bar";
import { useLive, useLiveActions } from "@/data/live";
import { writeRendererPreference } from "../renderer-preference";
import { editorTools, MAX_ZOOM, MIN_ZOOM, useEditor, useEditorActions, type EditorRenderer, type EditorTool } from "../editor-store";
import { toolHotkeys, useEditorShortcuts } from "../shortcuts";
import { useHistoryActions } from "../use-history-actions";

const hotkeyOf = (tool: EditorTool) => Object.entries(toolHotkeys).find(([, id]) => id === tool)?.[0];

const isTool = (id: string): id is EditorTool => (editorTools as readonly string[]).includes(id);

/** The tools of the old app (`TOOL_DEFS`), with its keys; the diagram shapes share one button, as in the design. */
function useTools(): ToolbarTool[] {
  const { t } = useTranslation();
  return useMemo(() => {
    const one = (id: EditorTool, label: string, icon: ToolbarTool["icon"], extra: Partial<ToolbarTool> = {}): ToolbarTool => ({ id, label, icon, hotkey: hotkeyOf(id), ...extra });
    const option = (id: EditorTool, label: string, icon: ToolbarTool["icon"]) => ({ id, label, icon, hotkey: hotkeyOf(id) });
    return [
      one("select", t("app.shell.tools.select"), <MousePointer2 />),
      one("frame", t("app.shell.tools.frame"), <Frame />),
      one("rect", t("app.shell.tools.rect"), <Square />),
      one("ellipse", t("app.shell.tools.ellipse"), <Circle />),
      one("text", t("app.shell.tools.text"), <Type />),
      one("pen", t("app.shell.tools.pen"), <PenTool />),
      {
        id: "diagram",
        label: t("app.shell.tools.diagram"),
        icon: <Shapes />,
        options: [
          option("shape", t("app.shell.tools.shape"), <Square />),
          option("diamond", t("app.shell.tools.diamond"), <Diamond />),
          option("triangle", t("app.shell.tools.triangle"), <Triangle />),
          option("cylinder", t("app.shell.tools.cylinder"), <Cylinder />),
          option("parallelogram", t("app.shell.tools.parallelogram"), <Square className="-skew-x-12" />),
          option("cloud", t("app.shell.tools.cloud"), <Cloud />),
          option("note", t("app.shell.tools.note"), <StickyNote />),
        ],
      },
      one("connector", t("app.shell.tools.connector"), <ArrowUpRight />),
      one("pin", t("app.shell.tools.pin"), <MapPin />, { separatorBefore: true }),
    ];
  }, [t]);
}

/** Tools, undo/redo, history, import/export and the dock. Reads the tool, `canUndo` and `canRedo`: nothing else of the document. */
const StageToolbar = memo(function StageToolbar() {
  const tools = useTools();
  const tool = useEditor((s) => s.tool);
  const canUndo = useLive((s) => s.canUndo);
  const canRedo = useLive((s) => s.canRedo);
  const editor = useEditorActions();
  const history = useHistoryActions();
  const onValueChange = useCallback((id: string) => isTool(id) && editor.setTool(id), [editor]);
  const onHistory = useCallback(() => editor.toggleDialog("history"), [editor]);
  const onImport = useCallback(() => editor.openDialog("import"), [editor]);
  const onExport = useCallback(() => editor.openDialog("export"), [editor]);
  return (
    <Toolbar
      tools={tools}
      value={tool}
      onValueChange={onValueChange}
      canUndo={canUndo}
      canRedo={canRedo}
      onUndo={() => void history.undoOwn()}
      onRedo={() => void history.redoOwn()}
      onHistory={onHistory}
      onImport={onImport}
      onExport={onExport}
      storageKey="toolbar.dock"
      shortcuts={false}
    />
  );
});

const isRenderer = (id: string): id is EditorRenderer => id === "dom" || id === "wasm";

/**
 * Zoom lives in the editor store for the canvas to read. The renderer menu has the two modes of the old app (DOM and
 * WASM): the choice goes to the store, to `paprika.renderer` (the old app's key) and, as a `hello`, to the server,
 * which shows it to the agents (`get_context`) and uses it for `render_screenshot`. There is no canvas yet, so the
 * menu only keeps and announces the choice (the backend, GPU or CPU, is the canvas' to report).
 */
const StageZoom = memo(function StageZoom() {
  const { t } = useTranslation();
  const zoom = useEditor((s) => s.zoom);
  const renderer = useEditor((s) => s.renderer);
  const editor = useEditorActions();
  const live = useLiveActions();
  const renderers = useMemo<ZoomRenderer[]>(() => [{ id: "dom", label: t("app.shell.renderers.dom") }, { id: "wasm", label: t("app.shell.renderers.wasm") }], [t]);
  // The `hello` goes on mount (as the old app did on every open) and on every change; the client repeats it after a reconnection.
  useEffect(() => live.setRenderer(renderer), [live, renderer]);
  const onRendererChange = useCallback(
    (id: string) => {
      if (!isRenderer(id)) return;
      writeRendererPreference(id);
      editor.setRenderer(id);
    },
    [editor],
  );
  return (
    <ZoomBar
      zoom={zoom}
      minZoom={MIN_ZOOM}
      maxZoom={MAX_ZOOM}
      onZoomOut={editor.zoomOut}
      onZoomIn={editor.zoomIn}
      onFit={editor.fit}
      renderers={renderers}
      renderer={renderer}
      onRendererChange={onRendererChange}
      className="absolute bottom-3 end-3 z-10"
    />
  );
});

/**
 * An empty stage that takes focus (the canvas does not exist yet) with the toolbar and the zoom bar over it, and the
 * editor's global keys. It selects only the workspace id: a delta that changes one node never re-renders it.
 */
export function Stage() {
  const { t } = useTranslation();
  const id = useLive((s) => s.doc?.id ?? "");
  const stage = useRef<HTMLDivElement>(null);
  useEditorShortcuts();
  return (
    <div className="relative h-full min-h-0 flex-1 bg-canvas">
      <div ref={stage} tabIndex={0} role="region" aria-label={t("app.stage")} data-workspace={id} className="absolute inset-0 outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-select" />
      <StageToolbar />
      <StageZoom />
    </div>
  );
}
