import type { CanvasOverlay } from "../types";
import { ConnectorLabelEditor } from "./connector-label-editor";
import { CreateGhost } from "./create-ghost";
import { FrameLabels } from "./frame-labels";
import { HoverOutline } from "./hover-outline";
import { SelectionOutline } from "./selection-outline";
import { ShapeTextEditor } from "./shape-text-editor";
import { TextEditor } from "./text-editor";

/**
 * Every overlay, bottom to top. The overlay layer is in world coordinates and carries the camera as CSS variables
 * (`--view-x`, `--view-y`, `--view-zoom`), so something that must keep its size on screen divides by `var(--view-zoom)`.
 * Each batch adds its own lines here and nothing else is shared, so a merge is the union of the lists.
 */
export const overlays: readonly CanvasOverlay[] = [
  { id: "frame-labels", Component: FrameLabels },
  { id: "hover-outline", Component: HoverOutline },
  { id: "selection-outline", Component: SelectionOutline },
  { id: "create-ghost", Component: CreateGhost },
  { id: "text-editor", Component: TextEditor },
  { id: "shape-text-editor", Component: ShapeTextEditor },
  { id: "connector-label-editor", Component: ConnectorLabelEditor },
];
