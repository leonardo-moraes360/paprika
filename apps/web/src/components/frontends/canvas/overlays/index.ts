import type { CanvasOverlay } from "../types";
import { AgentCursors } from "./agent-cursors";
import { BuildReplay } from "./build-replay";
import { ConnectorHandles, LinkDraft } from "./connector-handles";
import { ConnectorLabelEditor } from "./connector-label-editor";
import { CreateGhost } from "./create-ghost";
import { DropMarker } from "./drop-marker";
import { FrameLabels } from "./frame-labels";
import { GradientHandles } from "./gradient-handles";
import { SelectionHandlesOverlay } from "./handles";
import { HoverOutline } from "./hover-outline";
import { MarqueeBox } from "./marquee-box";
import { PathEditOverlay } from "./path-edit";
import { PenDraftOverlay } from "./pen-draft";
import { PinDraft, Pins } from "./pins";
import { SelectionOutline } from "./selection-outline";
import { ShapeTextEditor } from "./shape-text-editor";
import { SpacingHandles } from "./spacing-handles";
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
  // What a gesture draws while it runs (never interactive).
  { id: "drop-marker", Component: DropMarker },
  { id: "marquee-box", Component: MarqueeBox },
  { id: "create-ghost", Component: CreateGhost },
  { id: "pen-draft", Component: PenDraftOverlay },
  { id: "link-draft", Component: LinkDraft },
  // The handles of what is selected.
  { id: "selection-handles", Component: SelectionHandlesOverlay },
  { id: "path-edit", Component: PathEditOverlay },
  { id: "connector-handles", Component: ConnectorHandles },
  { id: "gradient-handles", Component: GradientHandles },
  { id: "spacing-handles", Component: SpacingHandles },
  // Pins and the pin being drawn.
  { id: "pins", Component: Pins },
  { id: "pin-draft", Component: PinDraft },
  // The editors, over everything.
  { id: "text-editor", Component: TextEditor },
  { id: "shape-text-editor", Component: ShapeTextEditor },
  { id: "connector-label-editor", Component: ConnectorLabelEditor },
  // Other people and agents, and what they are building.
  { id: "build-replay", Component: BuildReplay },
  { id: "agent-cursors", Component: AgentCursors },
];
