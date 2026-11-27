import { useHotkeys } from "@tanstack/react-hotkeys";
import { useMemo } from "react";
import { useEditorStore, type EditorTool } from "./editor-store";
import { NUDGE, NUDGE_BIG } from "@/adapters/selection-ops";
import { useHistoryActions } from "./use-history-actions";
import { useSelectionActions } from "./use-selection-actions";

/**
 * The editor's global keys: the same ones as the old app that make sense without a canvas. They listen on the document
 * while the editor is mounted. Where each group is valid is stated positively (`KeyScope`), not as a list of exceptions:
 * - `app` keys (undo and redo, toggling history, import, export and pins, closing an open panel with Esc) act anywhere in
 *   the editor;
 * - `edit` keys act on the selection (Delete and Backspace, Ctrl+A/G/D, Alt+C, the selection part of Esc) and only with the
 *   focus on the page (nothing focused), on the stage, in the layers tree or on the stage toolbar. In the history, the pins,
 *   the properties, the pages, the header or any other panel they do nothing, so Delete there never deletes a node;
 * - `arrows` are `edit` keys that also leave a widget that moves the focus with them (tree, tab list, slider, ...) alone;
 * - `letters` are `edit` keys (tools) that also leave the layers tree alone: its typeahead owns single letters.
 * Every group stands aside when the key already did something (`defaultPrevented`), while composing text, in a text
 * field (the hotkeys library skips inputs, textareas, selects and contenteditable) and inside a dialog, menu, list box,
 * tooltip or combo box, which own their Esc, arrows and Enter. The toolbar's own `shortcuts` are turned off: this table
 * is the single owner of every key.
 */
export type KeyScope = "app" | "edit" | "arrows" | "letters";

export const toolHotkeys: Record<string, EditorTool> = {
  V: "select",
  F: "frame",
  R: "rect",
  O: "ellipse",
  T: "text",
  P: "pen",
  S: "shape",
  D: "diamond",
  G: "triangle",
  C: "cylinder",
  B: "parallelogram",
  U: "cloud",
  A: "connector",
  N: "note",
  I: "pin",
};

/** The documentation of the table (the report prints it): key, what it does. */
export const shortcutTable = [
  ["Mod+Z", "undo own"],
  ["Mod+Shift+Z, Mod+Y", "redo own"],
  ["Mod+H", "toggle history"],
  ["Mod+O", "open import"],
  ["Mod+E", "open export"],
  ["Mod+A", "select all (siblings of the selection, or the page)"],
  ["Mod+G", "group"],
  ["Mod+Alt+G", "wrap in frame"],
  ["Mod+Shift+G", "ungroup"],
  ["Mod+D", "duplicate"],
  ["Alt+C", "center content"],
  ["Delete, Backspace", "delete"],
  ["Escape", "close history, else close pins, else tool select and parent selected"],
  ["Arrows, Shift+Arrows", "move 1 px, 10 px"],
  ["Shift+I", "toggle pins"],
  ["V F R O T P S D G C B U A N I", "tools"],
] as const;

const OWNS_KEYS = '[role="dialog"],[role="alertdialog"],[role="menu"],[role="menubar"],[role="listbox"],[role="tooltip"],[role="combobox"]';
const OWNS_ARROWS = '[role="tree"],[role="tablist"],[role="radiogroup"],[role="toolbar"],[role="slider"],[role="spinbutton"],[role="grid"],[role="listbox"],[role="menu"],[role="menubar"],[role="combobox"],[role="separator"]';
/** Where the keys that edit the selection live: the stage (it carries `data-workspace`), the layers tree and the stage toolbar. */
const EDIT_SURFACE = '[role="region"][data-workspace],[role="tree"],[role="toolbar"]';

export function targetOf(event: KeyboardEvent): Element | null {
  return event.target instanceof Element ? event.target : null;
}

/** True when the focus is where the keys that edit the selection are valid (see `KeyScope`). */
export function onEditSurface(target: Element | null): boolean {
  return target === null || target === document.body || target === document.documentElement || target.closest(EDIT_SURFACE) !== null;
}

