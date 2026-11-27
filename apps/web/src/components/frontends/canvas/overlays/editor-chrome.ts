import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { dashedRing, dashedRingVars } from "./stroke";

/** The keys that confirm a text editor: Escape and Ctrl or Cmd with Enter. */
export const confirmKey = (e: ReactKeyboardEvent) => e.key === "Escape" || ((e.metaKey || e.ctrlKey) && e.key === "Enter");

/** The dashed ring an editor draws around itself (a style); the width stays one screen pixel at any zoom. */
export const editorOutlineStyle = dashedRing(1, "var(--color-select-brand)");
/** The same ring for a component that takes classes (`editorOutlineClass` reads it), the custom properties go on an ancestor. */
export const editorOutlineVars = dashedRingVars(1, "var(--color-select-brand)");
export const editorOutlineClass = "bg-(image:--ring-image) bg-(size:--ring-size) bg-(position:--ring-position) bg-no-repeat";
