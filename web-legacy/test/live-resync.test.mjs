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
after(() => server.close());

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const docFrame = (version) =>
  JSON.stringify({ type: "doc", doc: { id: "d", nodes: {}, rootIds: [] }, version, actor: "agent:x", label: "", kind: "apply", canUndo: false, canRedo: false });

async function open() {
  const store = new LiveStore();
  store.staleResyncMs = 40;
  const stop = store.connect();
  await wait(5);
  const ws = FakeWebSocket.instances.at(-1);
  return { store, ws, stop, views: () => ws.sent.filter((m) => m.type === "view") };
}

describe("LiveStore resync", () => {
  it("always declares its view on open, so the server sends a single snapshot", async () => {
    const { views, stop } = await open();
    assert.equal(views().length, 1);
    stop();
  });

  it("asks for the view again when an ack reveals a newer version and no doc arrives", async () => {
    const { ws, views, store, stop } = await open();
    ws.onmessage({ data: docFrame(5) });
    await wait(80);
    assert.equal(store.getState().version, 5);
    ws.onmessage({ data: JSON.stringify({ type: "ack", reqId: "x", version: 9 }) });
    await wait(120);
    assert.equal(views().length, 2);
    stop();
  });

  it("does not resync when the doc catches up in time", async () => {
    const { ws, views, store, stop } = await open();
    ws.onmessage({ data: docFrame(5) });
    await wait(80);
    ws.onmessage({ data: JSON.stringify({ type: "ack", reqId: "x", version: 6 }) });
    ws.onmessage({ data: docFrame(6) });
    await wait(150);
    assert.equal(store.getState().version, 6);
    assert.equal(views().length, 1);
    stop();
  });
});
