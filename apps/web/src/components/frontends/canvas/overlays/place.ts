import type { NodeBox } from "../types";

/** Puts an overlay element over a box in world units by writing its style directly: a measured box never goes through React state. */
export function placeBox(el: HTMLElement | null, box: NodeBox | null) {
  if (!el) return;
  if (!box) {
    el.style.display = "none";
    return;
  }
  el.style.display = "block";
  el.style.left = `${box.x}px`;
  el.style.top = `${box.y}px`;
  el.style.width = `${box.width}px`;
  el.style.height = `${box.height}px`;
  el.style.transform = box.rotation ? `rotate(${box.rotation}deg)` : "";
}
