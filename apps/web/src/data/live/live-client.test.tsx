import { act, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLiveRig, deltaMessage, docMessage, makeDocument, nodeDelta } from "@/test/live-harness";
import { LiveProvider, useLive } from "./hooks";
import { frameScheduler, type LiveEvent } from "./live-store";
import { LiveOfflineError, LiveRequestError, isOfflineError } from "./socket";

const doc = makeDocument(300, { id: "w1" });
const ids = Object.keys(doc.nodes);
const [a, b] = [ids[10] as string, ids[11] as string];

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const flushMicrotasks = () => act(async () => void (await Promise.resolve()));

describe("opening", () => {
  it("creates the socket only after start, sends hello once the renderer is known and the view only when someone asks for one", async () => {
    const rig = createLiveRig();
    expect(rig.sockets.sockets).toHaveLength(0);
    rig.client.actions.setRenderer("dom");
    const socket = await rig.connect();
    expect(socket.url).toBe("wss://test/ws");
    expect(rig.client.store.state.connected).toBe(true);
    // Nobody asked for a workspace yet: the server sends the active one after its short wait, so no `view` goes out on open.
    expect(socket.sent.map((m) => m.type)).toEqual(["hello"]);
    void rig.client.view(null);
    expect(socket.sent.map((m) => m.type)).toEqual(["hello", "view"]);
    expect(socket.sent[1]).toEqual({ type: "view", reqId: expect.any(String) });
  });

  it("a view asked after the socket opened is the only one sent: the open does not ask for the active workspace first", async () => {
    const rig = createLiveRig();
    const socket = await rig.connect();
    const done = rig.client.view("a");
    expect(socket.sentOf("view")).toEqual([{ type: "view", workspaceId: "a", reqId: expect.any(String) }]);
    act(() => socket.ack(socket.lastReqId("view") as string, 1));
    await done;
    expect(socket.sentOf("view")).toHaveLength(1);
  });

  it("asking again for the workspace the server already confirmed resolves without another snapshot", async () => {
    const rig = createLiveRig();
    const socket = await rig.connect();
    const first = rig.client.view(null);
    act(() => socket.ack(socket.lastReqId("view") as string, 1));
    await first;
    await rig.client.view(null);
    await rig.client.view(null);
    expect(socket.sentOf("view")).toHaveLength(1);
    // Another workspace is asked for; and asking for the first one again after that is a real request.
    const other = rig.client.view("wb");
    expect(socket.sentOf("view")).toHaveLength(2);
    act(() => socket.ack(socket.lastReqId("view") as string, 1));
    await other;
    await rig.client.view("wb");
    expect(socket.sentOf("view")).toHaveLength(2);
    void rig.client.view(null);
    expect(socket.sentOf("view")).toHaveLength(3);
  });

  it("the confirmed workspace is forgotten when the connection drops: the same view is asked again on the new one", async () => {
    const rig = createLiveRig();
    const first = await rig.connect();
    const asked = rig.client.view("wa");
    act(() => first.ack(first.lastReqId("view") as string, 1));
    await asked;
    act(() => first.drop());
    await act(async () => void (await vi.advanceTimersByTimeAsync(5000)));
    const second = rig.sockets.last;
    expect(second).not.toBe(first);
    act(() => second.open());
    expect(second.sentOf("view")).toEqual([{ type: "view", workspaceId: "wa", reqId: expect.any(String) }]);
  });

  it("a refused view is not remembered as confirmed", async () => {
    const rig = createLiveRig();
    const socket = await rig.connect();
    const ok = rig.client.view("wa");
    act(() => socket.ack(socket.lastReqId("view") as string, 1));
    await ok;
    const refused = rig.client.view("ghost");
    act(() => socket.receive({ type: "error", reqId: socket.lastReqId("view") as string, message: "nope" }));
    await expect(refused).rejects.toThrow("nope");
    void rig.client.view("wa");
    expect(socket.sentOf("view")).toHaveLength(3);
  });

  it("applies the first doc message and reads canUndo/canRedo and version from it", async () => {
    const rig = createLiveRig();
    await rig.connect();
    rig.deliver(docMessage(doc, 7, { canUndo: true }));
    const state = rig.client.store.state;
    expect(state.doc).toEqual(doc);
    expect(state.version).toBe(7);
    expect(state.canUndo).toBe(true);
    expect(state.canRedo).toBe(false);
    expect(state.activity).toEqual([]);
  });

  it("keeps the order doc, presence, team, ack that the server sends and handles each", async () => {
    const rig = createLiveRig();
    const socket = await rig.connect();
    const reqId = socket.lastReqId("view");
    rig.deliver(docMessage(doc, 1));
    rig.push({ type: "presence", agent: "s:1", actor: "agent:claude", tool: "create_nodes", nodes: [a], idle: 0 });
    rig.push({ type: "team", status: { team: null } });
    rig.push({ type: "ack", reqId: reqId as string, version: 1 });
    expect(rig.client.store.state.agents.map((x) => x.agent)).toEqual(["s:1"]);
    expect(rig.client.store.state.team).toEqual({ team: null });
  });

  it("applies only the last full snapshot of a batch and the deltas after it", async () => {
    const rig = createLiveRig();
    await rig.connect();
    const newer = makeDocument(300, { id: "w1", name: "Newer" });
    rig.deliver(docMessage(doc, 1), nodeDelta(doc, a, { x: 1 }, 2), docMessage(newer, 5), nodeDelta(newer, b, { x: 3 }, 6));
    expect(rig.client.store.state.version).toBe(6);
    expect(rig.client.store.state.doc?.name).toBe("Newer");
    expect((rig.client.store.state.doc?.nodes[b] as { x: number }).x).toBe(3);
    expect(rig.client.store.state.doc?.nodes[a]).toEqual(newer.nodes[a]);
  });

  it("ignores a frame that is not JSON", async () => {
    const rig = createLiveRig();
    const socket = await rig.connect();
    act(() => socket.receive("not json"));
    expect(rig.client.store.state.error).toBeNull();
  });
});

