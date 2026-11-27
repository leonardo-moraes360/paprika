/**
 * Custom properties that the UI SDK registers with `CSS.registerProperty` while it runs (`registerUninherited`): the
 * scroll area's frame variables and the positioner's room variables. It defers that to an idle moment after the first
 * paint, which in the editor falls AFTER the canvas has mounted its nodes, and every registration invalidates the style
 * of the whole document. Registering them from the page's head, with no nodes yet, costs nothing; the UI SDK's own call
 * for a name that is registered already throws and it ignores that. `src/routes/shell-properties.test.tsx` checks the list against the library.
 */
export const SHELL_PROPERTIES = [
  "--scroll-area-overflow-x-start",
  "--scroll-area-overflow-x-end",
  "--scroll-area-progress-x",
  "--scroll-area-overflow-y-start",
  "--scroll-area-overflow-y-end",
  "--scroll-area-progress-y",
  "--available-height",
  "--available-width",
] as const;

/** Runs in the head, before any module: the same definition as the UI SDK's (`syntax: "*"`, not inherited). */
export const registerShellPropertiesScript = `try{for(const n of ${JSON.stringify(SHELL_PROPERTIES)}){try{CSS.registerProperty({name:n,syntax:"*",inherits:false})}catch(e){}}}catch(e){}`;
