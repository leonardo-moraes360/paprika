import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLiveRig, type LiveRig } from "@/test/live-harness";
import { LiveProvider } from "../live";
import { fetchPng } from "./export";
import { pinsKey, useOpenPinCount, usePinActions, usePins, usePinsLiveSync, type ServerPin } from "./pins";
import { teamCommands } from "./team";

const reply = (body: BodyInit | null, init: ResponseInit = {}) => Promise.resolve(new Response(body, init));
const json = (value: unknown, status = 200) => reply(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

type Call = { url: string; method: string; body: unknown };
/** A fake server: `routes` maps "METHOD /path" (query string ignored) to a handler; the calls are recorded. */
function fakeServer(routes: Record<string, (call: Call) => Promise<Response>>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string, init?: RequestInit) => {
      const call: Call = { url: input, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined };
      calls.push(call);
      const handler = routes[`${call.method} ${input.split("?")[0]}`];
      return handler ? handler(call) : json({ error: `no route for ${call.method} ${input}` }, 404);
    }),
  );
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

const pin = (over: Partial<ServerPin> = {}): ServerPin => ({ id: "x1", n: 1, workspaceId: "w1", region: { x: 0, y: 0, width: 10, height: 10 }, text: "t", author: "user", status: "open", createdAt: 1, updatedAt: 1, ...over });

function wrapper(rig: LiveRig, client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return { client, Wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}><LiveProvider client={rig.client}>{children}</LiveProvider></QueryClientProvider> };
}

describe("pins queries", () => {
  it("lists every pin of the workspace (status=all) and counts the ones not resolved", async () => {
    const calls = fakeServer({ "GET /api/pins": () => json({ pins: [pin(), pin({ id: "x2", status: "claimed" }), pin({ id: "x3", status: "resolved" })], rev: 3 }) });
    const { Wrapper } = wrapper(createLiveRig());
    const list = renderHook(() => usePins("w 1"), { wrapper: Wrapper });
    await waitFor(() => expect(list.result.current.data).toHaveLength(3));
    expect(calls[0]!.url).toBe("/api/pins?workspaceId=w%201&status=all");
    const count = renderHook(() => useOpenPinCount("w 1"), { wrapper: Wrapper });
    await waitFor(() => expect(count.result.current).toBe(2));
  });

  it("refetches the list when the server announces a pins revision", async () => {
    let served = 0;
    const calls = fakeServer({ "GET /api/pins": () => json({ pins: Array.from({ length: ++served }, (_, i) => pin({ id: `p${i}` })) }) });
    const rig = createLiveRig();
    await rig.connect();
    const { Wrapper } = wrapper(rig);
    const hook = renderHook(() => { usePinsLiveSync("w1"); return usePins("w1"); }, { wrapper: Wrapper });
    await waitFor(() => expect(hook.result.current.data).toBeDefined());
    await new Promise((resolve) => setTimeout(resolve, 30));
    const before = calls.length;
    const shown = hook.result.current.data!.length;
    rig.push({ type: "pins", rev: 5 });
    await waitFor(() => expect(hook.result.current.data!.length).toBeGreaterThan(shown));
    expect(calls.length).toBe(before + 1);
  });

  it("refetches the list when the socket comes back after a drop", async () => {
    let served = 0;
    const calls = fakeServer({ "GET /api/pins": () => json({ pins: Array.from({ length: ++served }, (_, i) => pin({ id: `p${i}` })) }) });
    const rig = createLiveRig({ delays: [0] });
    const socket = await rig.connect();
    const { Wrapper } = wrapper(rig);
    const hook = renderHook(() => { usePinsLiveSync("w1"); return usePins("w1"); }, { wrapper: Wrapper });
    await waitFor(() => expect(hook.result.current.data).toBeDefined());
    const before = calls.length;
    act(() => socket.drop());
    await waitFor(() => expect(rig.sockets.last).not.toBe(socket));
    act(() => rig.sockets.last.open());
    await waitFor(() => expect(calls.length).toBe(before + 1));
  });

  it("creates, answers, resolves, reopens and deletes through the server routes, refetching after each", async () => {
    const calls = fakeServer({
      "GET /api/pins": () => json({ pins: [] }),
      "POST /api/pins": () => json({ pin: pin({ id: "new" }) }, 201),
      "POST /api/pins/x1/replies": () => json({ pin: pin() }, 201),
      "PATCH /api/pins/x1": () => json({ pin: pin({ status: "resolved" }) }),
      "DELETE /api/pins/x1": () => json({ deleted: "x1" }),
    });
    const { Wrapper, client } = wrapper(createLiveRig());
    const hook = renderHook(() => usePinActions("w1"), { wrapper: Wrapper });
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const created = await act(() => hook.result.current.create({ workspaceId: "w1", pageId: null, nodeId: "n1", region: { x: 1, y: 2, width: 3, height: 4 }, text: "Hello" }));
    expect(created.id).toBe("new");
    await act(() => hook.result.current.reply("x1", "On it"));
    await act(() => hook.result.current.setStatus("x1", "resolved"));
    await act(() => hook.result.current.remove("x1"));
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual(["POST /api/pins", "POST /api/pins/x1/replies", "PATCH /api/pins/x1", "DELETE /api/pins/x1"]);
    expect(calls[0]!.body).toEqual({ workspaceId: "w1", nodeId: "n1", region: { x: 1, y: 2, width: 3, height: 4 }, text: "Hello" });
    expect(calls[1]!.body).toEqual({ text: "On it" });
    expect(calls[2]!.body).toEqual({ status: "resolved" });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: pinsKey("w1") });
    expect(invalidate.mock.calls.length).toBeGreaterThanOrEqual(4);
  });

  it("rejects with the server's message", async () => {
    fakeServer({ "POST /api/pins/x1/replies": () => json({ error: "pin already resolved" }, 409) });
    const { Wrapper } = wrapper(createLiveRig());
    const hook = renderHook(() => usePinActions("w1"), { wrapper: Wrapper });
    await expect(hook.result.current.reply("x1", "late")).rejects.toThrow("pin already resolved");
  });
});

