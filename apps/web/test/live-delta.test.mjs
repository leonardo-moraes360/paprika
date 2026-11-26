import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

class FakeWebSocket {
  static OPEN = 1;
  static instances = [];
  readyState = 1;
  sent = [];
  constructor() {
    FakeWebSocket.instances.push(this);
    queueMicrotask(() => this.onopen?.());
  }
  send(data) {
    this.sent.push(JSON.parse(data));
  }
  close() {}
}
globalThis.WebSocket = FakeWebSocket;
globalThis.location = { protocol: "http:", host: "localhost" };
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
globalThis.cancelAnimationFrame = clearTimeout;
globalThis.fetch = async () => ({ ok: false, headers: new Headers() });

const server = await createServer({
  root: fileURLToPath(new URL("..", import.meta.url)),
  configFile: fileURLToPath(new URL("../vite.config.ts", import.meta.url)),
  server: { middlewareMode: true },
  logLevel: "warn",
});
const { LiveStore } = await server.ssrLoadModule("/src/useDocument.ts");
const { applyDelta, orderCreated } = await server.ssrLoadModule("/src/docDelta.ts");
after(() => server.close());

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const rect = (id, parentId, extra = {}) => ({ id, type: "rect", name: id, parentId, x: 0, y: 0, width: 10, height: 10, ...extra });
const baseDoc = () => ({
  format: "paprika/1",
  id: "d",
  name: "D",
  tokens: {},
  rootIds: ["pg"],
  nodes: { pg: { id: "pg", type: "page", name: "pg", parentId: null, children: ["a", "b"] }, a: rect("a", "pg"), b: rect("b", "pg") },
});
const snap = (version, doc = baseDoc(), actor = "server", kind = "reload") =>
  JSON.stringify({ type: "doc", doc, version, actor, label: "", kind, canUndo: false, canRedo: false });
const delta = (version, base, patch, actor = "user") =>
  JSON.stringify({ type: "delta", id: "d", version, base, actor, label: "", kind: "apply", canUndo: true, canRedo: false, ...patch });

async function open() {
  const store = new LiveStore();
  const stop = store.connect();
  await wait(5);
  const ws = FakeWebSocket.instances.at(-1);
  return { store, ws, stop, views: () => ws.sent.filter((m) => m.type === "view") };
}

