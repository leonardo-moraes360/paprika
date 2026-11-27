import type { Document } from "@paprika/core";
import { createStore } from "@tanstack/react-store";
import { describe, expect, it } from "vitest";
import { everyKindDocument } from "@/test/canvas-fixtures";
import { createPreviewController } from "./preview";
import { canvasActions, initialCanvasState, type CanvasActions, type CanvasState } from "./region";

const doc = everyKindDocument();
const moved = (d: Document, id: string, x: number): Document => ({ ...d, nodes: { ...d.nodes, [id]: { ...d.nodes[id]!, x } as never } });
const deferred = () => {
  let resolve!: (ok: boolean) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<boolean>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
};

function setup() {
  const store = createStore<CanvasState, CanvasActions>(initialCanvasState(), canvasActions);
  let current = doc;
  const ctl = createPreviewController(store.actions, () => ({ state: store.state, doc: current }));
  return { store, ctl, setDoc: (d: Document) => ((current = d), ctl.reconcile(d)) };
}

describe("the preview controller", () => {
  it("shows what the gesture shows while it runs and clears it when asked", () => {
    const { store, ctl } = setup();
    ctl.set({ plain: { x: 5, y: 6 } });
    expect(store.state.preview.plain).toEqual({ x: 5, y: 6 });
    ctl.clear();
    expect(store.state.preview).toEqual({});
  });

  it("after a release keeps the preview until the document shows the same geometry", async () => {
    const { store, ctl, setDoc } = setup();
    const answer = deferred();
    ctl.set({ plain: { x: 40 } });
    ctl.commit(["plain"], answer.promise);
    expect(store.state.preview.plain).toEqual({ x: 40 });
    answer.resolve(true);
    await answer.promise;
    expect(store.state.preview.plain).toEqual({ x: 40 });
    setDoc(moved(doc, "plain", 40));
    expect(store.state.preview.plain).toBeUndefined();
  });

  it("clears when the server acked and the document changed but not to the same numbers (it rounded)", async () => {
    const { store, ctl, setDoc } = setup();
    const answer = deferred();
    ctl.set({ plain: { x: 40.4 } });
    ctl.commit(["plain"], answer.promise);
    answer.resolve(true);
    await answer.promise;
    setDoc(moved(doc, "plain", 40));
    expect(store.state.preview.plain).toBeUndefined();
  });

  it("does not clear on an unrelated document change before the ack", () => {
    const { store, ctl, setDoc } = setup();
    ctl.set({ plain: { x: 40 } });
    ctl.commit(["plain"], new Promise(() => undefined));
    setDoc(moved(doc, "title", 1));
    expect(store.state.preview.plain).toEqual({ x: 40 });
  });

  it("goes back at once when the apply is refused or fails", async () => {
    const a = setup();
    const refused = deferred();
    a.ctl.set({ plain: { x: 40 } });
    a.ctl.commit(["plain"], refused.promise);
    refused.resolve(false);
    await refused.promise;
    expect(a.store.state.preview.plain).toBeUndefined();

    const b = setup();
    const failed = deferred();
    b.ctl.set({ plain: { x: 40 } });
    b.ctl.commit(["plain"], failed.promise);
    failed.reject(new Error("offline"));
    await failed.promise.catch(() => undefined);
    expect(b.store.state.preview.plain).toBeUndefined();
  });

  it("a new gesture on the same node takes it over from a commit still waiting", async () => {
    const { store, ctl } = setup();
    const first = deferred();
    ctl.set({ plain: { x: 40 } });
    ctl.commit(["plain"], first.promise);
    ctl.set({ plain: { x: 60 } });
    first.resolve(false);
    await first.promise;
    expect(store.state.preview.plain).toEqual({ x: 60 });
  });

  it("is clear at once when the echo was already in", () => {
    const { store, ctl, setDoc } = setup();
    setDoc(moved(doc, "plain", 40));
    ctl.set({ plain: { x: 40 } });
    ctl.commit(["plain"], new Promise(() => undefined));
    expect(store.state.preview.plain).toBeUndefined();
  });

  it("a patch that carries an outline stays until the document holds that same outline (by content), not only the same box", () => () => {
    const { store, ctl, setDoc } = setup();
    const x = (doc.nodes.plain as { x: number }).x;
    ctl.set({ plain: { x, d: "M0 0 L9 9" } });
    ctl.commit(["plain"], new Promise(() => undefined));
    // before the ack: the box is already the document's but the outline is not
    setDoc({ ...doc });
    expect(store.state.preview.plain).toBeDefined();
    setDoc({ ...doc, nodes: { ...doc.nodes, plain: { ...doc.nodes.plain!, d: "M0 0 L9 9" } as never } });
    expect(store.state.preview.plain).toBeUndefined();
  });

  it("a refusal puts the preview back even after the controller was disposed once (StrictMode runs the cleanup of an effect once)", async () => {
    const { store, ctl } = setup();
    ctl.dispose();
    ctl.set({ plain: { x: 40 } });
    expect(store.state.preview.plain).toEqual({ x: 40 });
    const answer = deferred();
    ctl.commit(["plain"], answer.promise);
    answer.resolve(false);
    await answer.promise;
    await Promise.resolve();
    expect(store.state.preview.plain).toBeUndefined();
  });
});