/** True when the editor must leave this key alone. */
export function standsAside(event: KeyboardEvent, scope: KeyScope = "app"): boolean {
  if (event.defaultPrevented || event.isComposing) return true;
  const target = targetOf(event);
  if (target?.closest(OWNS_KEYS)) return true;
  if (scope === "app") return false;
  if (!onEditSurface(target)) return true;
  if (!target) return false;
  if (scope === "arrows") return target.closest(OWNS_ARROWS) !== null;
  // The layers tree jumps to the layer that starts with the letter typed (typeahead): single letters are its own there.
  return scope === "letters" && target.closest('[role="tree"]') !== null;
}

export function useEditorShortcuts() {
  const editor = useEditorStore();
  const selection = useSelectionActions();
  const history = useHistoryActions();

  const definitions = useMemo(() => {
    const act = (action: () => void, scope: KeyScope) => (event: KeyboardEvent) => {
      if (standsAside(event, scope)) return;
      event.preventDefault();
      action();
    };
    const { actions } = editor;
    const nudge = (dx: number, dy: number) => act(() => void selection.nudge(dx, dy), "arrows");
    const list: { hotkey: string; callback: (event: KeyboardEvent) => void }[] = [
      { hotkey: "Mod+Z", callback: act(() => void history.undoOwn(), "app") },
      { hotkey: "Mod+Shift+Z", callback: act(() => void history.redoOwn(), "app") },
      { hotkey: "Mod+Y", callback: act(() => void history.redoOwn(), "app") },
      { hotkey: "Mod+H", callback: act(() => actions.toggleDialog("history"), "app") },
      { hotkey: "Mod+O", callback: act(() => actions.openDialog("import"), "app") },
      { hotkey: "Mod+E", callback: act(() => actions.openDialog("export"), "app") },
      { hotkey: "Mod+A", callback: act(selection.selectAll, "edit") },
      { hotkey: "Mod+G", callback: act(() => void selection.group(), "edit") },
      { hotkey: "Mod+Alt+G", callback: act(() => void selection.wrap(), "edit") },
      { hotkey: "Mod+Shift+G", callback: act(() => void selection.ungroup(), "edit") },
      { hotkey: "Mod+D", callback: act(() => void selection.duplicate(), "edit") },
      { hotkey: "Alt+C", callback: act(() => void selection.center(), "edit") },
      { hotkey: "Delete", callback: act(() => void selection.remove(), "edit") },
      { hotkey: "Backspace", callback: act(() => void selection.remove(), "edit") },
      {
        hotkey: "Escape",
        callback: (event) => {
          // Closing an open panel is an `app` key; stepping the selection up is an `edit` key.
          if (standsAside(event, "app")) return;
          const { dialogs } = editor.state;
          if (dialogs.history) actions.closeDialog("history");
          else if (dialogs.pins) actions.closeDialog("pins");
          else if (!standsAside(event, "edit")) selection.escape();
        },
      },
      { hotkey: "ArrowLeft", callback: nudge(-NUDGE, 0) },
      { hotkey: "ArrowRight", callback: nudge(NUDGE, 0) },
      { hotkey: "ArrowUp", callback: nudge(0, -NUDGE) },
      { hotkey: "ArrowDown", callback: nudge(0, NUDGE) },
      { hotkey: "Shift+ArrowLeft", callback: nudge(-NUDGE_BIG, 0) },
      { hotkey: "Shift+ArrowRight", callback: nudge(NUDGE_BIG, 0) },
      { hotkey: "Shift+ArrowUp", callback: nudge(0, -NUDGE_BIG) },
      { hotkey: "Shift+ArrowDown", callback: nudge(0, NUDGE_BIG) },
      { hotkey: "Shift+I", callback: act(() => actions.toggleDialog("pins"), "app") },
    ];
    for (const [key, tool] of Object.entries(toolHotkeys)) list.push({ hotkey: key, callback: act(() => actions.setTool(tool), "letters") });
    return list;
  }, [editor, selection, history]);

  useHotkeys(
    definitions.map(({ hotkey, callback }) => ({ hotkey: hotkey as never, callback: (event: KeyboardEvent) => callback(event) })),
    { target: typeof document === "undefined" ? undefined : document, ignoreInputs: true, preventDefault: false, stopPropagation: false },
  );
}