describe("LiveStore deltas", () => {
  it("applies a delta keeping the identity of untouched nodes and the document maps it did not change", async () => {
    const { store, ws, stop } = await open();
    ws.onmessage({ data: snap(1) });
    await wait(80);
    const before = store.getState().doc;
    const frame = delta(2, 1, { nodes: { set: { a: rect("a", "pg", { opacity: 0.5 }) } } });
    const stringify = JSON.stringify;
    let calls = 0;
    JSON.stringify = (...a) => {
      calls++;
      return stringify(...a);
    };
    try {
      ws.onmessage({ data: frame });
      await wait(80);
    } finally {
      JSON.stringify = stringify;
    }
    const after = store.getState().doc;
    assert.equal(store.getState().version, 2);
    assert.equal(after.nodes.a.opacity, 0.5);
    assert.equal(after.nodes.b, before.nodes.b);
    assert.equal(after.nodes.pg, before.nodes.pg);
    assert.equal(after.tokens, before.tokens);
    assert.notEqual(after, before);
    assert.equal(before.nodes.a.opacity, undefined);
    assert.equal(calls, 0);
    assert.equal(store.getState().canUndo, true);
    stop();
  });

  it("records the changed ids of a delta for agent flashes and activity", async () => {
    const { store, ws, stop } = await open();
    ws.onmessage({ data: snap(1) });
    await wait(80);
    ws.onmessage({ data: delta(2, 1, { nodes: { set: { b: rect("b", "pg", { x: 5 }) } } }, "agent:x") });
    await wait(80);
    const s = store.getState();
    assert.deepEqual([...s.agentTouched], ["b"]);
    assert.deepEqual(s.activity[0].changed, ["b"]);
    stop();
  });

  it("applies several queued deltas in order and drops those before a snapshot", async () => {
    const { store, ws, stop } = await open();
    ws.onmessage({ data: snap(1) });
    await wait(80);
    ws.onmessage({ data: delta(2, 1, { nodes: { set: { a: rect("a", "pg", { x: 1 }) } } }) });
    ws.onmessage({ data: delta(3, 2, { nodes: { set: { a: rect("a", "pg", { x: 2 }) } } }) });
    ws.onmessage({ data: delta(4, 3, { nodes: { del: ["b"] }, rootIds: ["pg"] }) });
    await wait(80);
    assert.equal(store.getState().version, 4);
    assert.equal(store.getState().doc.nodes.a.x, 2);
    assert.equal("b" in store.getState().doc.nodes, false);
    const d = baseDoc();
    d.nodes.a.x = 9;
    ws.onmessage({ data: delta(5, 4, { nodes: { set: { a: rect("a", "pg", { x: 3 }) } } }) });
    ws.onmessage({ data: snap(7, d, "agent:x", "apply") });
    ws.onmessage({ data: delta(8, 7, { nodes: { set: { b: rect("b", "pg", { x: 4 }) } } }) });
    await wait(80);
    assert.equal(store.getState().version, 8);
    assert.equal(store.getState().doc.nodes.a.x, 9);
    assert.equal(store.getState().doc.nodes.b.x, 4);
    stop();
  });

  it("asks for a snapshot, once, when the base version does not match", async () => {
    const { store, ws, views, stop } = await open();
    ws.onmessage({ data: snap(1) });
    await wait(80);
    assert.equal(views().length, 1);
    ws.onmessage({ data: delta(5, 4, { nodes: { set: { a: rect("a", "pg", { x: 7 }) } } }) });
    await wait(80);
    assert.equal(store.getState().version, 1);
    assert.equal(store.getState().doc.nodes.a.x, 0);
    assert.equal(views().length, 2);
    ws.onmessage({ data: delta(6, 5, { nodes: { set: { a: rect("a", "pg", { x: 8 }) } } }) });
    await wait(80);
    assert.equal(views().length, 2);
    ws.onmessage({ data: snap(6) });
    await wait(80);
    assert.equal(store.getState().version, 6);
    ws.onmessage({ data: delta(7, 6, { nodes: { set: { a: rect("a", "pg", { x: 9 }) } } }) });
    await wait(80);
    assert.equal(store.getState().version, 7);
    assert.equal(views().length, 2);
    stop();
  });

  it("ignores a duplicate delta and resyncs when none was ever received", async () => {
    const { store, ws, views, stop } = await open();
    ws.onmessage({ data: delta(3, 2, { name: "x" }) });
    await wait(80);
    assert.equal(store.getState().doc, null);
    assert.equal(views().length, 2);
    ws.onmessage({ data: snap(3) });
    await wait(80);
    ws.onmessage({ data: delta(3, 2, { name: "x" }) });
    await wait(80);
    assert.equal(store.getState().doc.name, "D");
    assert.equal(views().length, 2);
    stop();
  });

  it("orders created ids like the document tree", () => {
    const doc = baseDoc();
    doc.nodes.pg.children = ["a", "c", "b"];
    doc.nodes.c = { id: "c", type: "frame", name: "c", parentId: "pg", x: 0, y: 0, width: 5, height: 5, children: ["d"] };
    doc.nodes.d = rect("d", "c");
    assert.deepEqual(orderCreated(doc, ["b", "d", "c"]), ["c", "d", "b"]);
    const r = applyDelta(baseDoc(), { type: "delta", nodes: { set: { z: rect("z", "pg") }, del: ["b"] }, tokens: { set: { k: "#fff" } } });
    assert.deepEqual(r.created, ["z"]);
    assert.equal(r.doc.tokens.k, "#fff");
    assert.equal("b" in r.doc.nodes, false);
  });
});
