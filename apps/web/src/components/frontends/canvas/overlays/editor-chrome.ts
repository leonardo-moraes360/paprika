import type { KeyboardEvent as ReactKeyboardEvent } from "react";

/** The keys that confirm a text editor: Escape and Ctrl or Cmd with Enter. */
export const confirmKey = (e: ReactKeyboardEvent) => e.key === "Escape" || ((e.metaKey || e.ctrlKey) && e.key === "Enter");

/** Class of the dashed outline an editor draws around itself; the width stays one screen pixel at any zoom. */
export const editorOutline = "outline-select outline-dashed";
export const editorOutlineStyle = { outlineWidth: "calc(1px / var(--view-zoom))" } as const;