describe("delta", () => {
  it("applies a delta with copy on write: the nodes it does not touch keep their reference", async () => {
    const rig = createLiveRig();
    await rig.connect();
    rig.deliver(docMessage(doc, 1));
    const before = rig.client.store.state.doc!;
    rig.deliver(nodeDelta(before, a, { name: "renamed" }, 2, { actor: "agent:claude", label: "update_nodes" }));
    const after = rig.client.store.state.doc!;
    expect(after).not.toBe(before);
    expect(after.nodes[a]).not.toBe(before.nodes[a]);
    expect((after.nodes[a] as { name: string }).name).toBe("renamed");
    expect(after.nodes[b]).toBe(before.nodes[b]);
    const untouched = ids.filter((id) => id !== a && after.nodes[id] === before.nodes[id]);
    expect(untouched).toHaveLength(ids.length - 1);
    expect(rig.client.store.state.version).toBe(2);
    expect(rig.client.store.state.activity[0]).toMatchObject({ id: 2, actor: "agent:claude", label: "update_nodes" });
    expect(rig.client.store.state.activity[0]).not.toHaveProperty("changed");
  });

  it("turns a burst into a single state update and a single document copy", async () => {
    const rig = createLiveRig();
    await rig.connect();
    rig.deliver(docMessage(doc, 1));
    const seen: unknown[] = [];
    const sub = rig.client.store.subscribe((s) => seen.push(s.doc));
    const before = rig.client.store.state.doc!;
    const burst = Array.from({ length: 200 }, (_, i) => nodeDelta(before, ids[20 + (i % 50)] as string, { x: i }, 2 + i));
    rig.deliver(...burst);
    await flushMicrotasks();
    sub.unsubscribe();
    expect(rig.client.store.state.version).toBe(201);
    expect(rig.client.store.state.activity).toHaveLength(30);
    expect(new Set(seen).size).toBe(1);
  });

  it("sends a view when the base does not match and does not ask twice while it waits", async () => {
    const rig = createLiveRig();
    const socket = await rig.connect();
    rig.deliver(docMessage(doc, 1));
    const before = socket.sentOf("view").length;
    rig.deliver(deltaMessage(doc, 9, { base: 5, name: "x" }));
    expect(socket.sentOf("view")).toHaveLength(before + 1);
    expect(rig.client.store.state.version).toBe(1);
    rig.deliver(deltaMessage(doc, 10, { base: 9, name: "y" }));
    expect(socket.sentOf("view")).toHaveLength(before + 1);
    rig.deliver(docMessage(makeDocument(300, { id: "w1", name: "Fresh" }), 10));
    expect(rig.client.store.state.doc?.name).toBe("Fresh");
    rig.deliver(deltaMessage(doc, 20, { base: 15, name: "z" }));
    expect(socket.sentOf("view")).toHaveLength(before + 2);
  });

  it("drops a delta that was already applied without asking for a view", async () => {
    const rig = createLiveRig();
    const socket = await rig.connect();
    rig.deliver(docMessage(doc, 4));
    const before = socket.sentOf("view").length;
    rig.deliver(deltaMessage(doc, 3, { base: 2, name: "old" }));
    expect(socket.sentOf("view")).toHaveLength(before);
    expect(rig.client.store.state.doc?.name).toBe(doc.name);
  });

  it("asks for a view when a delta arrives before any document", async () => {
    const rig = createLiveRig();
    const socket = await rig.connect();
    const before = socket.sentOf("view").length;
    rig.deliver(deltaMessage(doc, 2, { name: "orphan" }));
    expect(socket.sentOf("view")).toHaveLength(before + 1);
  });

  it("does not apply a delta of another workspace", async () => {
    const rig = createLiveRig();
    const socket = await rig.connect();
    rig.deliver(docMessage(doc, 1));
    const before = socket.sentOf("view").length;
    rig.deliver(deltaMessage(makeDocument(3, { id: "other" }), 2, { name: "stranger" }));
    expect(rig.client.store.state.doc?.name).toBe(doc.name);
    // A delta of another workspace says nothing about this one: no snapshot is asked for.
    expect(socket.sentOf("view")).toHaveLength(before);
  });

  it("a late delta of the workspace that was in view, after the snapshot of the new one in the same batch, is dropped without a view", async () => {
    const rig = createLiveRig();
    const socket = await rig.connect();
    rig.deliver(docMessage(doc, 1));
    const other = makeDocument(3, { id: "other", name: "Other" });
    const before = socket.sentOf("view").length;
    rig.deliver(docMessage(other, 5), nodeDelta(doc, a, { x: 9 }, 2), nodeDelta(doc, b, { x: 9 }, 3));
    expect(rig.client.store.state.doc?.id).toBe("other");
    expect(rig.client.store.state.version).toBe(5);
    expect(socket.sentOf("view")).toHaveLength(before);
  });

  it("resets the activity when a snapshot of another workspace arrives", async () => {
    const rig = createLiveRig();
    await rig.connect();
    rig.deliver(docMessage(doc, 1));
    rig.deliver(nodeDelta(doc, a, { x: 1 }, 2));
    expect(rig.client.store.state.activity).toHaveLength(1);
    rig.deliver(docMessage(makeDocument(3, { id: "w2" }), 1));
    expect(rig.client.store.state.doc?.id).toBe("w2");
    expect(rig.client.store.state.activity).toEqual([]);
  });

  it("logs a snapshot of a new version as activity without comparing the nodes, and a silent reload as nothing", async () => {
    const rig = createLiveRig();
    await rig.connect();
    rig.deliver(docMessage(doc, 1));
    const edited = JSON.parse(JSON.stringify(doc)) as typeof doc;
    (edited.nodes[a] as { x: number }).x = 999;
    rig.deliver(docMessage(edited, 2, { actor: "agent:x", label: "import_svg", kind: "import" }));
    expect(rig.client.store.state.activity[0]).toMatchObject({ id: 2, actor: "agent:x", label: "import_svg" });
    expect(rig.client.store.state.activity[0]).not.toHaveProperty("changed");
    rig.deliver(docMessage(edited, 3));
    expect(rig.client.store.state.activity).toHaveLength(1);
  });

  it("a snapshot of the version already in view is no activity and keeps the document and every node reference", async () => {
    const rig = createLiveRig();
    await rig.connect();
    rig.deliver(docMessage(doc, 7));
    const before = rig.client.store.state;
    const copy = JSON.parse(JSON.stringify(doc)) as typeof doc;
    // The overview's `open` broadcast and the answer to `view` bring the whole document twice (user/open, then server/reload).
    rig.deliver(docMessage(copy, 7, { actor: "user", label: "", kind: "open", canUndo: true }));
    const after = rig.client.store.state;
    expect(after.activity).toEqual([]);
    expect(after.doc).toBe(before.doc);
    expect(after.doc?.nodes[a]).toBe(before.doc?.nodes[a]);
    expect(after.version).toBe(7);
    expect(after.canUndo).toBe(true);
    rig.deliver(docMessage(copy, 7, { actor: "server", kind: "reload", canUndo: true }));
    expect(rig.client.store.state).toBe(after);
  });

  it("the repeated snapshot does not wake the subscribers of the document", async () => {
    const rig = createLiveRig();
    await rig.connect();
    rig.deliver(docMessage(doc, 7));
    const seen: unknown[] = [];
    const sub = rig.client.store.subscribe((s) => seen.push(s.doc));
    rig.deliver(docMessage(JSON.parse(JSON.stringify(doc)), 7, { actor: "user", kind: "open" }));
    sub.unsubscribe();
    expect(seen).toEqual([]);
  });
});

