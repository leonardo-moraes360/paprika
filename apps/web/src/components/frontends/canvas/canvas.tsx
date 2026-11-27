import { canvasBounds } from "@paprika/core";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useCamera } from "./camera";
import { runDoubleClick } from "./gestures/double-click";
import { startGesture } from "./gestures/run";
import { gestures } from "./gestures";
import { coveredBox, gridStyle, unionBox } from "./geometry";
import { useCanvasInput } from "./input";
import { useLayerMenu } from "./layer-menu";
import { RenderStoreContext, RootViews } from "./node-view";
import { overlays } from "./overlays";
import { createPreviewController } from "./preview";
import { CanvasProvider, initialCanvasState, useCanvasStore } from "./region";
import { createRenderStore } from "./render-index";
import { CanvasRuntimeContext, createRuntime, type CanvasRuntime } from "./runtime";
import type { Box, CanvasFocusRequest, CanvasInput, CanvasInputRequest, CanvasProps, Gesture } from "./types";
import { createViewStore } from "./view-store";
import { createWasmLayer, WasmCanvas } from "./wasm";
import { cn } from "@/lib/utils";

const keyOf = (input: CanvasInput) => `${input.doc?.id ?? ""}/${input.pageId ?? ""}`;

/**
 * The canvas: the page in view drawn by the DOM, a camera, the gestures and the overlays. It takes its input from a feed it
 * subscribes to itself and writes into stores that each node, outline and label reads by slice, so what changes (a delta, a
 * click, a hover, a zoom) renders only what shows it. The camera is written straight to the elements (`view-store.ts`).
 */
export function Canvas(props: CanvasProps) {
  const { feed } = props;
  return (
    <CanvasProvider
      initial={() => {
        const input = feed.get();
        return initialCanvasState({ selection: input.selection, hoveredId: input.hoveredId, tool: input.tool, renderer: input.renderer });
      }}
    >
      <CanvasBody {...props} />
    </CanvasProvider>
  );
}

