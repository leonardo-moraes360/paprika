import { useHotkeys } from "@tanstack/react-hotkeys";
import { useMemo } from "react";
import { useEditorStore, type EditorTool } from "./editor-store";
import { NUDGE, NUDGE_BIG } from "@/adapters/selection-ops";
import { useHistoryActions } from "./use-history-actions";
import { useSelectionActions } from "./use-selection-actions";

/**
 * The editor's global keys: the same ones as the old app that make sense without a canvas. They listen on the document
 * while the editor is mounted and stand aside (so the browser or the widget keeps the key) when:
 * - the focus is in a text field (the hotkeys library skips inputs, textareas, selects and contenteditable);
 * - the key already did something (`defaultPrevented`: the layers panel's own Alt+Arrow, Ctrl+Shift+H/L, F2, ...);
 * - the focus is inside a dialog, a menu, a list box or a tooltip (they own their Esc, arrows and Enter).
 * Single tool letters also stand aside inside the layers tree (its typeahead owns them). Arrow keys also stand aside inside a tree, a tab list, a radio group, a toolbar, a slider and the like, where they
 * move the focus. The toolbar's own `shortcuts` are turned off: this table is the single owner of every key.
 */

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
  ["Escape", "close history, else tool select and parent selected"],
  ["Arrows, Shift+Arrows", "move 1 px, 10 px"],
  ["Shift+I", "toggle pins"],
  ["V F R O T P S D G C B U A N I", "tools"],
] as const;

const OWNS_KEYS = '[role="dialog"],[role="alertdialog"],[role="menu"],[role="menubar"],[role="listbox"],[role="tooltip"],[role="combobox"]';
const OWNS_ARROWS = '[role="tree"],[role="tablist"],[role="radiogroup"],[role="toolbar"],[role="slider"],[role="spinbutton"],[role="grid"],[role="listbox"],[role="menu"],[role="menubar"],[role="combobox"],[role="separator"]';

export function targetOf(event: KeyboardEvent): Element | null {
  return event.target instanceof Element ? event.target : null;
}

/** True when the editor must leave this key alone. */
export function standsAside(event: KeyboardEvent, scope: "none" | "arrows" | "letters" = "none"): boolean {
  if (event.defaultPrevented || event.isComposing) return true;
  const target = targetOf(event);
  if (!target) return false;
  if (target.closest(OWNS_KEYS)) return true;
  if (scope === "arrows") return target.closest(OWNS_ARROWS) !== null;
  // The layers tree jumps to the layer that starts with the letter typed (typeahead): single letters are its own there.
  return scope === "letters" && target.closest('[role="tree"]') !== null;
}

export function useEditorShortcuts() {
  const editor = useEditorStore();
  const selection = useSelectionActions();
  const history = useHistoryActions();

  const definitions = useMemo(() => {
    const act = (action: () => void, scope: "none" | "arrows" | "letters" = "none") => (event: KeyboardEvent) => {
      if (standsAside(event, scope)) return;
      event.preventDefault();
      action();
    };
    const { actions } = editor;
    const nudge = (dx: number, dy: number) => act(() => void selection.nudge(dx, dy), "arrows");
    const list: { hotkey: string; callback: (event: KeyboardEvent) => void }[] = [
      { hotkey: "Mod+Z", callback: act(() => void history.undoOwn()) },
      { hotkey: "Mod+Shift+Z", callback: act(() => void history.redoOwn()) },
      { hotkey: "Mod+Y", callback: act(() => void history.redoOwn()) },
      { hotkey: "Mod+H", callback: act(() => actions.toggleDialog("history")) },
      { hotkey: "Mod+O", callback: act(() => actions.openDialog("import")) },
      { hotkey: "Mod+E", callback: act(() => actions.openDialog("export")) },
      { hotkey: "Mod+A", callback: act(selection.selectAll) },
      { hotkey: "Mod+G", callback: act(() => void selection.group()) },
      { hotkey: "Mod+Alt+G", callback: act(() => void selection.wrap()) },
      { hotkey: "Mod+Shift+G", callback: act(() => void selection.ungroup()) },
      { hotkey: "Mod+D", callback: act(() => void selection.duplicate()) },
      { hotkey: "Alt+C", callback: act(() => void selection.center()) },
      { hotkey: "Delete", callback: act(() => void selection.remove()) },
      { hotkey: "Backspace", callback: act(() => void selection.remove()) },
      {
        hotkey: "Escape",
        callback: (event) => {
          if (standsAside(event)) return;
          if (editor.state.dialogs.history) actions.closeDialog("history");
          else selection.escape();
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
      { hotkey: "Shift+I", callback: act(() => actions.toggleDialog("pins")) },
    ];
    for (const [key, tool] of Object.entries(toolHotkeys)) list.push({ hotkey: key, callback: act(() => actions.setTool(tool), "letters") });
    return list;
  }, [editor, selection, history]);

  useHotkeys(
    definitions.map(({ hotkey, callback }) => ({ hotkey: hotkey as never, callback: (event: KeyboardEvent) => callback(event) })),
    { target: typeof document === "undefined" ? undefined : document, ignoreInputs: true, preventDefault: false, stopPropagation: false },
  );
}

