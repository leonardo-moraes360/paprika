import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Op } from "@paprika/core";
import { dismissToasts } from "@/lib/notify";
import { deltaMessage, makeDocument, renderEditorRig, serveDocument } from "@/test/live-harness";

const steps = [
  { id: 1, actor: "user", label: "first edit", at: Date.now() - 60_000, ops: 1, undone: false, nodeIds: ["n3"] },
  { id: 2, actor: "agent:claude", label: "agent edit", at: Date.now() - 30_000, ops: 2, undone: false, nodeIds: ["n3"] },
];

function stubFetch(extra: (url: string) => unknown = () => undefined) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      const custom = extra(url);
      const body = custom ?? (url.includes("/history") ? { version: 2, steps, canUndo: true, canRedo: false } : url.includes("/api/pins") ? { pins: [{ id: "a" }, { id: "b" }] } : {});
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }),
  );
  return calls;
}

async function openShell(options: { nodes?: number; pages?: number } = {}) {
  const view = await renderEditorRig({ nodes: options.nodes ?? 14 });
  const doc = options.pages ? makeDocument(options.nodes ?? 14, { id: "doc-1", pageCount: options.pages, perFrame: 3 }) : view.doc;
  view.socket.autoAck = true;
  serveDocument(view.rig, doc);
  await screen.findByRole("banner");
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  return { ...view, doc };
}

const opsSent = (view: Awaited<ReturnType<typeof openShell>>) => view.socket.sentOf("ops");
const lastOps = (view: Awaited<ReturnType<typeof openShell>>) => opsSent(view).at(-1) as { ops: Op[]; label: string };
const tree = () => screen.getByRole("tree", { name: "Layer tree" });
const layer = (name: string) => within(tree()).getByRole("treeitem", { name });

beforeAll(() => {
  Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => null });
  // jsdom has no layout: the virtual lists of the history panel need a viewport to show rows.
  for (const key of ["clientHeight", "offsetHeight"]) Object.defineProperty(HTMLElement.prototype, key, { configurable: true, get: () => 400 });
  for (const key of ["clientWidth", "offsetWidth"]) Object.defineProperty(HTMLElement.prototype, key, { configurable: true, get: () => 360 });
});
beforeEach(() => {
  stubFetch();
});
afterEach(() => {
  vi.unstubAllGlobals();
  dismissToasts();
});

describe("header", () => {
  it("shows the path, the open pins and, when an agent is present, the active agents", async () => {
    const view = await openShell();
    const header = screen.getByRole("banner");
    expect(within(header).getByRole("link", { name: "Workspaces" })).toBeInTheDocument();
    expect(within(header).getByText("Synthetic")).toBeInTheDocument();
    expect(within(header).getByText("Page 1")).toBeInTheDocument();
    expect(await within(header).findByText("2 open")).toBeInTheDocument();
    expect(within(header).queryByText(/active/)).not.toBeInTheDocument();
    view.rig.push({ type: "presence", agent: "a:1", actor: "agent:claude", tool: "update_nodes", nodes: ["n3"], idle: 0 });
    expect(await within(header).findByText("1 active")).toBeInTheDocument();
    view.unmount();
  });

  it("shows the team chip only when the sidecar reports a joined team", async () => {
    const view = await openShell();
    expect(screen.queryByText(/online/)).not.toBeInTheDocument();
    view.rig.push({ type: "team", status: { team: { name: "Estúdio Norte" }, peers: [{ state: "direct" }] } });
    expect(await screen.findByText("Estúdio Norte · 2 online")).toBeInTheDocument();
    view.unmount();
  });
});

