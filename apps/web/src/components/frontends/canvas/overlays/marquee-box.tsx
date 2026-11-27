import { useCanvasState } from "../region";
import type { Box } from "../types";

/** The box being dragged on the empty page (the marquee gesture writes it in world units). */
export function MarqueeBox() {
  const box = useCanvasState((s) => (s.ui.marquee ?? null) as Box | null);
  if (!box) return null;
  return (
    <div
      data-testid="marquee"
      className="pointer-events-none absolute border-select-brand bg-select-brand/10"
      style={{ left: box.x, top: box.y, width: box.width, height: box.height, borderWidth: "calc(1px / var(--view-zoom))" }}
    />
  );
}