function CanvasBody(props: CanvasProps) {
  const { feed, className } = props;
  const { t } = useTranslation();
  const store = useCanvasStore();
  const viewportRef = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const textRef = useRef(t);
  textRef.current = t;
  const pageRef = useRef(feed.get().pageId);
  /** The zoom the owner holds (what it gave us last, or what we told it last). */
  const ownerZoom = useRef(feed.get().zoom);
  const samplingRef = useRef(feed.get().sampling === true);
  const capturing = !!props.capture;

  const [rt] = useState<CanvasRuntime>(() => {
    const input = feed.get();
    const index = createRenderStore(input.doc, input.pageId);
    const preview = createPreviewController(store.actions, () => ({ state: store.state, doc: index.doc() }));
    const runtime = createRuntime({
      view: createViewStore(),
      index,
      store,
      preview,
      viewport: () => viewportRef.current,
      world: () => viewportRef.current?.querySelector<HTMLElement>("[data-canvas-world]") ?? null,
      pageId: () => pageRef.current,
      collab: () => latest.current.collab,
      sampling: () => samplingRef.current,
      callbacks: () => {
        const p = latest.current;
        return { select: p.onSelect, hover: p.onHover, apply: p.onApply, toolDone: p.onToolDone, error: p.onError, defaults: p.defaults, pinPoint: p.onPinPoint, pinSelect: p.onPinSelect, sample: p.onSample, text: (path, options) => (textRef.current as unknown as (key: string, options?: object) => string)(`frontends.canvas.${path}`, options) };
      },
    });
    return runtime;
  });

  // The WASM layer: made once, driven by the feed's `renderer`; it reports to the owner through the latest callbacks.
  const [wasm] = useState(() =>
    createWasmLayer({
      rt,
      loader: () => latest.current.wasm,
      onStatus: (status) => latest.current.onRendererStatus?.(status),
      onError: (message) => latest.current.onRendererError?.(message),
    }),
  );

  const camera = useCamera(
    rt,
    viewportRef,
    useCallback((zoom: number) => {
      // Only a zoom the owner does not have yet: a pan, or a fit that lands on the zoom it already holds, says nothing.
      if (Math.abs(zoom - ownerZoom.current) < 1e-9) return;
      ownerZoom.current = zoom;
      latest.current.onZoomChange?.(zoom);
    }, []),
  );

  // Taking the camera somewhere: a box in world units, or nodes whose boxes are read once they are painted (after a page change they are not there yet, so it tries for a few frames).
  const focusFrame = useRef(0);
  const cancelFocus = useCallback(() => {
    if (focusFrame.current) cancelAnimationFrame(focusFrame.current);
    focusFrame.current = 0;
  }, []);
  const startFocus = useCallback(
    (request: CanvasFocusRequest) => {
      cancelFocus();
      if (request.box) {
        camera.focus(request.box);
        return;
      }
      const ids = request.nodes ?? [];
      if (ids.length === 0) return;
      let attempts = 0;
      const attempt = () => {
        focusFrame.current = 0;
        const boxes: Box[] = [];
        for (const id of ids) {
          const box = rt.measure(id);
          if (box) boxes.push(coveredBox(box));
        }
        const all = unionBox(boxes);
        if (all) camera.focus(all);
        else if (++attempts < 40) focusFrame.current = requestAnimationFrame(attempt);
      };
      focusFrame.current = requestAnimationFrame(attempt);
    },
    [camera, rt, cancelFocus],
  );

  // The feed: what changed goes to the store that shows it. The first fit waits for the viewport to have a size (a resize observer fits again until the camera is moved).
  useLayoutEffect(() => {
    let last = feed.get();
    let key = keyOf(last);
    let fitSeen = last.fitRequest;
    let zoomSeen = last.zoom;
    let focusSeen = last.focusRequest ?? null;
    wasm.setRequested(last.renderer === "wasm");
    const viewport = viewportRef.current;
    if (viewport) viewport.dataset.tool = last.tool;
    const arm = (on: boolean) => {
      samplingRef.current = on;
      if (!viewport) return;
      if (on) viewport.dataset.sampling = "";
      else delete viewport.dataset.sampling;
    };
    arm(samplingRef.current);
    if (!latest.current.capture) camera.fit();
    const sync = () => {
      const next = feed.get();
      if (next === last) return;
      const before = last;
      last = next;
      pageRef.current = next.pageId;
      if (next.doc && (next.doc !== before.doc || next.pageId !== before.pageId)) {
        rt.index.setDoc(next.doc, next.pageId);
        rt.preview.reconcile(next.doc);
        // An editor is open on a node that is gone (another client deleted it) or that is no longer in view (another page or document): the edit ends, or `editingId` would point at nothing and hide the handles of every selection.
        const editing = store.state.editingId;
        if (editing && (!next.doc.nodes[editing] || next.pageId !== before.pageId || next.doc.id !== before.doc?.id)) store.actions.setEditing(null);
      }
      const nextKey = keyOf(next);
      if (nextKey !== key) {
        key = nextKey;
        if (!latest.current.capture) camera.fit();
      }
      if ((next.sampling === true) !== samplingRef.current) arm(next.sampling === true);
      if (next.renderer !== before.renderer) {
        store.actions.setRenderer(next.renderer);
        wasm.setRequested(next.renderer === "wasm");
      }
      store.actions.setSelection(next.selection);
      store.actions.setHovered(next.hoveredId);
      if (next.tool !== before.tool) {
        store.actions.setTool(next.tool);
        if (viewport) viewport.dataset.tool = next.tool;
      }
      const asked = next.focusRequest ?? null;
      if (asked !== focusSeen) {
        focusSeen = asked;
        if (asked) startFocus(asked);
      }
      if (next.fitRequest !== fitSeen) {
        fitSeen = next.fitRequest;
        if (!latest.current.capture) camera.fit();
      }
      if (next.zoom !== zoomSeen) {
        zoomSeen = next.zoom;
        ownerZoom.current = next.zoom;
        if (!latest.current.capture && Math.abs(next.zoom - rt.view.getTarget().zoom) > 1e-6) camera.setZoom(next.zoom);
      }
    };
    sync();
    const off = feed.subscribe(sync);
    return () => {
      off();
      cancelFocus();
    };
  }, [feed, rt, store, camera, wasm, startFocus, cancelFocus]);

  // The count of node renders, readable from the page (`?perf=1` measures, the tests count): the world element answers for it.
  useLayoutEffect(() => {
    const world = viewportRef.current?.querySelector<HTMLElement>("[data-canvas-world]");
    if (!world) return;
    Object.defineProperty(world, "__paprikaNodeRenders", { get: rt.index.renders, configurable: true });
    // Every write to the canvas store wakes each node that reads it (a selector each): a value that only an overlay reads must not make one.
    let writes = 0;
    const off = rt.store.subscribe(() => void (writes += 1));
    Object.defineProperty(world, "__paprikaStateWrites", { get: () => writes, configurable: true });
    return () => off.unsubscribe();
  }, [rt]);

  const stopGesture = useRef<(() => void) | null>(null);
  useEffect(() => {
    rt.preview.attach();
    wasm.start();
    return () => {
      wasm.stop();
      stopGesture.current?.();
      rt.preview.dispose();
      rt.view.dispose();
    };
  }, [rt, wasm]);

  const layerMenu = useLayerMenu(rt, latest);

  // `?capture=<id>`: what the server's screenshot reads. Zoom 1 with the node's corner at the origin of the screen, and its box on the viewport.
  useLayoutEffect(() => {
    const id = props.capture;
    const viewport = viewportRef.current;
    if (!id || !viewport) return;
    const place = () => {
      const doc = rt.doc();
      const node = doc.nodes[id];
      if (!node) return;
      let box: Box | null = null;
      if (node.type === "page") {
        try {
          box = canvasBounds(doc, node.id);
        } catch {
          box = null;
        }
      } else {
        const measured = rt.measure(id);
        box = measured ? coveredBox(measured) : null;
      }
      if (!box) return;
      const v = rt.view.get();
      if (!(v.zoom === 1 && v.x === -box.x && v.y === -box.y)) rt.view.set({ zoom: 1, x: -box.x, y: -box.y }, true);
      viewport.dataset.captureBox = `${box.x},${box.y},${box.width},${box.height}`;
    };
    place();
    const off = rt.index.subscribeDoc(place);
    return () => {
      off();
      delete viewport.dataset.captureBox;
    };
  }, [props.capture, rt]);

  const onInput = useCallback((request: CanvasInputRequest) => latest.current.onInput?.(request), []);
  useCanvasInput(rt, viewportRef, onInput);

  const hovered = useRef<string | null>(null);
  const grid = gridStyle(rt.view.get());

  return (
    <RenderStoreContext value={rt.index}>
      <CanvasRuntimeContext value={rt}>
        <div
          ref={viewportRef}
          tabIndex={-1}
          data-testid="viewport"
          data-viewport=""
          className={cn(
            "absolute inset-0 overflow-hidden bg-canvas contain-layout contain-paint outline-none touch-none",
            "data-[tool=frame]:cursor-crosshair data-[tool=rect]:cursor-crosshair data-[tool=ellipse]:cursor-crosshair data-[tool=text]:cursor-crosshair data-[tool=pen]:cursor-crosshair",
            "data-[sampling]:cursor-crosshair data-[sampling]:**:cursor-crosshair! data-[tool=pin]:cursor-crosshair data-[file-over]:outline-2 data-[file-over]:outline-solid data-[file-over]:-outline-offset-2 data-[file-over]:outline-select-brand",
            "data-[capture]:fixed data-[capture]:z-[100000] data-[capture]:bg-transparent",
            "data-[pan=ready]:**:cursor-grab! data-[pan=ready]:cursor-grab data-[pan=panning]:**:cursor-grabbing! data-[pan=panning]:cursor-grabbing",
            className,
          )}
          data-capture={capturing ? "" : undefined}
          style={
            capturing
              ? undefined
              : {
                  backgroundImage: "linear-gradient(to right, var(--color-grid) 1px, transparent 1px), linear-gradient(to bottom, var(--color-grid) 1px, transparent 1px)",
                  backgroundSize: grid.size,
                  backgroundPosition: grid.position,
                }
          }
          onMouseDown={(event) => {
            // The middle button would start the browser's autoscroll. A press anywhere but in a text field or an editor would also
            // start the browser's text selection over the overlays (a double click selects a word, a drag selects a range), and
            // a pointer that then drags a handle inside that selection is cancelled by the browser's own drag of it. The focus
            // goes to the viewport by hand (`onPointerDown`); the fields and editors keep their own selection.
            const text = event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable]") !== null;
            if (event.button === 1 || (event.button === 0 && !text)) event.preventDefault();
          }}
          onPointerDown={(event) => {
            viewportRef.current?.focus({ preventScroll: true });
            stopGesture.current?.();
            stopGesture.current = startGesture(rt, gestures as readonly Gesture[], event.nativeEvent);
          }}
          onPointerMove={(event) => {
            // A button down means a gesture is running (or the press went to something else): hover waits for the release.
            if (event.buttons !== 0) return;
            const id = rt.nodeAt(event.target);
            if (id === hovered.current) return;
            hovered.current = id;
            rt.hover(id);
          }}
          onDoubleClick={(event) => void runDoubleClick(rt, event.nativeEvent)}
          onContextMenu={layerMenu.onContextMenu}
          onPointerLeave={() => {
            if (hovered.current === null) return;
            hovered.current = null;
            rt.hover(null);
          }}
        >
          {/* The WASM layer, under the world: what it paints sits below the DOM's text, images and selection. */}
          <WasmCanvas layer={wasm} />
          {/* The page, painted by the DOM. `scheme-light`: a document is drawn the same in a dark app. */}
          <div data-canvas-world="" data-testid="canvas-world" className="absolute top-0 left-0 origin-top-left scheme-light [&_[data-paprika-id]]:select-none">
            <RootViews />
          </div>
          <div
            data-canvas-overlays=""
            data-testid="canvas-overlays"
            className={cn("pointer-events-none absolute top-0 left-0 origin-top-left", capturing && "hidden")}
            style={{ transform: "translate(var(--view-x, 0px), var(--view-y, 0px)) scale(var(--view-zoom, 1))" }}
          >
            {overlays.map(({ id, Component }) => (
              <Component key={id} />
            ))}
          </div>
        </div>
        {layerMenu.element}
      </CanvasRuntimeContext>
    </RenderStoreContext>
  );
}
