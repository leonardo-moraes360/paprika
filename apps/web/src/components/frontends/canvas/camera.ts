import { canvasBounds } from "@paprika/core";
import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { fitView, focusView, gridStyle, wheelPan, wheelZoom, zoomAround } from "./geometry";
import type { CanvasRuntime } from "./runtime";
import type { Box, View } from "./types";

export type CameraController = {
  /** Fits the page in view. Returns `false` when the viewport has no size yet. */
  fit: () => boolean;
  /** Zooms to `zoom` around the centre of the viewport. */
  setZoom: (zoom: number) => void;
  /** Centres `box` (world units) in the viewport. */
  focus: (box: Box) => void;
  /** The camera was moved by the person since the last fit. */
  moved: () => boolean;
};

const typing = (target: EventTarget | null) =>
  target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || (target instanceof HTMLElement && target.isContentEditable);

/** A key press that goes to a focused control the person reached with the keyboard (Space there is a click, not a pan). */
const keyboardFocus = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement) || target === document.body) return false;
  try {
    return target.matches(":focus-visible");
  } catch {
    return false;
  }
};

/**
 * The camera of a canvas: the wheel (pan, Shift for the other axis, Ctrl/Cmd for zoom at the cursor), Space for panning,
 * the viewport's size, and what the owner asks (`fit`, `setZoom`). Everything lands in the view store, so none of it is React state.
 */
export function useCamera(rt: CanvasRuntime, viewportRef: RefObject<HTMLElement | null>, onSettledZoom: (zoom: number) => void): CameraController {
  const settledZoom = useRef(onSettledZoom);
  settledZoom.current = onSettledZoom;
  const state = useRef<{ moved: boolean; controller: CameraController | null }>({ moved: false, controller: null });

  if (!state.current.controller) {
    const size = () => {
      const el = viewportRef.current;
      const rect = el?.getBoundingClientRect();
      return rect && rect.width > 0 && rect.height > 0 ? rect : null;
    };
    state.current.controller = {
      fit: () => {
        const rect = size();
        if (!rect) return false;
        let bounds: Box;
        try {
          bounds = canvasBounds(rt.doc(), rt.pageId() ?? undefined);
        } catch {
          bounds = { x: 0, y: 0, width: 800, height: 600 };
        }
        rt.view.set(fitView(bounds, rect), true);
        state.current.moved = false;
        return true;
      },
      setZoom: (zoom) => {
        const rect = size();
        if (!rect) return;
        rt.view.set((v) => zoomAround(v, rect.width / 2, rect.height / 2, zoom));
      },
      focus: (box) => {
        const rect = size();
        if (!rect) return;
        rt.view.set((v) => focusView(box, rect, v));
      },
      moved: () => state.current.moved,
    };
  }
  const controller = state.current.controller;

  // The world and the overlay layer follow the store; the grid follows too (one style write per frame).
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const world = viewport.querySelector<HTMLElement>("[data-canvas-world]");
    const overlay = viewport.querySelector<HTMLElement>("[data-canvas-overlays]");
    rt.view.attach({ world, overlay });
    const grid = (v: View) => {
      const { size, position } = gridStyle(v);
      viewport.style.backgroundSize = size;
      viewport.style.backgroundPosition = position;
    };
    grid(rt.view.get());
    const offFrame = rt.view.onFrame(grid);
    return () => {
      offFrame();
      rt.view.attach(null);
    };
  }, [rt, viewportRef]);

  // Zoom at rest goes to the owner.
  useEffect(() => rt.view.onSettled((v) => settledZoom.current(v.zoom)), [rt]);

  // Any move of the camera counts as the person's (`fit` clears it again): a later resize then leaves the camera where it is.
  useEffect(
    () =>
      rt.view.onFrame(() => {
        state.current.moved = true;
      }),
    [rt],
  );

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const rect = viewport.getBoundingClientRect();
        rt.view.set((v) => wheelZoom(v, e.clientX - rect.left, e.clientY - rect.top, e.deltaY));
      } else rt.view.set((v) => wheelPan(v, e.deltaX, e.deltaY, e.shiftKey));
    };
    viewport.addEventListener("wheel", onWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", onWheel);
  }, [rt, viewportRef]);

  useEffect(() => {
    const isSpace = (e: KeyboardEvent) => e.code === "Space";
    const down = (e: KeyboardEvent) => {
      if (!isSpace(e) || typing(e.target) || keyboardFocus(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      e.preventDefault();
      if (rt.input.space) return;
      rt.input.space = true;
      if (rt.viewport()?.dataset.pan !== "panning") rt.setPan("ready");
    };
    const release = () => {
      rt.input.space = false;
      if (rt.viewport()?.dataset.pan === "ready") rt.setPan("off");
    };
    const up = (e: KeyboardEvent) => {
      if (isSpace(e)) release();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", release);
    };
  }, [rt]);

  // The first fit may happen before the layout settles (panels restoring their size): until the person moves the camera, a resize fits again.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      // A capture (`?capture=`) owns the camera: the server's screenshot reads the node where it put it.
      if (!state.current.moved && !viewport.hasAttribute("data-capture")) controller.fit();
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [controller, viewportRef]);

  return controller;
}
