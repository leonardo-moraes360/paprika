import { useState } from "react";
import { cn } from "@/lib/utils";
import { useCanvasState } from "../region";
import type { WasmLayer } from "./layer";

/**
 * The `<canvas>` the WASM layer draws on, UNDER the world (an earlier sibling in the same stacking context): the DOM paints text,
 * images, selection and everything the layer cannot draw above it. It mounts the first time WASM is asked for and then stays
 * (hidden while the DOM paints), so going back and forth does not make a new device. The layer writes `data-backend`,
 * `data-detail` and `data-creates` on it by itself: the server's screenshot waits for them.
 */
export function WasmCanvas({ layer }: { layer: WasmLayer }) {
  const wasm = useCanvasState((s) => s.renderer === "wasm");
  const [retain, setRetain] = useState(wasm);
  if (wasm && !retain) setRetain(true);
  if (!retain) return null;
  return <canvas ref={layer.setCanvas} data-testid="wasm-layer" aria-hidden="true" className={cn("pointer-events-none absolute inset-0 size-full", !wasm && "invisible")} />;
}