describe("pages", () => {
  it("opens another page (the layers follow), creates one by add_page and deletes with a confirmation", async () => {
    const user = userEvent.setup();
    const view = await openShell({ nodes: 30, pages: 2 });
    expect(within(tree()).getAllByRole("treeitem", { name: "Frame" }).length).toBeGreaterThan(0);
    const before = within(tree()).getAllByRole("treeitem").map((el) => el.textContent);
    await user.click(screen.getByRole("button", { name: "Page 2" }));
    await waitFor(() => expect(within(tree()).getAllByRole("treeitem").map((el) => el.textContent)).not.toEqual(before));
    expect(within(screen.getByRole("banner")).getByText("Page 2")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "New page" }));
    await waitFor(() => expect(opsSent(view)).toHaveLength(1));
    expect(lastOps(view)).toMatchObject({ label: "create page", ops: [{ op: "add_page", name: "Page 3" }] });

    await user.click(screen.getByRole("button", { name: "Delete page Page 2" }));
    await user.click(await screen.findByRole("button", { name: "Delete page" }));
    await waitFor(() => expect(opsSent(view)).toHaveLength(2));
    expect(lastOps(view)).toMatchObject({ label: "delete page", ops: [{ op: "delete", id: "page-1" }] });
    view.unmount();
  });

  it("goes back to the first page when the page in view is deleted by someone else", async () => {
    const user = userEvent.setup();
    const view = await openShell({ nodes: 30, pages: 2 });
    await user.click(screen.getByRole("button", { name: "Page 2" }));
    await waitFor(() => expect(within(screen.getByRole("banner")).getByText("Page 2")).toBeInTheDocument());
    const doc = view.rig.client.store.state.doc!;
    const { ["page-1"]: _gone, ...rest } = doc.nodes;
    view.rig.deliver(deltaMessage(doc, 2, { rootIds: ["page-0"], nodes: { del: ["page-1"] } }));
    expect(rest).toBeDefined();
    await waitFor(() => expect(within(screen.getByRole("banner")).getByText("Page 1")).toBeInTheDocument());
    view.unmount();
  });
});

describe("layers", () => {
  it("selects with a click, extends with Ctrl, and Esc steps up to the parent", async () => {
    const user = userEvent.setup();
    const view = await openShell();
    const names = within(tree()).getAllByRole("treeitem").map((el) => el.textContent as string);
    const [first, second] = [names[1] as string, names[2] as string];
    await user.click(within(layer(first)).getByText(first));
    expect(layer(first)).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{Control>}");
    await user.click(within(layer(second)).getByText(second));
    await user.keyboard("{/Control}");
    expect(layer(first)).toHaveAttribute("aria-selected", "true");
    expect(layer(second)).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{Escape}");
    expect(layer(first)).toHaveAttribute("aria-selected", "false");
    expect(layer("Frame")).toHaveAttribute("aria-selected", "true");
    view.unmount();
  });

  it("a plain click on a layer inside a multiple selection selects just that layer", async () => {
    const user = userEvent.setup();
    const view = await openShell();
    const names = within(tree()).getAllByRole("treeitem").map((el) => el.textContent as string);
    const [a, b, c] = [names[1] as string, names[2] as string, names[3] as string];
    await user.click(within(layer(a)).getByText(a));
    await user.keyboard("{Control>}");
    await user.click(within(layer(b)).getByText(b));
    await user.click(within(layer(c)).getByText(c));
    await user.keyboard("{/Control}");
    expect(within(tree()).getAllByRole("treeitem").filter((el) => el.getAttribute("aria-selected") === "true")).toHaveLength(3);
    await user.click(within(layer(b)).getByText(b));
    expect(within(tree()).getAllByRole("treeitem").filter((el) => el.getAttribute("aria-selected") === "true").map((el) => el.textContent)).toEqual([b]);
    view.unmount();
  });

  it("forgets a selected layer that someone else deleted, so a later Delete sends nothing", async () => {
    const user = userEvent.setup();
    const view = await openShell();
    const name = within(tree()).getAllByRole("treeitem")[2]?.textContent as string;
    await user.click(within(layer(name)).getByText(name));
    const doc = view.rig.client.store.state.doc!;
    const id = Object.values(doc.nodes).find((node) => node.name === name)!.id;
    view.rig.deliver(deltaMessage(doc, 2, { nodes: { del: [id] } }));
    await waitFor(() => expect(within(tree()).queryByRole("treeitem", { name })).not.toBeInTheDocument());
    await user.keyboard("{Delete}");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(opsSent(view)).toHaveLength(0);
    view.unmount();
  });

  it("dropping a layer after another sends a move op with the sibling index", async () => {
    const view = await openShell();
    const names = within(tree()).getAllByRole("treeitem").map((el) => el.textContent as string);
    const [a, c] = [names[1] as string, names[3] as string];
    const source = within(layer(a)).getByText(a);
    const target = layer(c);
    const box = { top: 0, bottom: 28, left: 0, right: 200, width: 200, height: 28, x: 0, y: 0, toJSON: () => ({}) };
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue(box);
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => target });
    const fire = (type: string, y: number, node: EventTarget = document) => node.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, isPrimary: true, pointerId: 1, clientX: 40, clientY: y }));
    act(() => {
      fire("pointerdown", 14, source);
      fire("pointermove", 60);
      fire("pointermove", 26);
      fire("pointerup", 26);
    });
    await waitFor(() => expect(opsSent(view)).toHaveLength(1));
    expect(lastOps(view)).toMatchObject({ label: "reorder layer", ops: [{ op: "move", index: 2 }] });
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => null });
    view.unmount();
  });

  it("renames, hides and locks by update ops, and refuses nothing silently when offline", async () => {
    const user = userEvent.setup();
    const view = await openShell();
    const name = within(tree()).getAllByRole("treeitem")[1]?.textContent as string;
    await user.dblClick(within(layer(name)).getByText(name));
    const input = await screen.findByRole("textbox", { name: "Layer name" });
    await user.clear(input);
    await user.type(input, "Renamed{Enter}");
    await waitFor(() => expect(opsSent(view)).toHaveLength(1));
    expect(lastOps(view)).toMatchObject({ label: "rename layer", ops: [{ op: "update", props: { name: "Renamed" } }] });

    await user.click(within(layer(name)).getByRole("button", { name: `Hide ${name}` }));
    await waitFor(() => expect(opsSent(view)).toHaveLength(2));
    expect(lastOps(view)).toMatchObject({ label: "hide", ops: [{ op: "update", props: { visible: false } }] });

    act(() => view.socket.drop());
    await user.click(within(layer(name)).getByRole("button", { name: `Hide ${name}` }));
    expect(await screen.findByText("Connection lost. Changes cannot be sent until it is back.")).toBeInTheDocument();
    view.unmount();
  });

  it("the context menu offers group, wrap, duplicate and delete, which send their ops", async () => {
    const user = userEvent.setup();
    const view = await openShell();
    const name = within(tree()).getAllByRole("treeitem")[1]?.textContent as string;
    await user.pointer({ keys: "[MouseRight]", target: within(layer(name)).getByText(name) });
    await user.click(await screen.findByRole("menuitem", { name: "Duplicate" }));
    await waitFor(() => expect(opsSent(view)).toHaveLength(1));
    expect(lastOps(view)).toMatchObject({ label: "duplicate", ops: [{ op: "create" }] });
    await user.pointer({ keys: "[MouseRight]", target: within(layer(name)).getByText(name) });
    await user.click(await screen.findByRole("menuitem", { name: "Group" }));
    await waitFor(() => expect(opsSent(view)).toHaveLength(2));
    expect(lastOps(view)).toMatchObject({ label: "group", ops: [{ op: "group", ids: [expect.any(String)] }] });
    view.unmount();
  });
});

