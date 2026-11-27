import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useCamera } from "./camera";
import { startGesture } from "./gestures/run";
import { gestures } from "./gestures";
import { gridStyle } from "./geometry";
import { RenderStoreContext, RootViews } from "./node-view";
import { overlays } from "./overlays";
import { createPreviewController } from "./preview";
import { CanvasProvider, initialCanvasState, useCanvasStore } from "./region";
import { createRenderStore } from "./render-index";
import { CanvasRuntimeContext, createRuntime, type CanvasRuntime } from "./runtime";
import type { CanvasInput, CanvasProps, Gesture } from "./types";
import { createViewStore } from "./view-store";
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
        return initialCanvasState({ selection: input.selection, hoveredId: input.hoveredId, tool: input.tool });
      }}
    >
      <CanvasBody {...props} />
    </CanvasProvider>
  );
}

function CanvasBody(props: CanvasProps) {
  const { feed, className } = props;
  const store = useCanvasStore();
  const viewportRef = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const pageRef = useRef(feed.get().pageId);
  /** The zoom the owner holds (what it gave us last, or what we told it last). */
  const ownerZoom = useRef(feed.get().zoom);

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
      callbacks: () => {
        const p = latest.current;
        return { select: p.onSelect, hover: p.onHover, apply: p.onApply, toolDone: p.onToolDone, error: p.onError };
      },
    });
    return runtime;
  });

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

  // The feed: what changed goes to the store that shows it. The first fit waits for the viewport to have a size (a resize observer fits again until the camera is moved).
  useLayoutEffect(() => {
    let last = feed.get();
    let key = keyOf(last);
    let fitSeen = last.fitRequest;
    let zoomSeen = last.zoom;
    const viewport = viewportRef.current;
    if (viewport) viewport.dataset.tool = last.tool;
    camera.fit();
    const sync = () => {
      const next = feed.get();
      if (next === last) return;
      const before = last;
      last = next;
      pageRef.current = next.pageId;
      if (next.doc && (next.doc !== before.doc || next.pageId !== before.pageId)) {
        rt.index.setDoc(next.doc, next.pageId);
        rt.preview.reconcile(next.doc);
      }
      const nextKey = keyOf(next);
      if (nextKey !== key) {
        key = nextKey;
        camera.fit();
      }
      store.actions.setSelection(next.selection);
      store.actions.setHovered(next.hoveredId);
      if (next.tool !== before.tool) {
        store.actions.setTool(next.tool);
        if (viewport) viewport.dataset.tool = next.tool;
      }
      if (next.fitRequest !== fitSeen) {
        fitSeen = next.fitRequest;
        camera.fit();
      }
      if (next.zoom !== zoomSeen) {
        zoomSeen = next.zoom;
        ownerZoom.current = next.zoom;
        if (Math.abs(next.zoom - rt.view.getTarget().zoom) > 1e-6) camera.setZoom(next.zoom);
      }
    };
    sync();
    const off = feed.subscribe(sync);
    return off;
  }, [feed, rt, store, camera]);

  // The count of node renders, readable from the page (`?perf=1` measures, the tests count): the world element answers for it.
  useLayoutEffect(() => {
    const world = viewportRef.current?.querySelector<HTMLElement>("[data-canvas-world]");
    if (!world) return;
    Object.defineProperty(world, "__paprikaNodeRenders", { get: rt.index.renders, configurable: true });
  }, [rt]);

  const stopGesture = useRef<(() => void) | null>(null);
  useEffect(
    () => () => {
      stopGesture.current?.();
      rt.preview.dispose();
      rt.view.dispose();
    },
    [rt],
  );

  const hovered = useRef<string | null>(null);
  const grid = gridStyle(rt.view.get());

  return (
    <RenderStoreContext value={rt.index}>
      <CanvasRuntimeContext value={rt}>
        <div
          ref={viewportRef}
          tabIndex={-1}
          data-testid="canvas-viewport"
          className={cn(
            "absolute inset-0 overflow-hidden bg-canvas contain-layout contain-paint outline-none touch-none",
            "data-[tool=frame]:cursor-crosshair data-[tool=rect]:cursor-crosshair data-[tool=ellipse]:cursor-crosshair data-[tool=text]:cursor-crosshair data-[tool=pen]:cursor-crosshair",
            "data-[pan=ready]:**:cursor-grab! data-[pan=ready]:cursor-grab data-[pan=panning]:**:cursor-grabbing! data-[pan=panning]:cursor-grabbing",
            className,
          )}
          style={{
            backgroundImage: "linear-gradient(to right, var(--color-grid) 1px, transparent 1px), linear-gradient(to bottom, var(--color-grid) 1px, transparent 1px)",
            backgroundSize: grid.size,
            backgroundPosition: grid.position,
          }}
          onMouseDown={(event) => {
            // The middle button would start the browser's autoscroll.
            if (event.button === 1) event.preventDefault();
          }}
          onPointerDown={(event) => {
            viewportRef.current?.focus({ preventScroll: true });
            stopGesture.current?.();
            stopGesture.current = startGesture(rt, gestures as readonly Gesture[], event.nativeEvent);
          }}
          onPointerMove={(event) => {
            if (stopGesture.current || event.buttons !== 0) return;
            const id = rt.nodeAt(event.target);
            if (id === hovered.current) return;
            hovered.current = id;
            rt.hover(id);
          }}
          onPointerLeave={() => {
            if (hovered.current === null) return;
            hovered.current = null;
            rt.hover(null);
          }}
        >
          {/* The page, painted by the DOM. `scheme-light`: a document is drawn the same in a dark app. */}
          <div data-canvas-world="" data-testid="canvas-world" className="absolute top-0 left-0 origin-top-left scheme-light [&_[data-paprika-id]]:select-none">
            <RootViews />
          </div>
          <div
            data-canvas-overlays=""
            data-testid="canvas-overlays"
            className="pointer-events-none absolute top-0 left-0 origin-top-left"
            style={{ transform: "translate(var(--view-x, 0px), var(--view-y, 0px)) scale(var(--view-zoom, 1))" }}
          >
            {overlays.map(({ id, Component }) => (
              <Component key={id} />
            ))}
          </div>
        </div>
      </CanvasRuntimeContext>
    </RenderStoreContext>
  );
}