describe("checkStale", () => {
  const send = (rig: ReturnType<typeof createLiveRig>) => void rig.client.actions.apply([{ op: "noop" } as never]).catch(() => {});

  it("asks for a view when an ack announces a version that never arrives", async () => {
    const rig = createLiveRig();
    const socket = await rig.connect();
    rig.deliver(docMessage(doc, 1));
    const before = socket.sentOf("view").length;
    send(rig);
    await act(async () => socket.ack(socket.lastReqId("ops"), 5));
    await act(async () => void vi.advanceTimersByTime(1499));
    expect(socket.sentOf("view")).toHaveLength(before);
    await act(async () => void vi.advanceTimersByTime(2));
    expect(socket.sentOf("view")).toHaveLength(before + 1);
  });

  it("does not ask when the version arrives in time, or while frames are waiting for the next batch", async () => {
    const rig = createLiveRig();
    const socket = await rig.connect();
    rig.deliver(docMessage(doc, 1));
    const before = socket.sentOf("view").length;
    send(rig);
    await act(async () => socket.ack(socket.lastReqId("ops"), 2));
    rig.deliver(nodeDelta(doc, a, { x: 1 }, 2));
    await act(async () => void vi.advanceTimersByTime(2000));
    expect(socket.sentOf("view")).toHaveLength(before);
    send(rig);
    await act(async () => socket.ack(socket.lastReqId("ops"), 3));
    act(() => socket.receive(nodeDelta(doc, a, { x: 2 }, 3, {})));
    await act(async () => void vi.advanceTimersByTime(2000));
    expect(socket.sentOf("view")).toHaveLength(before);
  });

  it("honours staleResyncMs", async () => {
    const rig = createLiveRig({ staleResyncMs: 100 });
    const socket = await rig.connect();
    rig.deliver(docMessage(doc, 1));
    const before = socket.sentOf("view").length;
    send(rig);
    await act(async () => socket.ack(socket.lastReqId("ops"), 9));
    await act(async () => void vi.advanceTimersByTime(101));
    expect(socket.sentOf("view")).toHaveLength(before + 1);
  });

  it("ignores the ack of a request that left from another workspace", async () => {
    const rig = createLiveRig();
    const socket = await rig.connect();
    rig.deliver(docMessage(doc, 1));
    const before = socket.sentOf("view").length;
    send(rig);
    const reqId = socket.lastReqId("ops");
    rig.deliver(docMessage(makeDocument(3, { id: "w2" }), 1));
    await act(async () => socket.ack(reqId, 40));
    await act(async () => void vi.advanceTimersByTime(5000));
    expect(socket.sentOf("view")).toHaveLength(before);
  });

  it("checks again later when frames were still waiting at the first check, and asks if the version never came", async () => {
    const rig = createLiveRig({ staleResyncMs: 100 });
    const socket = await rig.connect();
    rig.deliver(docMessage(doc, 1));
    const before = socket.sentOf("view").length;
    send(rig);
    await act(async () => socket.ack(socket.lastReqId("ops"), 5));
    act(() => socket.receive(nodeDelta(doc, a, { x: 1 }, 2, {})));
    await act(async () => void vi.advanceTimersByTime(150));
    expect(socket.sentOf("view")).toHaveLength(before);
    rig.scheduler.flush();
    await act(async () => void vi.advanceTimersByTime(150));
    expect(rig.client.store.state.version).toBe(2);
    expect(socket.sentOf("view")).toHaveLength(before + 1);
  });

  it("a quick switch a to b: the late ack of the first view and its document do not make b ask again", async () => {
    const rig = createLiveRig();
    const socket = await rig.connect();
    const before = socket.sentOf("view").length;
    const first = rig.client.view("wa");
    const firstReq = socket.lastReqId("view");
    const second = rig.client.view("wb");
    const secondReq = socket.lastReqId("view");
    expect(socket.sentOf("view").slice(before).map((m) => m.workspaceId)).toEqual(["wa", "wb"]);
    rig.deliver(docMessage(makeDocument(3, { id: "wb" }), 4));
    await act(async () => socket.ack(secondReq, 4));
    await act(async () => socket.ack(firstReq, 9));
    await Promise.all([first, second]);
    await act(async () => void vi.advanceTimersByTime(5000));
    expect(rig.client.store.state.doc?.id).toBe("wb");
    expect(socket.sentOf("view")).toHaveLength(before + 2);
  });
});