describe("stage", () => {
  it("has the toolbar with the old app's tools, the zoom bar, and no renderer menu", async () => {
    const user = userEvent.setup();
    const view = await openShell();
    expect(screen.getByRole("toolbar", { name: "Tools" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Select" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Rectangle" }));
    expect(screen.getByRole("button", { name: "Rectangle" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("100%")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(screen.getByText("125%")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Renderer/ })).not.toBeInTheDocument();
    expect(view.socket.sentOf("hello")).toEqual([]);
    view.unmount();
  });
});

describe("keyboard", () => {
  it("tool keys pick the tool, but not while typing in a field", async () => {
    const user = userEvent.setup();
    const view = await openShell();
    await user.keyboard("r");
    expect(screen.getByRole("button", { name: "Rectangle" })).toHaveAttribute("aria-pressed", "true");
    const field = document.body.appendChild(document.createElement("input"));
    field.focus();
    await user.keyboard("o");
    expect(screen.getByRole("button", { name: "Ellipse" })).toHaveAttribute("aria-pressed", "false");
    field.remove();
    const name = within(tree()).getAllByRole("treeitem")[1]?.textContent as string;
    await user.click(within(layer(name)).getByText(name));
    await user.keyboard("t");
    expect(screen.getByRole("button", { name: "Text" })).toHaveAttribute("aria-pressed", "false");
    (document.activeElement as HTMLElement | null)?.blur();
    await user.keyboard("v");
    expect(screen.getByRole("button", { name: "Select" })).toHaveAttribute("aria-pressed", "true");
    view.unmount();
  });

  it("Ctrl+Z asks for the own undo, with the toast of the answer; a conflict explains itself", async () => {
    const user = userEvent.setup();
    const view = await openShell();
    view.socket.autoAck = false;
    await user.keyboard("{Control>}z{/Control}");
    const sent = view.socket.sentOf("undo") as { reqId?: string }[];
    expect(sent).toEqual([{ type: "undo", mode: "own", reqId: expect.any(String) }]);
    act(() => view.socket.ack(sent[0]?.reqId, 1, { step: { result: "undone", ord: 4, label: "move", actor: "user", newer: 0 } }));
    expect(await screen.findByText("Undone: move")).toBeInTheDocument();
    await user.keyboard("{Control>}{Shift>}z{/Shift}{/Control}");
    const redo = view.socket.sentOf("redo") as { reqId?: string }[];
    expect(redo).toEqual([{ type: "redo", mode: "own", reqId: expect.any(String) }]);
    act(() => view.socket.ack(redo[0]?.reqId, 1, { step: { result: "conflict", ord: 0, label: "", actor: "", newer: 0 } }));
    expect(await screen.findByText("Can’t redo this step: newer steps changed the same elements.")).toBeInTheDocument();
    view.unmount();
  });

  it("Delete removes the selection, Ctrl+A selects the siblings, Ctrl+G groups, and an arrow nudges", async () => {
    const user = userEvent.setup();
    const view = await openShell();
    const name = within(tree()).getAllByRole("treeitem")[1]?.textContent as string;
    await user.click(within(layer(name)).getByText(name));
    await user.keyboard("{Control>}a{/Control}");
    const selected = within(tree()).getAllByRole("treeitem").filter((el) => el.getAttribute("aria-selected") === "true");
    expect(selected.length).toBeGreaterThan(1);
    await user.keyboard("{Escape}");
    await user.click(within(layer(name)).getByText(name));
    (document.activeElement as HTMLElement | null)?.blur();
    await user.keyboard("{Delete}");
    await waitFor(() => expect(opsSent(view)).toHaveLength(1));
    expect(lastOps(view)).toMatchObject({ label: "delete", ops: [{ op: "delete" }] });
    view.unmount();
  });

  it("Ctrl+H opens the history, Esc closes it; the keys do nothing inside a dialog", async () => {
    const user = userEvent.setup();
    const view = await openShell();
    await user.keyboard("{Control>}h{/Control}");
    expect(await screen.findByRole("region", { name: "History" })).toBeInTheDocument();
    expect(await screen.findByText("first edit")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("region", { name: "History" })).not.toBeInTheDocument());
    const dialog = document.body.appendChild(Object.assign(document.createElement("div"), { role: "dialog", tabIndex: 0 }));
    dialog.focus();
    await user.keyboard("r");
    expect(screen.getByRole("button", { name: "Select" })).toHaveAttribute("aria-pressed", "true");
    dialog.remove();
    view.unmount();
  });
});

