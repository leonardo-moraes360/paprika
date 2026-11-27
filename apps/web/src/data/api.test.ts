import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, fetchTeamStatus, jsonRequest, workspacePath } from "./api";

const reply = (body: BodyInit | null, init: ResponseInit) => Promise.resolve(new Response(body, init));
const json = (value: unknown, status = 200) => reply(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

afterEach(() => vi.unstubAllGlobals());

describe("api", () => {
  it("returns the JSON body of a successful answer", async () => {
    vi.stubGlobal("fetch", vi.fn(() => json({ ok: 1 })));
    await expect(api("/api/x")).resolves.toEqual({ ok: 1 });
  });

  it("turns {error} of a failed answer into an ApiError with that message and status", async () => {
    vi.stubGlobal("fetch", vi.fn(() => json({ error: "name cannot be blank" }, 400)));
    const error = await api("/api/x").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: "http", status: 400, message: "name cannot be blank", path: "/api/x" });
  });

  it("falls back to the status text when a 4xx has no JSON body", async () => {
    vi.stubGlobal("fetch", vi.fn(() => reply("oops", { status: 404, statusText: "Not Found" })));
    await expect(api("/api/x")).rejects.toMatchObject({ code: "http", message: "Not Found" });
  });

  it("says there is no connection to the server on 502, 503 and 504 (a proxy answering for a server that is not there), not the proxy's text", async () => {
    for (const status of [502, 503, 504]) {
      vi.stubGlobal("fetch", vi.fn(() => reply("oops", { status, statusText: "Bad Gateway" })));
      await expect(api("/api/x")).rejects.toMatchObject({ code: "network", status, message: "no connection to the server" });
    }
  });

  it("treats a 200 that is not JSON (the SPA fallback) as an invalid response", async () => {
    vi.stubGlobal("fetch", vi.fn(() => reply("<!doctype html>", { status: 200, headers: { "content-type": "text/html" } })));
    await expect(api("/api/team")).rejects.toMatchObject({ code: "invalid-response", path: "/api/team", message: "Invalid response from /api/team" });
  });

  it("wraps a network failure and lets an abort through untouched", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))));
    await expect(api("/api/x")).rejects.toMatchObject({ code: "network", message: "no connection to the server" });
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new DOMException("aborted", "AbortError"))));
    await expect(api("/api/x", { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  });

  it("builds JSON requests and workspace paths", () => {
    expect(jsonRequest("POST", { a: 1 })).toEqual({ method: "POST", headers: { "content-type": "application/json" }, body: '{"a":1}' });
    expect(jsonRequest("DELETE")).toEqual({ method: "DELETE" });
    expect(workspacePath("a b/c")).toBe("/api/workspaces/a%20b%2Fc");
  });
});

describe("fetchTeamStatus", () => {
  it("is null when there is no team mode: a 404, or an HTML fallback", async () => {
    vi.stubGlobal("fetch", vi.fn(() => reply("<!doctype html>", { status: 200, headers: { "content-type": "text/html; charset=utf-8" } })));
    await expect(fetchTeamStatus()).resolves.toBeNull();
    vi.stubGlobal("fetch", vi.fn(() => reply("not found", { status: 404 })));
    await expect(fetchTeamStatus()).resolves.toBeNull();
    vi.stubGlobal("fetch", vi.fn(() => json({ error: "no such route" }, 404)));
    await expect(fetchTeamStatus()).resolves.toBeNull();
  });

  it("is undefined (not known) for a JSON error of the sidecar and for a network failure, so the team tab does not disappear", async () => {
    vi.stubGlobal("fetch", vi.fn(() => json({ error: "bad request" }, 400)));
    await expect(fetchTeamStatus()).resolves.toBeUndefined();
    vi.stubGlobal("fetch", vi.fn(() => json({ error: "sidecar down" }, 503)));
    await expect(fetchTeamStatus()).resolves.toBeUndefined();
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("down"))));
    await expect(fetchTeamStatus()).resolves.toBeUndefined();
  });

  it("is the status object when the sidecar answers JSON", async () => {
    vi.stubGlobal("fetch", vi.fn(() => json({ team: null, peers: {} })));
    await expect(fetchTeamStatus()).resolves.toEqual({ team: null, peers: {} });
  });
});
