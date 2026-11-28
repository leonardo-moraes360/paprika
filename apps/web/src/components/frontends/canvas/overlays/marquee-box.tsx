import { useOverlayValue } from "../overlay-bus";
import type { Box } from "../types";
import { ring } from "./stroke";

const EDGE = ring(1, "var(--color-select-brand)");

/** The box being dragged on the empty page (the marquee gesture writes it in world units). */
export function MarqueeBox() {
  const box = useOverlayValue<Box>("marquee");
  if (!box) return null;
  return (
    <div
      data-testid="marquee"
      className="pointer-events-none absolute bg-select-brand/10"
      style={{ left: box.x, top: box.y, width: box.width, height: box.height, ...EDGE }}
    />
  );
}