describe("history", () => {
  it("lists the steps with you and the agents, undoes a step by its number and goes to its nodes", async () => {
    const user = userEvent.setup();
    const view = await openShell();
    await user.keyboard("{Control>}h{/Control}");
    const panel = await screen.findByRole("region", { name: "History" });
    expect(await within(panel).findByText("first edit")).toBeInTheDocument();
    expect(within(panel).getAllByText("claude").length).toBeGreaterThan(0);
    await user.click(within(panel).getByRole("button", { name: /Actions for step first edit/ }));
    await user.click(await screen.findByRole("menuitem", { name: "Undo this step" }));
    await waitFor(() => expect(view.socket.sentOf("undo")).toHaveLength(1));
    expect(view.socket.sentOf("undo")[0]).toMatchObject({ mode: "step", step: 1 });
    view.unmount();
  });

  it("refetches 300 ms after the version stops changing and keeps the steps meanwhile", async () => {
    const calls = stubFetch();
    const user = userEvent.setup();
    const view = await openShell();
    await user.keyboard("{Control>}h{/Control}");
    await screen.findByText("first edit");
    const historyCalls = () => calls.filter((url) => url.includes("/history")).length;
    const base = historyCalls();
    const doc = view.rig.client.store.state.doc!;
    view.rig.deliver(deltaMessage(doc, 2, { name: "A" }));
    view.rig.deliver(deltaMessage({ ...doc, name: "A" }, 3, { name: "B" }));
    expect(historyCalls()).toBe(base);
    expect(screen.getByText("first edit")).toBeInTheDocument();
    await waitFor(() => expect(historyCalls()).toBe(base + 1), { timeout: 2000 });
    view.unmount();
  });
});
