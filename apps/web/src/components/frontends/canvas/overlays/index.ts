import type { CanvasOverlay } from "../types";
import { AgentCursors } from "./agent-cursors";
import { BuildReplay } from "./build-replay";
import { FrameLabels } from "./frame-labels";
import { HoverOutline } from "./hover-outline";
import { PinDraft, Pins } from "./pins";
import { SelectionOutline } from "./selection-outline";

/**
 * Every overlay, bottom to top. The overlay layer is in world coordinates and carries the camera as CSS variables
 * (`--view-x`, `--view-y`, `--view-zoom`), so something that must keep its size on screen divides by `var(--view-zoom)`.
 * Each batch adds its own lines here and nothing else is shared, so a merge is the union of the lists.
 */
export const overlays: readonly CanvasOverlay[] = [
  { id: "frame-labels", Component: FrameLabels },
  { id: "hover-outline", Component: HoverOutline },
  { id: "selection-outline", Component: SelectionOutline },
  { id: "pins", Component: Pins },
  { id: "pin-draft", Component: PinDraft },
  { id: "agent-cursors", Component: AgentCursors },
  { id: "build-replay", Component: BuildReplay },
];
