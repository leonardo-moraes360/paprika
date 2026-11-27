import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ServerPin } from "@/data/queries/pins";
import { dismissToasts } from "@/lib/notify";
import { fakeHttp, jsonResponse, renderRegions, serve } from "@/test/collab-harness";
import { Pins, usePinsHeader } from "./pins";

afterEach(() => {
  dismissToasts();
  vi.unstubAllGlobals();
});

const pin = (over: Partial<ServerPin>): ServerPin => ({ id: "x1", n: 1, workspaceId: "doc-1", pageId: "page-0", region: { x: 0, y: 0, width: 20, height: 20 }, text: "Title breaks", author: "user", status: "open", createdAt: Date.now() - 60_000, updatedAt: Date.now(), ...over });

function Header() {
  const { pins, onPinsClick } = usePinsHeader();
  return <button onClick={onPinsClick}>{`pins:${pins}`}</button>;
}

async function setup(pins: ServerPin[], initial = {}) {
  let list = pins;
  const calls = fakeHttp({
    "GET /api/pins": () => jsonResponse({ pins: list, rev: 1 }),
    "POST /api/pins": (call) => {
      const body = call.body as { text: string };
      list = [...list, pin({ id: "new", n: list.length + 1, text: body.text, nodeId: "n3", nodeName: "Rect 3" })];
      return jsonResponse({ pin: list.at(-1) }, 201);
    },
    "POST /api/pins/x2/replies": () => {
      list = list.map((p) => (p.id === "x2" ? { ...p, replies: [...(p.replies ?? []), { id: "r9", author: "user", text: "Thanks", createdAt: Date.now() }] } : p));
      return jsonResponse({ pin: list[1] }, 201);
    },
    "PATCH /api/pins/x2": () => {
      list = list.map((p) => (p.id === "x2" ? { ...p, status: "resolved" as const } : p));
      return jsonResponse({ pin: list[1] });
    },
    "DELETE /api/pins/x2": () => {
      list = list.filter((p) => p.id !== "x2");
      return jsonResponse({ deleted: "x2" });
    },
  });
  const view = await renderRegions({ regions: [["pins", <Pins key="p" />], ["header", <Header key="h" />]], initial });
  serve(view.rig, view.doc);
  return { ...view, calls };
}

const open = (view: Awaited<ReturnType<typeof setup>>) => act(() => view.handle.current!.actions.openDialog("pins"));

