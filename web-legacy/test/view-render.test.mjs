import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const frames = [];
globalThis.requestAnimationFrame = (fn) => frames.push(fn);
globalThis.cancelAnimationFrame = () => {};

const server = await createServer({
  root: fileURLToPath(new URL("..", import.meta.url)),
  configFile: fileURLToPath(new URL("../vite.config.ts", import.meta.url)),
  server: { middlewareMode: true },
  logLevel: "warn",
});
const { ViewStore } = await server.ssrLoadModule("/src/viewStore.ts");
const { RenderIndexer } = await server.ssrLoadModule("/src/renderIndex.ts");
after(() => server.close());

const runFrame = () => frames.splice(0).forEach((fn) => fn(0));

const world = () => ({ style: { transform: "" } });

describe("ViewStore", () => {
  it("coalesces many sets into one transform write, notification and frame callback per frame", () => {
    const store = new ViewStore({ x: 0, y: 0, zoom: 1 });
    const el = world();
    store.attach(el);
    let notified = 0;
    let drawn = 0;
    store.subscribe(() => notified++);
    store.onFrame(() => drawn++);
    for (let i = 1; i <= 50; i++) store.set((v) => ({ ...v, x: v.x - 3 }));
    assert.equal(frames.length, 1);
    assert.deepEqual(store.get(), { x: 0, y: 0, zoom: 1 });
    assert.equal(store.getTarget().x, -150);
    runFrame();
    assert.equal(el.style.transform, "translate(-150px, 0px) scale(1)");
    assert.equal(notified, 1);
    assert.equal(drawn, 1);
    store.dispose();
  });

  it("applies an immediate set at once and does nothing for an equal view", () => {
    const store = new ViewStore({ x: 1, y: 2, zoom: 1 });
    const el = world();
    store.attach(el);
    let notified = 0;
    store.subscribe(() => notified++);
    store.set({ x: 5, y: 6, zoom: 2 }, true);
    assert.equal(el.style.transform, "translate(5px, 6px) scale(2)");
    assert.equal(notified, 1);
    store.set({ x: 5, y: 6, zoom: 2 }, true);
    assert.equal(notified, 1);
    assert.equal(frames.length, 0);
    store.dispose();
  });
});

const node = (id, parentId, children, extra = {}) => ({ id, type: children ? "frame" : "rect", parentId, ...(children ? { children } : {}), ...extra });
const docOf = (nodes, extra = {}) => JSON.parse(JSON.stringify({ id: "d", name: "d", tokens: {}, rootIds: ["a", "b"], nodes: Object.fromEntries(nodes.map((n) => [n.id, n])), ...extra }));

describe("RenderIndexer", () => {
  const base = () => [node("a", null, ["a1", "a2"]), node("a1", "a", undefined, { x: 1 }), node("a2", "a", undefined, { x: 2 }), node("b", null, ["b1"]), node("b1", "b", undefined, { x: 3 })];

  it("keeps node identity and versions for unchanged nodes across fresh parses", () => {
    const ix = new RenderIndexer();
    const one = ix.index(docOf(base()));
    const two = ix.index(docOf(base()));
    for (const id of Object.keys(one.doc.nodes)) assert.equal(two.doc.nodes[id], one.doc.nodes[id]);
    for (const id of Object.keys(one.doc.nodes)) assert.equal(two.vers.get(id), one.vers.get(id));
    assert.equal(two.envVer, one.envVer);
  });

  it("changes the versions of the node, its ancestors and descendants only", () => {
    const ix = new RenderIndexer();
    const one = ix.index(docOf(base()));
    const nodes = base();
    nodes[1] = node("a1", "a", undefined, { x: 99 });
    const two = ix.index(docOf(nodes));
    assert.notEqual(two.vers.get("a1"), one.vers.get("a1"));
    assert.notEqual(two.vers.get("a"), one.vers.get("a"));
    assert.equal(two.vers.get("a2"), one.vers.get("a2"));
    assert.equal(two.vers.get("b"), one.vers.get("b"));
    assert.equal(two.vers.get("b1"), one.vers.get("b1"));
    assert.equal(two.doc.nodes.b1, one.doc.nodes.b1);
    assert.equal(two.envVer, one.envVer);
  });

  it("bumps descendants when an ancestor changes and everything when tokens change", () => {
    const ix = new RenderIndexer();
    const one = ix.index(docOf(base()));
    const nodes = base();
    nodes[0] = node("a", null, ["a1", "a2"], { mode: "dark" });
    const two = ix.index(docOf(nodes));
    assert.notEqual(two.vers.get("a2"), one.vers.get("a2"));
    assert.equal(two.vers.get("b1"), one.vers.get("b1"));
    const three = ix.index(docOf(nodes, { tokens: { c: "#fff" } }));
    assert.notEqual(three.envVer, two.envVer);
  });
});
