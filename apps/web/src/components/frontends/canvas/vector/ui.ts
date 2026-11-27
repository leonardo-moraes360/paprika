import type { Gradient } from "@paprika/core";
import type { AnchorRef, Subpath } from "@paprika/core";
import type { CanvasRuntime, Pt } from "../types";
import type { PenDraft } from "./pen";

/** The keys of `region.ui` this batch writes (one each, named after the piece). */
export const UI_PEN = "pen";
export const UI_PATH_EDIT = "pathEdit";
export const UI_LINK = "link";
export const UI_GRADIENT = "gradient";

/** A path in edit mode: which node, the selected anchor and, while a point is dragged, the outline as it would be (in the path's own coordinates). */
export type PathEditUi = { id: string; sel: AnchorRef | null; draft: Subpath[] | null };
/** The arrow being drawn: its two ends in the world. */
export type LinkUi = { from: Pt; to: Pt };
/** A gradient being dragged (or waiting for its echo): the node and the gradient it shows. */
export type GradientUi = { id: string; gradient: Gradient; acked: boolean; /** The document version when the server took it. */ at: number };

type Slots = { [UI_PEN]: PenDraft | null; [UI_PATH_EDIT]: PathEditUi | null; [UI_LINK]: LinkUi | null; [UI_GRADIENT]: GradientUi | null };

export const readUi = <K extends keyof Slots>(rt: Pick<CanvasRuntime, "store">, key: K): Slots[K] => (rt.store.state.ui[key] as Slots[K] | undefined) ?? null;
export const writeUi = <K extends keyof Slots>(rt: Pick<CanvasRuntime, "store">, key: K, value: Slots[K]) => rt.store.actions.setUi(key, value);
