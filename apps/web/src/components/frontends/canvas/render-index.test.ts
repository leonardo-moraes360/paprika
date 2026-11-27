import type { Document } from "@paprika/core";
import { describe, expect, it, vi, type Mock } from "vitest";
import { everyKindDocument } from "@/test/canvas-fixtures";
import { createRenderStore, deepEqual, diffDocs } from "./render-index";

const doc = everyKindDocument();
const set = (d: Document, id: string, props: Record<string, unknown>): Document => ({ ...d, nodes: { ...d.nodes, [id]: { ...d.nodes[id]!, ...props } as never } });
const dirty = (a: Document, b: Document) => [...diffDocs(a, b).dirty].sort();

describe("deepEqual", () => {
  it("compares by value, arrays by order", () => {
    expect(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
    expect(deepEqual({ a: [1, 2] }, { a: [2, 1] })).toBe(false);
    expect(deepEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(deepEqual([], {})).toBe(false);
  });
});

describe("diffDocs: who must paint again", () => {
  it("a change that is the node's own repaints the node and nobody else", () => {
    for (const props of [{ x: 5 }, { y: 5 }, { width: 10 }, { name: "z" }, { rotation: 3 }, { opacity: 0.5 }, { visible: false }, { stroke: { color: "#000000", width: 3 } }, { radius: 4 }, { clip: false }]) {
      expect(dirty(doc, set(doc, "home", props)), JSON.stringify(props)).toEqual(["home"]);
    }
    expect(dirty(doc, set(doc, "plain", { text: "x" }))).toEqual(["plain"]);
    expect(dirty(doc, set(doc, "pair", { opacity: 0.5 }))).toEqual(["pair"]);
  });

  it("a change that reaches the descendants (layout, fill, mode) repaints the whole subtree", () => {
    const sub = ["home", "turned", "ghost", "title", "plain", "pic", "squiggle", "pair", "dot"].sort();
    expect(dirty(doc, set(doc, "home", { layout: { mode: "row", gap: 8, padding: 12, align: "start", justify: "start" } }))).toEqual(sub);
    expect(dirty(doc, set(doc, "home", { fill: "#000000" }))).toEqual(sub);
    expect(dirty(doc, set(doc, "home", { mode: "dark" }))).toEqual(sub);
  });

  it("a leaf that changes its outline repaints its ancestors (a clipping frame leaves room for it)", () => {
    expect(dirty(doc, set(doc, "dot", { outline: { color: "#000000", width: 2 } }))).toEqual(["dot", "home", "page", "pair"].sort());
  });

  it("a node that appears or goes away repaints its parent and the ancestors", () => {
    const { dot: _dot, ...nodes } = doc.nodes;
    const pair = doc.nodes.pair as unknown as { children: string[] };
    const gone = { ...doc, nodes: { ...nodes, pair: { ...pair, children: [] } as never } } as Document;
    expect(dirty(doc, gone)).toEqual(["dot", "home", "page", "pair"].sort());
    expect(dirty(gone, doc)).toEqual(["dot", "home", "page", "pair"].sort());
  });

  it("a replaced object with the same value is not a change", () => {
    const copy = { ...doc, nodes: Object.fromEntries(Object.entries(doc.nodes).map(([id, n]) => [id, { ...n }])) } as Document;
    const diff = diffDocs(doc, copy);
    expect(diff.changed).toEqual([]);
    expect(diff.dirty.size).toBe(0);
  });

  it("a token, mode or asset change is an environment change: everything repaints", () => {
    expect(diffDocs(doc, { ...doc, tokens: { ...doc.tokens, a: 1 } }).env).toBe(true);
    expect(diffDocs(doc, { ...doc, assets: { logo: "https://example.com/l.png" } } as Document).env).toBe(true);
    expect(diffDocs(doc, { ...doc, name: "Other" }).env).toBe(false);
    expect(diffDocs(doc, { ...doc, rootIds: [...doc.rootIds] }).env).toBe(false);
  });

  it("a first document is all new", () => {
    expect(diffDocs(null, doc).env).toBe(true);
  });
});

describe("the render store", () => {
  const listen = (store: ReturnType<typeof createRenderStore>, ids: string[]) => {
    const calls: Record<string, Mock<() => void>> = {};
    for (const id of ids) store.subscribe(id, (calls[id] = vi.fn<() => void>()));
    return calls;
  };

  it("tells only the listeners of the nodes that must paint again, and gives them a new snapshot", () => {
    const store = createRenderStore(doc, "page");
    const calls = listen(store, ["home", "plain", "title"]);
    const before = { home: store.snapshot("home"), plain: store.snapshot("plain"), title: store.snapshot("title") };
    store.setDoc(set(doc, "plain", { text: "x" }), "page");
    expect(calls.plain).toHaveBeenCalledTimes(1);
    expect(calls.home).not.toHaveBeenCalled();
    expect(calls.title).not.toHaveBeenCalled();
    expect(store.snapshot("home")).toBe(before.home);
    expect(store.snapshot("title")).toBe(before.title);
    expect(store.snapshot("plain")).not.toBe(before.plain);
    expect((store.snapshot("plain").node as { text: string }).text).toBe("x");
  });

  it("an equal document tells nobody", () => {
    const store = createRenderStore(doc, "page");
    const calls = listen(store, ["home", "plain"]);
    const docs = vi.fn();
    store.subscribeDoc(docs);
    store.setDoc({ ...doc, nodes: { ...doc.nodes } }, "page");
    expect(calls.home).not.toHaveBeenCalled();
    expect(docs).not.toHaveBeenCalled();
  });

  it("keeps the same snapshot when only the object was replaced", () => {
    const store = createRenderStore(doc, "page");
    const snap = store.snapshot("plain");
    store.setDoc({ ...doc, nodes: { ...doc.nodes, plain: { ...doc.nodes.plain! } } } as Document, "page");
    expect(store.snapshot("plain")).toBe(snap);
  });

  it("a removed node's listener gets a null node", () => {
    const store = createRenderStore(doc, "page");
    const calls = listen(store, ["dot"]);
    const { dot: _dot, ...nodes } = doc.nodes;
    const pair = doc.nodes.pair as unknown as { children: string[] };
    store.setDoc({ ...doc, nodes: { ...nodes, pair: { ...pair, children: [] } as never } } as Document, "page");
    expect(calls.dot).toHaveBeenCalled();
    expect(store.snapshot("dot").node).toBeNull();
  });

  it("the roots follow the page, and change only when the list does", () => {
    const store = createRenderStore(doc, "page");
    const roots = store.roots();
    expect(roots).toEqual(["home", "box", "end", "arrow", "btn", "btn-copy"]);
    const onRoots = vi.fn();
    store.subscribeRoots(onRoots);
    store.setDoc(set(doc, "plain", { text: "x" }), "page");
    expect(store.roots()).toBe(roots);
    expect(onRoots).not.toHaveBeenCalled();
    store.setDoc(doc, "missing-page");
    expect(store.roots()).toEqual([]);
    expect(onRoots).toHaveBeenCalledTimes(1);
  });

  it("a token change tells every listener", () => {
    const store = createRenderStore(doc, "page");
    const calls = listen(store, ["home", "plain", "dot"]);
    store.setDoc({ ...doc, tokens: { x: "#111111" } }, "page");
    for (const call of Object.values(calls)) expect(call).toHaveBeenCalledTimes(1);
  });

  it("counts renders", () => {
    const store = createRenderStore(doc, "page");
    const seen: string[] = [];
    const stop = store.watchRenders((id) => seen.push(id));
    store.countRender("a");
    stop();
    store.countRender("b");
    expect(store.renders()).toBe(2);
    expect(seen).toEqual(["a"]);
  });
});