describe("reconnection", () => {
  it("backs off 1 s, 2 s, then 5 s while the connection keeps failing, and starts over after an open", async () => {
    const rig = createLiveRig();
    const first = await rig.connect();
    expect(rig.sockets.sockets).toHaveLength(1);
    act(() => first.drop());
    expect(rig.client.store.state.connected).toBe(false);
    await act(async () => void vi.advanceTimersByTime(999));
    expect(rig.sockets.sockets).toHaveLength(1);
    await act(async () => void vi.advanceTimersByTime(1));
    expect(rig.sockets.sockets).toHaveLength(2);
    act(() => rig.sockets.last.drop());
    await act(async () => void vi.advanceTimersByTime(1999));
    expect(rig.sockets.sockets).toHaveLength(2);
    await act(async () => void vi.advanceTimersByTime(1));
    expect(rig.sockets.sockets).toHaveLength(3);
    act(() => rig.sockets.last.drop());
    await act(async () => void vi.advanceTimersByTime(4999));
    expect(rig.sockets.sockets).toHaveLength(3);
    await act(async () => void vi.advanceTimersByTime(1));
    expect(rig.sockets.sockets).toHaveLength(4);
    act(() => rig.sockets.last.drop());
    await act(async () => void vi.advanceTimersByTime(5000));
    expect(rig.sockets.sockets).toHaveLength(5);
    act(() => rig.sockets.last.open());
    expect(rig.client.store.state.connected).toBe(true);
    act(() => rig.sockets.last.drop());
    await act(async () => void vi.advanceTimersByTime(1000));
    expect(rig.sockets.sockets).toHaveLength(6);
  });

  it("sends the view again after reconnecting, with the workspace that was asked for, and resolves the pending view", async () => {
    const rig = createLiveRig();
    const first = await rig.connect();
    let resolved = false;
    void rig.client.view("w1").then(() => (resolved = true));
    expect(first.sentOf("view").at(-1)).toMatchObject({ workspaceId: "w1" });
    act(() => first.drop());
    await act(async () => void vi.advanceTimersByTime(1000));
    const second = rig.sockets.last;
    act(() => second.open());
    const retried = second.sentOf("view");
    expect(retried).toHaveLength(1);
    expect(retried[0]).toMatchObject({ workspaceId: "w1" });
    expect(resolved).toBe(false);
    act(() => second.ack(retried[0]?.reqId, 3));
    await flushMicrotasks();
    expect(resolved).toBe(true);
  });

  it("keeps a view asked while offline pending until the socket opens", async () => {
    const rig = createLiveRig();
    rig.client.start();
    await Promise.resolve();
    let resolved = false;
    void rig.client.view("w9").then(() => (resolved = true));
    const socket = rig.sockets.last;
    expect(socket.sent).toEqual([]);
    act(() => socket.open());
    expect(socket.sentOf("view")).toHaveLength(1);
    expect(socket.sentOf("view")[0]).toMatchObject({ workspaceId: "w9" });
    act(() => socket.ack(socket.lastReqId("view"), 1));
    await flushMicrotasks();
    expect(resolved).toBe(true);
  });

  it("keeps the document it has while offline", async () => {
    const rig = createLiveRig();
    const socket = await rig.connect();
    rig.deliver(docMessage(doc, 1));
    act(() => socket.drop());
    expect(rig.client.store.state.doc).not.toBeNull();
    expect(rig.client.store.state.connected).toBe(false);
  });

  it("stops reconnecting after stop", async () => {
    const rig = createLiveRig();
    const socket = await rig.connect();
    act(() => socket.drop());
    rig.client.stop();
    await act(async () => void vi.advanceTimersByTime(10_000));
    expect(rig.sockets.sockets).toHaveLength(1);
  });
});

