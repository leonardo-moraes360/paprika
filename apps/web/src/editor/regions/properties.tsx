import { useFormatForDisplay } from "@tanstack/react-hotkeys";
import { memo, startTransition, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { documentFonts } from "@/adapters/doc-fonts";
import { panelInput, type PanelInput } from "@/adapters/properties";
import { FontPicker } from "@/components/frontends/font-picker";
import { PropertiesPanel, type FontPickerSlot, type PropertiesPanelProps, type PropertiesPanelShortcuts } from "@/components/frontends/properties-panel";
import { useDocLint } from "@/data/lint";
import { isOfflineError, shallow, useLive, useLiveActions, useLiveClient } from "@/data/live";
import { showStatusToast } from "@/lib/notify";
import { errorText } from "@/lib/use-async-action";
import { useEditorActions, useEditorStore } from "../editor-store";
import { usePanelActivity } from "./activity";

const MemoPanel = memo(PropertiesPanel);

const STORAGE_KEY = "paprika.properties.sections";
const ERROR_TOAST_ID = "properties:error";

/** Shortest gap between two renders of the panel caused by document deltas (a burst of edits to what it shows). */
export const PANEL_REFRESH_MS = 100;

/**
 * The editor's selection and the live document, as one input that keeps its identity while the panel's view of them
 * does not change. A new selection is applied at once; a change to the document is applied at once when the panel has
 * been still for `refreshMs`, otherwise it waits for the rest of the interval and then shows the latest document (a
 * burst of 200 edits to the selected node renders the whole panel about ten times a second, not on every frame).
 */
export function usePanelInput(refreshMs = PANEL_REFRESH_MS): PanelInput {
  const live = useLiveClient().store;
  const editor = useEditorStore();
  const [input, setInput] = useState(() => panelInput(null, live.state.doc, editor.state.selection));
  const held = useRef(input);
  const shownAt = useRef(0);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    // A new selection is shown in a transition: the layer's highlight (and the canvas) paint first and the panel's fields mount in slices after.
    const show = (next: PanelInput, selectionChanged = false) => {
      held.current = next;
      shownAt.current = Date.now();
      if (selectionChanged) startTransition(() => setInput(next));
      else setInput(next);
    };
    const refresh = () => {
      timer = undefined;
      const next = panelInput(held.current, live.state.doc, editor.state.selection);
      if (next !== held.current) show(next);
    };
    const onChange = () => {
      const next = panelInput(held.current, live.state.doc, editor.state.selection);
      if (next === held.current) return;
      const wait = shownAt.current + refreshMs - Date.now();
      const selectionChanged = next.selected !== held.current.selected;
      if (selectionChanged || next.doc?.id !== held.current.doc?.id || wait <= 0) {
        clearTimeout(timer);
        timer = undefined;
        show(next, selectionChanged && next.doc?.id === held.current.doc?.id);
      } else if (timer === undefined) timer = setTimeout(refresh, wait);
    };
    onChange();
    const a = live.subscribe(onChange);
    const b = editor.subscribe(onChange);
    return () => {
      clearTimeout(timer);
      a.unsubscribe();
      b.unsubscribe();
    };
  }, [live, editor, refreshMs]);
  return input;
}

/** Font picker for the typography section: the document's families come from a memoized function of the live document. */
function FontSlot({ value, onValueChange }: { value: string; onValueChange: (family: string) => void }) {
  const fonts = useLive((state) => documentFonts(state.doc), shallow);
  return <FontPicker value={value} onValueChange={onValueChange} documentFonts={fonts} />;
}

const renderFontPicker: FontPickerSlot = (props) => <FontSlot {...props} />;

/** Hotkeys the panel hints at, as the platform spells them (`["Ctrl", "G"]`, `["⌘", "G"]`). */
function usePanelShortcuts(): PropertiesPanelShortcuts {
  const format = useFormatForDisplay();
  return useMemo(
    () => ({
      group: format("Mod+G", { parts: true }),
      ungroup: format("Mod+Shift+G", { parts: true }),
      wrap: format("Mod+Alt+G", { parts: true }),
      center: format("Alt+C", { parts: true }),
    }),
    [format],
  );
}

/**
 * Right panel of the editor: wires `PropertiesPanel` to the live document, the editor's selection and the server.
 * The panel gets the whole document by contract, so what keeps it still is the input: it changes only when a delta
 * touches something the panel shows (`adapters/properties`). Activity and lint feed the document panel only, and
 * are not even read while something is selected.
 */
export function Properties({ header }: { header?: ReactNode } = {}) {
  const { t } = useTranslation();
  const { apply } = useLiveActions();
  const { select } = useEditorActions();
  const input = usePanelInput();
  const documentView = input.selected.length === 0;
  const { activity, marker } = usePanelActivity(documentView);
  const lint = useDocLint(documentView);
  const shortcuts = usePanelShortcuts();

  // Strings that the stable callbacks read at call time.
  const texts = useRef({ failed: "", offline: "" });
  texts.current = { failed: t("app.properties.applyFailed"), offline: t("app.connection.lost") };

  const report = useCallback((error: unknown) => {
    // The panel hands its own `onError` the message of the rejection, and an offline one reads just "offline".
    const description = isOfflineError(error) || errorText(error) === "offline" ? texts.current.offline : errorText(error);
    // One id: a rejected promise reported both here and by the panel's own `onError` shows one toast.
    showStatusToast({ status: "danger", id: ERROR_TOAST_ID, title: texts.current.failed, description: description || undefined });
  }, []);

  const onApply = useCallback<PropertiesPanelProps["onApply"]>(
    (ops, label) => {
      const result = apply(ops, label);
      // The panel only awaits what it must (select after a group); a plain field edit would otherwise drop the rejection.
      result.catch(report);
      return result;
    },
    [apply, report],
  );
  const onError = useCallback((message: string) => report(message), [report]);

  return (
    <MemoPanel
      doc={input.doc}
      node={input.node}
      selected={input.selected}
      lint={lint?.top}
      activity={activity}
      activityMarker={marker}
      header={header}
      renderFontPicker={renderFontPicker}
      onApply={onApply}
      onSelect={select}
      onError={onError}
      storageKey={STORAGE_KEY}
      shortcuts={shortcuts}
    />
  );
}
