import { Store } from "@tanstack/react-store";
import { describe, expect, it, vi } from "vitest";
import type { LiveState } from "@/data/live";
import { makeDocument } from "@/test/live-harness";
import { createEditorFeed } from "./canvas-feed";
import { initialEditorState, type EditorActions, type EditorState } from "./editor-store";

function setup() {
  const doc = makeDocument(10);
  const live = new Store({ doc } as unknown as LiveState);
  const editor = new Store<EditorState, EditorActions>(initialEditorState() as EditorState) as unknown as Store<EditorState, EditorActions>;
  const set = (patch: Partial<EditorState>) => (editor as unknown as Store<EditorState>).setState((s) => ({ ...s, ...patch }));
  return { doc, live, editor, set, feed: createEditorFeed(live, editor) };
}

describe("the editor feed of the canvas", () => {
  it("carries the document, selection, zoom and fit request of the two stores", () => {
    const { doc, set, feed } = setup();
    expect(feed.get().doc).toBe(doc);
    set({ zoom: 2, selection: ["a"], fitRequest: 3, tool: "rect", hoveredId: "b" });
    expect(feed.get()).toMatchObject({ zoom: 2, selection: ["a"], fitRequest: 3, tool: "rect", hoveredId: "b" });
  });

  it("gives the same object while nothing the canvas reads has changed", () => {
    const { feed, set } = setup();
    const first = feed.get();
    set({ rightTab: "team" } as Partial<EditorState>);
    expect(feed.get()).toBe(first);
    set({ fitRequest: first.fitRequest + 1 });
    expect(feed.get()).not.toBe(first);
  });

  it("notifies on both stores and stops after the unsubscribe", () => {
    const { live, set, feed } = setup();
    const listener = vi.fn();
    const off = feed.subscribe(listener);
    set({ zoom: 3 });
    live.setState((s) => ({ ...s }));
    expect(listener).toHaveBeenCalledTimes(2);
    off();
    set({ zoom: 4 });
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