describe("requests (reqId, ack, error)", () => {
  it("apply resolves with the version of the ack that has the same reqId", async () => {
    const rig = createLiveRig();
    const socket = await rig.connect();
    const first = rig.client.actions.apply([{ op: "update", id: a, props: { x: 1 } } as never], "move");
    const second = rig.client.actions.apply([{ op: "update", id: b, props: { x: 2 } } as never], "move 2");
    const [m1, m2] = socket.sentOf("ops");
    expect(m1).toMatchObject({ label: "move", reqId: expect.any(String) });
    expect(m1?.reqId).not.toBe(m2?.reqId);
    act(() => socket.ack(m2?.reqId, 12));
    act(() => socket.ack(m1?.reqId, 11));
    await expect(first).resolves.toBe(11);
    await expect(second).resolves.toBe(12);
  });

  it("apply rejects with the server's message on the error of its reqId, and the error does not reach the state", async () => {
    const rig = createLiveRig();
    const socket = await rig.connect();
    const result = rig.client.actions.apply([{ op: "update", id: "nope", props: {} } as never]);
    const reqId = socket.lastReqId("ops") as string;
    act(() => socket.receive({ type: "error", reqId, message: 'node "nope" not found' }));
    await expect(result).rejects.toThrow('node "nope" not found');
    await expect(result).rejects.toBeInstanceOf(LiveRequestError);
    expect(rig.client.store.state.error).toBeNull();
  });

  it("an error without reqId goes to the state and clearError removes it", async () => {
    const rig = createLiveRig();
    const socket = await rig.connect();
    act(() => socket.receive({ type: "error", message: "boom" }));
    expect(rig.client.store.state.error).toBe("boom");
    act(() => rig.client.actions.clearError());
    expect(rig.client.store.state.error).toBeNull();
    act(() => rig.client.actions.showError("shown"));
    expect(rig.client.store.state.error).toBe("shown");
  });

  it("rejects at once while offline, and rejects what is in flight when the connection drops", async () => {
    const rig = createLiveRig();
    await expect(rig.client.actions.apply([{ op: "noop" } as never])).rejects.toBeInstanceOf(LiveOfflineError);
    const socket = await rig.connect();
    const inFlight = rig.client.actions.apply([{ op: "noop" } as never]);
    act(() => socket.drop());
    const error = await inFlight.catch((e: unknown) => e);
    expect(isOfflineError(error)).toBe(true);
  });

  it("undo, redo and the step variants send their mode and return the step result", async () => {
    const rig = createLiveRig();
    const socket = await rig.connect();
    const plain = rig.client.actions.undo();
    act(() => socket.ack(socket.lastReqId("undo"), 4));
    await expect(plain).resolves.toBe(4);
    const own = rig.client.actions.undoOwn();
    expect(socket.sentOf("undo").at(-1)).toMatchObject({ mode: "own" });
    const step = { result: "conflict", ord: 3, label: "x", actor: "agent:a", newer: 1, withActor: "user", withLabel: "y" };
    act(() => socket.ack(socket.lastReqId("undo"), 5, { step }));
    await expect(own).resolves.toEqual(step);
    const byStep = rig.client.actions.redoStep(8);
    expect(socket.sentOf("redo").at(-1)).toMatchObject({ mode: "step", step: 8 });
    act(() => socket.ack(socket.lastReqId("redo"), 6, { step: { ...step, result: "redone" } }));
    await expect(byStep).resolves.toMatchObject({ result: "redone" });
    const redo = rig.client.actions.redo();
    act(() => socket.ack(socket.lastReqId("redo"), 7));
    await expect(redo).resolves.toBe(7);
    const redoOwn = rig.client.actions.redoOwn();
    expect(socket.sentOf("redo").at(-1)).toMatchObject({ mode: "own" });
    act(() => socket.ack(socket.lastReqId("redo"), 8));
    await expect(redoOwn).resolves.toBeUndefined();
    const undoStep = rig.client.actions.undoStep(2);
    expect(socket.sentOf("undo").at(-1)).toMatchObject({ mode: "step", step: 2 });
    act(() => socket.ack(socket.lastReqId("undo"), 9));
    await undoStep;
  });

  it("view rejects with the server's message", async () => {
    const rig = createLiveRig();
    const socket = await rig.connect();
    const result = rig.client.view("ghost");
    act(() => socket.receive({ type: "error", reqId: socket.lastReqId("view") as string, message: 'workspace "ghost" does not exist' }));
    await expect(result).rejects.toThrow('workspace "ghost" does not exist');
  });

  it("a refused view goes back to following the active workspace, also after a reconnection", async () => {
    const rig = createLiveRig();
    const first = await rig.connect();
    const result = rig.client.view("ghost");
    act(() => first.receive({ type: "error", reqId: first.lastReqId("view") as string, message: "nope" }));
    await expect(result).rejects.toThrow("nope");
    act(() => first.drop());
    await act(async () => void vi.advanceTimersByTime(1000));
    act(() => rig.sockets.last.open());
    expect(rig.sockets.last.sentOf("view")).toEqual([{ type: "view", reqId: expect.any(String) }]);
  });

  it("a refused view does not undo a newer view request", async () => {
    const rig = createLiveRig();
    const socket = await rig.connect();
    const refused = rig.client.view("ghost");
    const ghostReq = socket.lastReqId("view") as string;
    void rig.client.view("w2").catch(() => {});
    act(() => socket.receive({ type: "error", reqId: ghostReq, message: "nope" }));
    await expect(refused).rejects.toThrow("nope");
    act(() => socket.drop());
    await act(async () => void vi.advanceTimersByTime(1000));
    act(() => rig.sockets.last.open());
    expect(rig.sockets.last.sentOf("view")[0]).toMatchObject({ workspaceId: "w2" });
  });

  it("view(null) asks for the active workspace", async () => {
    const rig = createLiveRig();
    const socket = await rig.connect();
    void rig.client.view("w1");
    void rig.client.view(null);
    expect(socket.sentOf("view").at(-1)).toEqual({ type: "view", reqId: expect.any(String) });
  });

  it("stop rejects the views that were waiting for a connection", async () => {
    const rig = createLiveRig();
    const queued = rig.client.view("w1");
    const caught = queued.catch((e: unknown) => e);
    rig.client.start();
    await flushMicrotasks();
    rig.client.stop();
    expect(isOfflineError(await caught)).toBe(true);
  });

  it("two views of the same workspace in a row share one request", async () => {
    const rig = createLiveRig();
    const socket = await rig.connect();
    const before = socket.sentOf("view").length;
    const first = rig.client.view("w1");
    const second = rig.client.view("w1");
    expect(socket.sentOf("view")).toHaveLength(before + 1);
    act(() => socket.ack(socket.lastReqId("view"), 1));
    await expect(Promise.all([first, second])).resolves.toBeDefined();
    void rig.client.view("w2").catch(() => {});
    expect(socket.sentOf("view")).toHaveLength(before + 2);
  });

  it("does not repeat a hello for the mode already reported", async () => {
    const rig = createLiveRig();
    const socket = await rig.connect();
    rig.client.actions.setRenderer("dom");
    rig.client.actions.setRenderer("dom");
    expect(socket.sentOf("hello")).toHaveLength(1);
    rig.client.actions.setRenderer("wasm");
    expect(socket.sentOf("hello")).toHaveLength(2);
  });

  it("reports the renderer again after a reconnection", async () => {
    const rig = createLiveRig();
    const first = await rig.connect();
    rig.client.actions.setRenderer("wasm");
    expect(first.sentOf("hello")).toHaveLength(1);
    act(() => first.drop());
    await act(async () => void vi.advanceTimersByTime(1000));
    act(() => rig.sockets.last.open());
    expect(rig.sockets.last.sentOf("hello")[0]).toMatchObject({ renderer: "wasm" });
  });
});