describe("Pins region", () => {
  const pins = [pin({ id: "x1", n: 1 }), pin({ id: "x2", n: 2, status: "claimed", claimedBy: "agent:claude", nodeId: "n3", nodeName: "Rect 3", text: "Bigger button", replies: [{ id: "r1", author: "agent:claude", text: "On it", createdAt: Date.now() - 5000 }] }), pin({ id: "x3", n: 3, status: "resolved", text: "Footer" })];

  it("renders nothing until the editor flag opens it, and the header count follows the same list", async () => {
    const view = await setup(pins);
    await screen.findByText("pins:2");
    expect(screen.queryByTestId("pins-panel")).toBeNull();
    await open(view);
    const panel = await screen.findByTestId("pins-panel");
    expect(within(panel).getByText("Open 2")).toBeInTheDocument();
    expect(within(panel).getByText("Title breaks")).toBeInTheDocument();
    expect(within(panel).queryByText("Footer")).toBeNull();
    expect(view.calls[0]!.url).toBe("/api/pins?workspaceId=doc-1&status=all");
    await userEvent.setup().click(screen.getByRole("button", { name: "pins:2" }));
    await waitFor(() => expect(screen.queryByTestId("pins-panel")).toBeNull());
  });

  it("selects a pin in the list and shows its card with the claim, the thread and the author as you", async () => {
    const view = await setup(pins);
    await open(view);
    const user = userEvent.setup();
    await user.click(await screen.findByText("Bigger button"));
    const card = await screen.findByTestId("pin-card");
    expect(view.handle.current!.state.pinId).toBe("x2");
    expect(within(card).getByText("Bigger button")).toBeInTheDocument();
    expect(within(card).getByText("On it")).toBeInTheDocument();
    expect(within(card).getByText("Rect 3")).toBeInTheDocument();
    expect(within(card).getAllByText("claude").length).toBeGreaterThan(0);
    expect(within(card).getByText("you")).toBeInTheDocument();
    await user.click(within(card).getByRole("button", { name: "Close" }));
    expect(screen.queryByTestId("pin-card")).toBeNull();
  });

  it("replies, resolves and deletes through the server and refetches", async () => {
    const view = await setup(pins, { pinId: "x2" });
    await open(view);
    const user = userEvent.setup();
    const card = await screen.findByTestId("pin-card");
    await user.type(within(card).getByRole("textbox"), "Thanks{Enter}");
    await waitFor(() => expect(view.calls.some((c) => c.method === "POST" && c.url === "/api/pins/x2/replies")).toBe(true));
    expect(view.calls.find((c) => c.url === "/api/pins/x2/replies")!.body).toEqual({ text: "Thanks" });
    expect(await within(await screen.findByTestId("pin-card")).findByText("Thanks")).toBeInTheDocument();
    await user.click(within(screen.getByTestId("pin-card")).getByRole("button", { name: "Mark resolved" }));
    await waitFor(() => expect(view.calls.find((c) => c.method === "PATCH")?.body).toEqual({ status: "resolved" }));
    await user.click(within(screen.getByTestId("pin-card")).getByRole("button", { name: "Delete pin" }));
    await waitFor(() => expect(view.calls.some((c) => c.method === "DELETE" && c.url === "/api/pins/x2")).toBe(true));
    await waitFor(() => expect(screen.queryByTestId("pin-card")).toBeNull());
    expect(view.handle.current!.state.pinId).toBeNull();
  });

  it("shows the error of a refused reply inside the card", async () => {
    const view = await setup(pins, { pinId: "x2" });
    fakeHttp({ "GET /api/pins": () => jsonResponse({ pins }), "POST /api/pins/x2/replies": () => jsonResponse({ error: "pin already resolved" }, 409) });
    await open(view);
    const user = userEvent.setup();
    const card = await screen.findByTestId("pin-card");
    await user.type(within(card).getByRole("textbox"), "late{Enter}");
    expect(await within(card).findByRole("alert")).toHaveTextContent("pin already resolved");
  });

  it("'show' goes to the page of the pin and selects its node", async () => {
    const view = await setup([pin({ id: "x2", n: 2, nodeId: "n3", pageId: "page-0" })], { pinId: "x2", selection: [] });
    await open(view);
    await userEvent.setup().click(await screen.findByRole("button", { name: "Show on canvas" }));
    expect(view.handle.current!.state.selection).toEqual(["n3"]);
  });

  it("opens the new-pin form for the SELECTED NODE with the pin tool, and creates the pin on it with the node's box", async () => {
    const view = await setup([], { tool: "pin", selection: ["n3"] });
    const form = await screen.findByTestId("new-pin-form");
    expect(within(form).getByText("Target: Rect 3")).toBeInTheDocument();
    expect(within(form).queryByRole("checkbox")).toBeNull();
    const user = userEvent.setup();
    await user.type(within(form).getByRole("textbox"), "Make it blue");
    await user.click(within(form).getByRole("button", { name: "Send" }));
    await waitFor(() => expect(view.calls.some((c) => c.method === "POST" && c.url === "/api/pins")).toBe(true));
    const body = view.calls.find((c) => c.method === "POST" && c.url === "/api/pins")!.body as Record<string, unknown>;
    expect(body).toMatchObject({ workspaceId: "doc-1", nodeId: "n3", pageId: "page-0", text: "Make it blue" });
    expect(body).not.toHaveProperty("recipients");
    expect(body.region).toEqual({ x: expect.any(Number), y: expect.any(Number), width: 20, height: 20 });
    await waitFor(() => expect(view.handle.current!.state.tool).toBe("select"));
    expect(view.handle.current!.state.pinId).toBe("new");
  });

  it("has no form without a selected node, and cancelling goes back to the select tool", async () => {
    const view = await setup([], { tool: "pin", selection: [] });
    expect(screen.queryByTestId("new-pin-form")).toBeNull();
    act(() => view.handle.current!.actions.select(["n3"]));
    const form = await screen.findByTestId("new-pin-form");
    await userEvent.setup().click(within(form).getByRole("button", { name: "Cancel" }));
    expect(view.handle.current!.state.tool).toBe("select");
  });

  it("refetches when the server announces a new revision (an agent claimed or answered a pin)", async () => {
    const view = await setup(pins);
    await open(view);
    await screen.findByText("Title breaks");
    const before = view.calls.filter((c) => c.method === "GET").length;
    view.rig.push({ type: "pins", rev: 9 });
    await waitFor(() => expect(view.calls.filter((c) => c.method === "GET").length).toBeGreaterThan(before));
  });

  it("tells the person when the list cannot be loaded", async () => {
    fakeHttp({ "GET /api/pins": () => jsonResponse({ error: "database is locked" }, 500) });
    const view = await renderRegions({ regions: [["pins", <Pins key="p" />]], initial: { dialogs: { history: false, pins: true, export: false, import: false, agents: false, team: false } } });
    serve(view.rig, view.doc);
    expect(await screen.findByText("Could not load the pins.", undefined, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByText("database is locked")).toBeInTheDocument();
  });
});
