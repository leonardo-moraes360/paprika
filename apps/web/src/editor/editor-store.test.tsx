import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { clampZoom, EditorProvider, initialEditorState, MAX_ZOOM, MIN_ZOOM, useEditor, useEditorActions, useEditorStore } from "./editor-store";

const wrapper = ({ children }: { children: ReactNode }) => <EditorProvider initial={initialEditorState}>{children}</EditorProvider>;

function setup() {
  return renderHook(() => ({ store: useEditorStore(), actions: useEditorActions() }), { wrapper });
}

describe("editor store", () => {
  it("starts with the documented defaults", () => {
    const { result } = setup();
    expect(result.current.store.state).toEqual({
      selection: [],
      pageId: null,
      tool: "select",
      zoom: 1,
      fitRequest: 0,
      renderer: "dom",
      rightTab: "properties",
      dialogs: { history: false, pins: false, export: false, import: false, agents: false },
      hoveredId: null,
      pinId: null,
      agentTones: {},
    });
  });

  it("selects, toggles, adds and clears, and a selection with the same ids is not a new state", () => {
    const { result } = setup();
    const { store, actions } = result.current;
    act(() => actions.select(["a", "b"]));
    const state = store.state;
    act(() => actions.select(["a", "b"]));
    expect(store.state).toBe(state);
    act(() => actions.toggleSelected("a"));
    expect(store.state.selection).toEqual(["b"]);
    act(() => actions.toggleSelected("c"));
    act(() => actions.addToSelection(["c", "d"]));
    expect(store.state.selection).toEqual(["b", "c", "d"]);
    act(() => actions.clearSelection());
    expect(store.state.selection).toEqual([]);
    const cleared = store.state;
    act(() => actions.clearSelection());
    expect(store.state).toBe(cleared);
  });

  it("changing the page clears the selection, choosing the same page does not", () => {
    const { result } = setup();
    const { store, actions } = result.current;
    act(() => actions.select(["a"]));
    act(() => actions.setPage("p1"));
    expect(store.state).toMatchObject({ pageId: "p1", selection: [] });
    act(() => actions.select(["x"]));
    act(() => actions.setPage("p1"));
    expect(store.state.selection).toEqual(["x"]);
  });

  it("clamps the zoom between 10% and 800% and steps by 1.25", () => {
    const { result } = setup();
    const { store, actions } = result.current;
    act(() => actions.zoomIn());
    expect(store.state.zoom).toBeCloseTo(1.25);
    act(() => actions.setZoom(100));
    expect(store.state.zoom).toBe(MAX_ZOOM);
    act(() => actions.zoomIn());
    expect(store.state.zoom).toBe(MAX_ZOOM);
    act(() => actions.setZoom(0));
    expect(store.state.zoom).toBe(MIN_ZOOM);
    act(() => actions.zoomOut());
    expect(store.state.zoom).toBe(MIN_ZOOM);
    expect(clampZoom(2)).toBe(2);
    act(() => actions.fit());
    act(() => actions.fit());
    expect(store.state.fitRequest).toBe(2);
  });

  it("opens, closes and toggles dialogs one by one", () => {
    const { result } = setup();
    const { store, actions } = result.current;
    act(() => actions.openDialog("history"));
    act(() => actions.toggleDialog("export"));
    expect(store.state.dialogs).toMatchObject({ history: true, export: true, pins: false });
    act(() => actions.closeDialog("history"));
    act(() => actions.toggleDialog("export"));
    expect(Object.values(store.state.dialogs).every((open) => !open)).toBe(true);
    const dialogs = store.state.dialogs;
    act(() => actions.closeDialog("pins"));
    expect(store.state.dialogs).toBe(dialogs);
  });

  it("sets tool, renderer, tab, hovered layer and pin", () => {
    const { result } = setup();
    const { store, actions } = result.current;
    act(() => {
      actions.setTool("rect");
      actions.setRenderer("wasm");
      actions.setRightTab("team");
      actions.setHovered("n1");
      actions.setPin("pin1");
    });
    expect(store.state).toMatchObject({ tool: "rect", renderer: "wasm", rightTab: "team", hoveredId: "n1", pinId: "pin1" });
  });

  it("a component re-renders only for the slice it reads, and each editor has its own state", () => {
    let renders = 0;
    const { result } = renderHook(
      () => {
        renders += 1;
        return { zoom: useEditor((s) => s.zoom), actions: useEditorActions() };
      },
      { wrapper },
    );
    const before = renders;
    act(() => result.current.actions.setTool("frame"));
    expect(renders).toBe(before);
    act(() => result.current.actions.zoomIn());
    expect(renders).toBeGreaterThan(before);
    const other = setup();
    expect(other.result.current.store.state.zoom).toBe(1);
    expect(other.result.current.store).not.toBe(result.current.actions);
  });

  it("throws outside a provider", () => {
    expect(() => renderHook(() => useEditorStore())).toThrow(/Provider/);
  });
});