describe("workspaceOp", () => {
  const op = (extra: Record<string, unknown>) => ({ type: "workspaceOp" as const, op: { at: 1, actor: "agent:claude", op: "rename", workspaceId: "w1", workspaceName: "Name", detail: {}, ...extra } });

  it("emits every op as an event and keeps a notice only for agents", async () => {
    const rig = createLiveRig();
    await rig.connect();
    rig.deliver(docMessage(doc, 1));
    const events: LiveEvent[] = [];
    rig.client.subscribe((e) => events.push(e));
    rig.push(op({ op: "create", actor: "agent:claude" }));
    rig.push(op({ op: "delete", actor: "user", workspaceId: "w1" }));
    expect(events.map((e) => (e.type === "workspaceOp" ? e.op.op : e.type))).toEqual(["create", "delete"]);
    expect(rig.client.store.state.workspaceNotice).toBeNull();
    rig.push(op({ op: "rename" }));
    expect(rig.client.store.state.workspaceNotice).toMatchObject({ op: "rename", workspaceName: "Name", actor: "agent:claude" });
    act(() => rig.client.actions.dismissWorkspaceNotice());
    expect(rig.client.store.state.workspaceNotice).toBeNull();
  });

  it("an agent archiving or restoring a workspace leaves the notice on screen as it was", async () => {
    const rig = createLiveRig();
    await rig.connect();
    rig.deliver(docMessage(doc, 1));
    rig.push(op({ op: "delete", workspaceId: "other", workspaceName: "Gone" }));
    const shown = rig.client.store.state.workspaceNotice;
    expect(shown).toMatchObject({ op: "delete", workspaceName: "Gone" });
    rig.push(op({ op: "archive", workspaceId: "other" }), op({ op: "unarchive", workspaceId: "other" }));
    expect(rig.client.store.state.workspaceNotice).toBe(shown);
  });

  it("ignores the rename of a workspace that is not in view", async () => {
    const rig = createLiveRig();
    await rig.connect();
    rig.deliver(docMessage(doc, 1));
    rig.push(op({ op: "rename", workspaceId: "other" }));
    expect(rig.client.store.state.workspaceNotice).toBeNull();
    rig.push(op({ op: "delete", workspaceId: "other" }));
    expect(rig.client.store.state.workspaceNotice).toMatchObject({ op: "delete" });
  });

  it("stops delivering events after unsubscribe", async () => {
    const rig = createLiveRig();
    await rig.connect();
    const listener = vi.fn();
    const off = rig.client.subscribe(listener);
    off();
    rig.push(op({ op: "delete" }));
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("presence, pins and team", () => {
  const presence = (agent: string, extra: Record<string, unknown> = {}) => ({ type: "presence" as const, agent, actor: "agent:claude", tool: "create_nodes", nodes: [a], idle: 0, ...extra });

  it("keeps the agents in order of arrival, updates one in place and drops the ones past the TTL", async () => {
    let now = 1_000_000;
    const rig = createLiveRig({ now: () => now });
    await rig.connect();
    rig.push(presence("s:1"), presence("s:2", { actor: "agent:codex" }));
    expect(rig.client.store.state.agents.map((x) => x.agent)).toEqual(["s:1", "s:2"]);
    now += 5000;
    rig.push(presence("s:1", { tool: "update_nodes", nodes: [] }));
    expect(rig.client.store.state.agents[0]).toMatchObject({ agent: "s:1", tool: "update_nodes", nodes: [a] });
    now += 200_000;
    rig.push(presence("s:3"));
    expect(rig.client.store.state.agents.map((x) => x.agent)).toEqual(["s:3"]);
  });

  it("a presence frame changes only the agents slice (the document reference stays)", async () => {
    const rig = createLiveRig();
    await rig.connect();
    rig.deliver(docMessage(doc, 1));
    const before = rig.client.store.state;
    rig.push(presence("s:1"));
    const after = rig.client.store.state;
    expect(after.doc).toBe(before.doc);
    expect(after.activity).toBe(before.activity);
    expect(after.agents).not.toBe(before.agents);
  });

  it("presence waits for the frame with the document frames: a hundred reports are one update, in order, with the time each arrived", async () => {
    let now = 1_000_000;
    const rig = createLiveRig({ now: () => now });
    const socket = await rig.connect();
    const updates = vi.fn();
    rig.client.store.subscribe(updates);
    const before = updates.mock.calls.length;
    for (let i = 0; i < 100; i += 1) {
      now += 1;
      act(() => socket.receive(presence(`s:${i % 5}`, { tool: i % 2 ? "get_nodes" : "update_nodes" })));
    }
    expect(rig.client.store.state.agents).toHaveLength(0);
    expect(updates.mock.calls.length).toBe(before);
    act(() => rig.scheduler.flush());
    expect(updates.mock.calls.length).toBe(before + 1);
    const agents = rig.client.store.state.agents;
    expect(agents.map((x) => x.agent)).toEqual(["s:0", "s:1", "s:2", "s:3", "s:4"]);
    // The last report of each, as if they had been applied one by one.
    expect(agents[4]).toMatchObject({ tool: "get_nodes", at: 1_000_100 });
    expect(agents[0]).toMatchObject({ tool: "get_nodes", at: 1_000_096 });
  });

  it("presence and a document frame of the same frame are one update", async () => {
    const rig = createLiveRig();
    const socket = await rig.connect();
    rig.deliver(docMessage(doc, 1));
    const updates = vi.fn();
    rig.client.store.subscribe(updates);
    act(() => {
      socket.receive(presence("s:1"));
      socket.receive(nodeDelta(doc, a, { x: 4 }, 2));
      socket.receive(presence("s:2"));
      rig.scheduler.flush();
    });
    expect(updates.mock.calls.length).toBe(1);
    expect(rig.client.store.state.version).toBe(2);
    expect(rig.client.store.state.agents.map((x) => x.agent)).toEqual(["s:1", "s:2"]);
  });

  it("pins is only a notice: it sets the revision and emits an event for batch 4 to invalidate its query", async () => {
    const rig = createLiveRig();
    await rig.connect();
    const events: LiveEvent[] = [];
    rig.client.subscribe((e) => events.push(e));
    rig.push({ type: "pins", rev: 4 });
    expect(rig.client.store.state.pinsRev).toBe(4);
    expect(events).toEqual([{ type: "pins", rev: 4 }]);
  });

  it("team: a ws message wins over the first fetch, and a fetch with no team is null", async () => {
    const rig = createLiveRig({ fetchTeam: () => Promise.resolve(null) });
    await rig.connect();
    await flushMicrotasks();
    expect(rig.client.store.state.team).toBeNull();
    rig.push({ type: "team", status: { team: { name: "T" } } });
    expect(rig.client.store.state.team).toEqual({ team: { name: "T" } });

    let release: (value: Record<string, unknown> | null) => void = () => {};
    const late = createLiveRig({ fetchTeam: () => new Promise((resolve) => (release = resolve)) });
    await late.connect();
    expect(late.client.store.state.team).toBeUndefined();
    late.push({ type: "team", status: { team: null, from: "ws" } });
    await act(async () => release({ from: "http" }));
    expect(late.client.store.state.team).toEqual({ team: null, from: "ws" });
  });

  it("team: a fetch that does not know (undefined) leaves the state alone: no update for the subscribers", async () => {
    const rig = createLiveRig({ fetchTeam: () => Promise.resolve(undefined) });
    const seen = vi.fn();
    rig.client.store.subscribe(seen);
    await rig.connect();
    await flushMicrotasks();
    const calls = seen.mock.calls.length;
    expect(rig.client.store.state.team).toBeUndefined();
    await flushMicrotasks();
    expect(seen.mock.calls.length).toBe(calls);
  });

  it("team: a fetch that answers with a status is used when nothing came over the socket", async () => {
    const rig = createLiveRig({ fetchTeam: () => Promise.resolve({ team: { name: "T" } }) });
    await rig.connect();
    await flushMicrotasks();
    expect(rig.client.store.state.team).toEqual({ team: { name: "T" } });
  });
});

describe("StrictMode and lifecycle", () => {
  it("opens one socket under StrictMode (mount, cleanup, mount) and closes it on unmount", async () => {
    const rig = createLiveRig();
    const view = render(
      <StrictMode>
        <LiveProvider client={rig.client}>
          <span>child</span>
        </LiveProvider>
      </StrictMode>,
    );
    await flushMicrotasks();
    expect(rig.sockets.sockets).toHaveLength(1);
    expect(rig.sockets.last.closed).toBe(false);
    view.unmount();
    expect(rig.sockets.last.closed).toBe(true);
    expect(rig.sockets.sockets).toHaveLength(1);
  });

  it("the provider builds its own client from options, only once, and without a socket at import time", async () => {
    const rig = createLiveRig();
    render(
      <StrictMode>
        <LiveProvider options={{ socketFactory: rig.sockets.factory, schedule: rig.scheduler.schedule, fetchTeam: () => Promise.resolve(null) }}>
          <span>child</span>
        </LiveProvider>
      </StrictMode>,
    );
    await flushMicrotasks();
    expect(rig.sockets.sockets).toHaveLength(1);
  });

  it("start after stop opens a new socket (the client can be reused)", async () => {
    const rig = createLiveRig();
    await rig.connect();
    rig.client.stop();
    expect(rig.sockets.last.closed).toBe(true);
    rig.client.start();
    await Promise.resolve();
    expect(rig.sockets.sockets).toHaveLength(2);
  });

  it("the default scheduler groups frames of a tick into one flush (animation frame or 50 ms)", () => {
    const schedule = frameScheduler();
    const flush = vi.fn();
    const cancel = schedule(flush);
    vi.advanceTimersByTime(60);
    expect(flush).toHaveBeenCalledTimes(1);
    cancel();
    vi.advanceTimersByTime(100);
    expect(flush).toHaveBeenCalledTimes(1);
  });
});

describe("useLive", () => {
  function Probe({ id, onRender }: { id: string; onRender: () => void }) {
    const x = useLive((s) => (s.doc?.nodes[id] as { x?: number } | undefined)?.x ?? -1);
    onRender();
    return <span data-testid={id}>{x}</span>;
  }

  it("re-renders a component only when the slice it selects changes", async () => {
    const rig = createLiveRig();
    const renders = { a: 0, b: 0 };
    render(
      <LiveProvider client={rig.client}>
        <Probe id={a} onRender={() => (renders.a += 1)} />
        <Probe id={b} onRender={() => (renders.b += 1)} />
      </LiveProvider>,
    );
    await flushMicrotasks();
    act(() => rig.sockets.last.open());
    rig.deliver(docMessage(doc, 1));
    await flushMicrotasks();
    const base = { ...renders };
    rig.deliver(nodeDelta(doc, a, { x: 42 }, 2));
    await flushMicrotasks();
    expect(screen.getByTestId(a)).toHaveTextContent("42");
    expect(renders.a).toBeGreaterThan(base.a);
    expect(renders.b).toBe(base.b);
  });

  it("throws outside a provider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Probe id="x" onRender={() => {}} />)).toThrow(/LiveProvider/);
    spy.mockRestore();
  });
});
