import { copyOwner, isContainer, isInstance, isSVGText, type Document, type Node as DocNode } from "@paprika/core";
import { useEffect, type RefObject } from "react";
import { elementOf } from "./geometry";
import type { CanvasRuntime } from "./runtime";
import type { CanvasInputRequest, Pt } from "./types";

const rasterType = /^image\/(png|jpe?g|webp|avif|gif)$/i;
const rasterName = /\.(png|jpe?g|webp|avif|gif)$/i;
const isRaster = (file: File) => rasterType.test(file.type) || rasterName.test(file.name);

/** A picture on the clipboard (a screenshot, "copy image"): a file the browser lists, or an item of the clipboard that is one. */
export function clipboardFiles(data: DataTransfer): File[] {
  const out: File[] = [];
  for (const file of data.files) if (isRaster(file)) out.push(file);
  if (out.length > 0) return out;
  for (const item of data.items) {
    if (item.kind !== "file" || !rasterType.test(item.type)) continue;
    const file = item.getAsFile();
    if (file) out.push(file);
  }
  return out;
}

/** A frame that takes things dropped into it: not a copy of a component, nor something inside one. */
const takesDrops = (doc: Document, node: DocNode | undefined): boolean => !!node && isContainer(node) && node.type !== "page" && !isInstance(node) && !copyOwner(doc, node);

/** The point of the screen in the coordinates a child of `parentId` uses (the page: the world). Like the old canvas, it reads the parent's box on the screen. */
export function localPoint(rt: CanvasRuntime, parentId: string | null, clientX: number, clientY: number): Pt {
  const viewport = rt.viewport();
  const rect = viewport?.getBoundingClientRect();
  const view = rt.view.get();
  let left = (rect?.left ?? 0) + view.x;
  let top = (rect?.top ?? 0) + view.y;
  const el = parentId && viewport ? elementOf(viewport, parentId) : null;
  if (el) {
    const r = el.getBoundingClientRect();
    left = r.left;
    top = r.top;
  }
  return { x: (clientX - left) / view.zoom, y: (clientY - top) / view.zoom };
}

/** Where a paste goes: into the selected frame when exactly one is selected, else onto the page; at the middle of what is in view. */
export function pasteDestination(rt: CanvasRuntime): { parentId: string | null; at: Pt } | null {
  const viewport = rt.viewport();
  if (!viewport) return null;
  const doc = rt.doc();
  const selection = rt.selection();
  const selected = selection.length === 1 ? doc.nodes[selection[0] as string] : undefined;
  const parentId = selected?.type === "frame" && takesDrops(doc, selected) ? selected.id : null;
  const rect = viewport.getBoundingClientRect();
  const at = localPoint(rt, parentId, rect.left + rect.width / 2, rect.top + rect.height / 2);
  return { parentId, at: { x: Math.round(at.x), y: Math.round(at.y) } };
}

/** Where a drop goes: the frame or group under the pointer that takes it (the old canvas' rule), else the page. */
export function dropDestination(rt: CanvasRuntime, clientX: number, clientY: number): { parentId: string | null; at: Pt } {
  const viewport = rt.viewport();
  const doc = rt.doc();
  let parentId: string | null = null;
  if (viewport) {
    for (const el of document.elementsFromPoint(clientX, clientY)) {
      if (!viewport.contains(el)) continue;
      const id = el.closest("[data-paprika-id]")?.getAttribute("data-paprika-id");
      const node = id ? doc.nodes[id] : undefined;
      if (!id || !node) continue;
      if (takesDrops(doc, node)) {
        parentId = id;
        break;
      }
      const parent = node.parentId ? doc.nodes[node.parentId] : undefined;
      if (parent && takesDrops(doc, parent)) {
        parentId = parent.id;
        break;
      }
    }
  }
  const at = localPoint(rt, parentId, clientX, clientY);
  return { parentId, at: { x: Math.round(at.x), y: Math.round(at.y) } };
}

const hasFiles = (event: DragEvent) => !!event.dataTransfer && [...event.dataTransfer.types].includes("Files");

const editable = (target: EventTarget | null) => target instanceof Element && !!target.closest("input, textarea, select, [contenteditable]");

/**
 * What the canvas takes from the browser: a paste (a picture, SVG, HTML) anywhere but in a text field, and files dropped on it.
 * The canvas only reads the event and where it landed; the owner converts it, sends the ops and says why when it cannot.
 * Highlighting the drop is an attribute on the viewport (`data-file-over`), never state.
 */
export function useCanvasInput(rt: CanvasRuntime, viewportRef: RefObject<HTMLElement | null>, onInput: (request: CanvasInputRequest) => void): void {
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      if (editable(event.target)) return;
      const data = event.clipboardData;
      if (!data) return;
      const plain = data.getData("text/plain").trim();
      const html = data.getData("text/html");
      const svg = isSVGText(plain);
      const files = svg ? [] : clipboardFiles(data);
      if (!svg && files.length === 0 && !html.trim()) return;
      const where = pasteDestination(rt);
      if (!where) return;
      event.preventDefault();
      onInput({ kind: "paste", plain, html, files, ...where });
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [rt, onInput]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const over = (on: boolean) => {
      if (on) viewport.dataset.fileOver = "";
      else delete viewport.dataset.fileOver;
    };
    const onDrag = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      over(true);
    };
    const onLeave = (event: DragEvent) => {
      if (event.target === viewport || !viewport.contains(event.relatedTarget as Node | null)) over(false);
    };
    const onDrop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      over(false);
      const files = [...(event.dataTransfer?.files ?? [])];
      if (files.length === 0) return;
      onInput({ kind: "drop", plain: "", html: "", files, ...dropDestination(rt, event.clientX, event.clientY) });
    };
    viewport.addEventListener("dragenter", onDrag);
    viewport.addEventListener("dragover", onDrag);
    viewport.addEventListener("dragleave", onLeave);
    viewport.addEventListener("drop", onDrop);
    return () => {
      viewport.removeEventListener("dragenter", onDrag);
      viewport.removeEventListener("dragover", onDrag);
      viewport.removeEventListener("dragleave", onLeave);
      viewport.removeEventListener("drop", onDrop);
      over(false);
    };
  }, [rt, viewportRef, onInput]);
}
