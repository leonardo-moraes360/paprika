import { firstPage } from "@paprika/core";
import type { CanvasRuntime } from "../types";

/** The page in view: the one the owner chose, or the first one. */
export const pageOf = (rt: Pick<CanvasRuntime, "pageId" | "doc">): string | null => rt.pageId() ?? firstPage(rt.doc())?.id ?? null;

/** The keys a text field owns. A canvas key stands aside from them. */
export function typing(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || (target instanceof HTMLElement && target.isContentEditable);
}
