import type { CanvasOverlay } from "../types";
import { ConnectorHandles, LinkDraft } from "./connector-handles";
import { FrameLabels } from "./frame-labels";
import { GradientHandles } from "./gradient-handles";
import { PathEditOverlay } from "./path-edit";
import { PenDraftOverlay } from "./pen-draft";
import { SpacingHandles } from "./spacing-handles";
import { HoverOutline } from "./hover-outline";
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
  { id: "pen-draft", Component: PenDraftOverlay },
  { id: "path-edit", Component: PathEditOverlay },
  { id: "link-draft", Component: LinkDraft },
  { id: "connector-handles", Component: ConnectorHandles },
  { id: "gradient-handles", Component: GradientHandles },
  { id: "spacing-handles", Component: SpacingHandles },
];