describe("team commands", () => {
  it("call each /api/team route with the body the server reads", async () => {
    const calls = fakeServer({
      "POST /api/team": () => json({}),
      "POST /api/team/share": () => json({ doc: "d" }),
      "POST /api/team/invites": () => json({ link: "paprika://join/x", expiresAt: 10 }),
      "DELETE /api/team/invites": () => json({}),
      "POST /api/team/invites/inspect": () => json({ name: "N", fingerprint: "F", expiresAt: 1, expired: false }),
      "POST /api/team/join": () => json({}),
      "DELETE /api/team/members/KEY%2FA": () => json({ removed: "k" }),
      "POST /api/team/leave": () => json({}),
      "POST /api/team/rotate": () => json({ fingerprint: "NEW" }),
    });
    await teamCommands.createTeam("North");
    await teamCommands.share("doc-1");
    expect(await teamCommands.createInvite(3600)).toEqual({ link: "paprika://join/x", expiresAt: 10 });
    await teamCommands.revokeInvites();
    await teamCommands.inspectInvite("paprika://join/x");
    await teamCommands.join("paprika://join/x");
    await teamCommands.removeMember("KEY/A");
    await teamCommands.leave();
    expect(await teamCommands.rotateKey()).toEqual({ fingerprint: "NEW" });
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      "POST /api/team",
      "POST /api/team/share",
      "POST /api/team/invites",
      "DELETE /api/team/invites",
      "POST /api/team/invites/inspect",
      "POST /api/team/join",
      "DELETE /api/team/members/KEY%2FA",
      "POST /api/team/leave",
      "POST /api/team/rotate",
    ]);
    expect(calls[0]!.body).toEqual({ name: "North" });
    expect(calls[1]!.body).toEqual({ doc: "doc-1" });
    expect(calls[2]!.body).toEqual({ ttlSecs: 3600 });
    expect(calls[4]!.body).toEqual({ link: "paprika://join/x" });
  });

  it("answers an error of a server without team mode (HTML fallback) as an error, never as data", async () => {
    fakeServer({ "POST /api/team/join": () => reply("<!doctype html>", { status: 200, headers: { "content-type": "text/html" } }) });
    await expect(teamCommands.join("x")).rejects.toMatchObject({ code: "invalid-response" });
  });
});

describe("image export", () => {
  it("asks for the PNG only when the workspace in view is the one the server has open, and never opens one", async () => {
    const calls = fakeServer({ "GET /api/health": () => json({ ok: true, docId: "other" }) });
    await expect(fetchPng("w1", "f1", 1)).rejects.toMatchObject({ code: "http", status: 409, message: expect.stringContaining("PNG needs this workspace") });
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual(["GET /api/health"]);
  });

  it("returns the PNG as a blob, with the root and scale in the query", async () => {
    const calls = fakeServer({ "GET /api/health": () => json({ docId: "w1" }), "GET /api/screenshot": () => reply(new Uint8Array([137, 80, 78, 71]), { headers: { "content-type": "image/png" } }) });
    const blob = await fetchPng("w1", "f 1", 2);
    expect(blob.size).toBe(4);
    expect(calls.map((call) => call.url)).toEqual(["/api/health", "/api/screenshot?root=f%201&scale=2"]);
  });

  it("shows the server's error when it cannot take the screenshot", async () => {
    fakeServer({ "GET /api/health": () => json({ docId: "w1" }), "GET /api/screenshot": () => json({ error: "screenshot unavailable: Chromium not found" }, 500) });
    await expect(fetchPng("w1", null, 1)).rejects.toMatchObject({ code: "http", status: 500, message: "screenshot unavailable: Chromium not found" });
  });

  it("does not take a 200 that is not a PNG for one", async () => {
    fakeServer({ "GET /api/health": () => json({ docId: "w1" }), "GET /api/screenshot": () => reply("<html>", { headers: { "content-type": "text/html" } }) });
    await expect(fetchPng("w1", null, 1)).rejects.toMatchObject({ code: "http" });
  });
});
