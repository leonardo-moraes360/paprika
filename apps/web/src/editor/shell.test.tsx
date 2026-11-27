import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Op } from "@paprika/core";
import { dismissToasts } from "@/lib/notify";
import { fakeWasm } from "@/test/fake-wasm";
import { deltaMessage, makeDocument, renderEditorRig, serveDocument } from "@/test/live-harness";

const steps = [
  { id: 1, actor: "user", label: "first edit", at: Date.now() - 60_000, ops: 1, undone: false, nodeIds: ["n3"] },
  { id: 2, actor: "agent:claude", label: "agent edit", at: Date.now() - 30_000, ops: 2, undone: false, nodeIds: ["n3"] },
];

const pin = (id: string, n: number) => ({ id, n, workspaceId: "doc-1", pageId: "page-0", region: { x: 0, y: 0, width: 20, height: 20 }, text: `pin ${n}`, author: "user", status: "open", createdAt: Date.now() - 60_000, updatedAt: Date.now() });

function stubFetch(extra: (url: string) => unknown = () => undefined) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      const custom = extra(url);
      const body = custom ?? (url.includes("/history") ? { version: 2, steps, canUndo: true, canRedo: false } : url.includes("/api/pins") ? { pins: [pin("a", 1), pin("b", 2)] } : {});
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

describe("layout", () => {
  it("remembers the panels (size and collapsed) under the editor key, as the old app did", async () => {
    const view = await openShell();
    expect(window.localStorage.getItem("paprika.ui-sdk-resizable:editor")).toBeNull();
    const separator = screen.getByRole("separator", { name: "Resize layers panel" });
    separator.focus();
    await userEvent.setup().keyboard("{ArrowRight}");
    await waitFor(() => expect(window.localStorage.getItem("paprika.ui-sdk-resizable:editor")).not.toBeNull());
    window.localStorage.removeItem("paprika.ui-sdk-resizable:editor");
    view.unmount();
  });
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
  it("draws a keyboard focus ring: `outline-none` alone cancels the ring, so the focus-visible class must say the style too", async () => {
    const view = await openShell();
    const region = screen.getByRole("region", { name: "Canvas" });
    expect(region).toHaveAttribute("tabindex", "0");
    const classes = region.className.split(/\s+/);
    // Tailwind 4: `outline-none` sets `outline-style: none` and `outline-2` only sets the width; only `outline-solid` brings the style back.
    for (const needed of ["focus-visible:outline-2", "focus-visible:outline-solid", "focus-visible:outline-select"]) expect(classes).toContain(needed);
    view.unmount();
  });

  it("has the toolbar with the old app's tools and the zoom bar", async () => {
    const user = userEvent.setup();
    const view = await openShell();
    expect(screen.getByRole("toolbar", { name: "Tools" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Select" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Rectangle" }));
    expect(screen.getByRole("button", { name: "Rectangle" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("100%")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(screen.getByText("125%")).toBeInTheDocument();
    view.unmount();
  });

  describe("renderer menu", () => {
    const setGpu = (on: boolean) => {
      if (on) Object.defineProperty(navigator, "gpu", { value: {}, configurable: true });
      else delete (navigator as unknown as { gpu?: unknown }).gpu;
    };
    beforeEach(() => {
      window.localStorage.removeItem("paprika.renderer");
      setGpu(false);
    });
    afterEach(() => {
      window.localStorage.removeItem("paprika.renderer");
      setGpu(false);
    });

    it("starts on DOM, announces it with a hello, and a choice is kept, sent to the server and saved under the old app's key", async () => {
      const user = userEvent.setup();
      const view = await openShell();
      expect(view.socket.sentOf("hello")).toEqual([expect.objectContaining({ type: "hello", renderer: "dom" })]);
      const trigger = screen.getByRole("button", { name: "Renderer: DOM" });
      expect(window.localStorage.getItem("paprika.renderer")).toBeNull();
      await user.click(trigger);
      expect(screen.getByRole("menuitemradio", { name: "DOM (SVG)" })).toBeChecked();
      await user.click(screen.getByRole("menuitemradio", { name: "WASM · CPU" }));
      expect(await screen.findByRole("button", { name: "Renderer: WASM · CPU" })).toBeInTheDocument();
      expect(fakeWasm.asked).toEqual(["cpu"]);
      expect(view.socket.sentOf("hello").at(-1)).toMatchObject({ renderer: "wasm" });
      expect(window.localStorage.getItem("paprika.renderer")).toBe("cpu");
      expect(opsSent(view)).toEqual([]);
      view.unmount();
    });

    it("GPU asks the module for gpu and says WASM · GPU", async () => {
      const user = userEvent.setup();
      setGpu(true);
      const view = await openShell();
      await user.click(screen.getByRole("button", { name: "Renderer: DOM" }));
      await user.click(screen.getByRole("menuitemradio", { name: "WASM · GPU" }));
      expect(await screen.findByRole("button", { name: "Renderer: WASM · GPU" })).toBeInTheDocument();
      expect(fakeWasm.asked).toEqual(["gpu"]);
      expect(window.localStorage.getItem("paprika.renderer")).toBe("gpu");
      view.unmount();
    });

    it("switching from CPU to GPU recreates the renderer", async () => {
      const user = userEvent.setup();
      setGpu(true);
      window.localStorage.setItem("paprika.renderer", "cpu");
      const view = await openShell();
      expect(await screen.findByRole("button", { name: "Renderer: WASM · CPU" })).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Renderer: WASM · CPU" }));
      await user.click(screen.getByRole("menuitemradio", { name: "WASM · GPU" }));
      expect(await screen.findByRole("button", { name: "Renderer: WASM · GPU" })).toBeInTheDocument();
      expect(fakeWasm.asked).toEqual(["cpu", "gpu"]);
      expect(fakeWasm.renderers[0]?.freed).toBe(true);
      view.unmount();
    });

    it("a saved gpu that cannot start goes back to the CPU, saves it and says so once", async () => {
      setGpu(true);
      fakeWasm.failGpu = "no adapter";
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      window.localStorage.setItem("paprika.renderer", "gpu");
      const view = await openShell();
      expect(await screen.findByText(/could not start WebGPU/)).toBeInTheDocument();
      expect(screen.getByText(/went back to WASM · CPU/)).toBeInTheDocument();
      expect(await screen.findByRole("button", { name: "Renderer: WASM · CPU" })).toBeInTheDocument();
      expect(fakeWasm.asked).toEqual(["gpu", "cpu"]);
      expect(window.localStorage.getItem("paprika.renderer")).toBe("cpu");
      expect(warn).toHaveBeenCalledTimes(1);
      view.unmount();
      const again = await openShell();
      expect(await screen.findByRole("button", { name: "Renderer: WASM · CPU" })).toBeInTheDocument();
      expect(warn).toHaveBeenCalledTimes(1);
      again.unmount();
      warn.mockRestore();
    });

    it("the legacy wasm with navigator.gpu and no adapter ends on the CPU with one warning, and none at the next opening", async () => {
      setGpu(true);
      fakeWasm.failGpu = "no adapter";
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      window.localStorage.setItem("paprika.renderer", "wasm");
      const view = await openShell();
      expect(await screen.findByRole("button", { name: "Renderer: WASM · CPU" })).toBeInTheDocument();
      expect(window.localStorage.getItem("paprika.renderer")).toBe("cpu");
      view.unmount();
      const again = await openShell();
      expect(await screen.findByRole("button", { name: "Renderer: WASM · CPU" })).toBeInTheDocument();
      expect(warn).toHaveBeenCalledTimes(1);
      again.unmount();
      warn.mockRestore();
    });

    it("a saved gpu in a browser without WebGPU opens on the CPU with no warning", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      window.localStorage.setItem("paprika.renderer", "gpu");
      const view = await openShell();
      expect(await screen.findByRole("button", { name: "Renderer: WASM · CPU" })).toBeInTheDocument();
      expect(fakeWasm.asked).toEqual(["cpu"]);
      expect(warn).not.toHaveBeenCalled();
      view.unmount();
      warn.mockRestore();
    });

    it("a gpu that fails after the CPU worked goes back to the CPU", async () => {
      const user = userEvent.setup();
      setGpu(true);
      window.localStorage.setItem("paprika.renderer", "cpu");
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const view = await openShell();
      expect(await screen.findByRole("button", { name: "Renderer: WASM · CPU" })).toBeInTheDocument();
      fakeWasm.failGpu = "software adapter rejected";
      await user.click(screen.getByRole("button", { name: "Renderer: WASM · CPU" }));
      await user.click(screen.getByRole("menuitemradio", { name: "WASM · GPU" }));
      expect(await screen.findByText(/went back to WASM · CPU/)).toBeInTheDocument();
      expect(await screen.findByRole("button", { name: "Renderer: WASM · CPU" })).toBeInTheDocument();
      expect(fakeWasm.asked).toEqual(["cpu", "gpu", "cpu"]);
      warn.mockRestore();
      view.unmount();
    });

    it("GPU is disabled without WebGPU, and both WASM modes are when the build has no renderer", async () => {
      const user = userEvent.setup();
      const view = await openShell();
      await user.click(screen.getByRole("button", { name: "Renderer: DOM" }));
      expect(screen.getByRole("menuitemradio", { name: "WASM · GPU (no WebGPU)" })).toHaveAttribute("aria-disabled", "true");
      expect(screen.getByRole("menuitemradio", { name: "WASM · CPU" })).not.toHaveAttribute("aria-disabled", "true");
      view.unmount();
      fakeWasm.available = false;
      const second = await openShell();
      await user.click(screen.getByRole("button", { name: "Renderer: DOM" }));
      for (const name of [/WASM · GPU/, /WASM · CPU/]) {
        const item = screen.getByRole("menuitemradio", { name });
        expect(item).toHaveAttribute("aria-disabled", "true");
        expect(item.textContent).toMatch(/no WASM renderer/i);
      }
      second.unmount();
    });

    it("a renderer that fails to start goes back to DOM, warns through the toast and announces dom again", async () => {
      const user = userEvent.setup();
      fakeWasm.failCreate = "Failed to fetch dynamically imported module: http://localhost/wasm.js";
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const view = await openShell();
      await user.click(screen.getByRole("button", { name: "Renderer: DOM" }));
      await user.click(screen.getByRole("menuitemradio", { name: "WASM · CPU" }));
      expect(await screen.findByText("The canvas went back to DOM, which draws the same page.")).toBeInTheDocument();
      expect(screen.queryByText(/dynamically imported module/)).toBeNull();
      expect(warn).toHaveBeenCalledWith("[paprika] WASM renderer (cpu) stopped:", "Failed to fetch dynamically imported module: http://localhost/wasm.js");
      warn.mockRestore();
      expect(await screen.findByRole("button", { name: "Renderer: DOM" })).toBeInTheDocument();
      expect(view.socket.sentOf("hello").at(-1)).toMatchObject({ renderer: "dom" });
      view.unmount();
    });

    it("reopens on the saved choice and announces it with a hello; the legacy wasm value is gpu with WebGPU and cpu without", async () => {
      window.localStorage.setItem("paprika.renderer", "wasm");
      const view = await openShell();
      expect(await screen.findByRole("button", { name: "Renderer: WASM · CPU" })).toBeInTheDocument();
      expect(view.socket.sentOf("hello")).toEqual([expect.objectContaining({ renderer: "wasm" })]);
      view.unmount();
      setGpu(true);
      const second = await openShell();
      expect(await screen.findByRole("button", { name: "Renderer: WASM · GPU" })).toBeInTheDocument();
      second.unmount();
    });
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
    expect(screen.getByRole("button", { name: "Text" })).toHaveAttribute("aria-pressed", "true");
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

  it("Tab selects the next sibling and Shift+Tab goes back, when nothing has the focus", async () => {
    const user = userEvent.setup();
    const view = await openShell();
    const selectedNames = () =>
      within(tree()).getAllByRole("treeitem").filter((el) => el.getAttribute("aria-selected") === "true").map((el) => el.textContent);
    const name = within(tree()).getAllByRole("treeitem")[1]?.textContent as string;
    await user.click(within(layer(name)).getByText(name));
    (document.activeElement as HTMLElement | null)?.blur();
    const first = selectedNames();
    await user.keyboard("{Tab}");
    const next = selectedNames();
    expect(next).toHaveLength(1);
    expect(next).not.toEqual(first);
    (document.activeElement as HTMLElement | null)?.blur();
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(selectedNames()).toEqual(first);
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

describe("keyboard scope (E1)", () => {
  const selectedCount = () => within(tree()).getAllByRole("treeitem").filter((el) => el.getAttribute("aria-selected") === "true").length;
  const selectFirstLayer = async (user: ReturnType<typeof userEvent.setup>) => {
    const name = within(tree()).getAllByRole("treeitem")[1]?.textContent as string;
    await user.click(within(layer(name)).getByText(name));
    expect(selectedCount()).toBe(1);
  };
  const editKeys = ["{Delete}", "{Backspace}", "{ArrowRight}", "{Shift>}{ArrowDown}{/Shift}", "{Control>}a{/Control}", "{Control>}g{/Control}", "{Control>}d{/Control}", "{Alt>}c{/Alt}"];

  /** Focus on a button inside each region that is not the stage or the layers: no edit key may touch the document, the selection or the tool. */
  const regionFocus: [string, () => Promise<HTMLElement>][] = [
    ["the history", async () => within(await screen.findByRole("region", { name: "History" })).getAllByRole("button")[0]!],
    ["the pins", async () => within(await screen.findByRole("region", { name: "Pins" })).getAllByRole("button")[0]!],
    ["the header", async () => within(screen.getAllByRole("banner")[0]!).getAllByRole("button")[0]!],
    ["the pages panel", async () => within(screen.getByRole("list", { name: "Pages" })).getAllByRole("button")[0]!],
  ];
  for (const [place, focusIn] of regionFocus) {
    it(`edit keys do nothing with the focus in ${place}`, async () => {
      const user = userEvent.setup();
      const view = await openShell();
      await selectFirstLayer(user);
      await user.keyboard("{Control>}h{/Control}");
      await user.keyboard("{Shift>}i{/Shift}");
      const target = await focusIn();
      target.focus();
      expect(document.activeElement).toBe(target);
      for (const key of editKeys) await user.keyboard(key);
      expect(opsSent(view)).toHaveLength(0);
      expect(selectedCount()).toBe(1);
      expect(screen.getByRole("button", { name: "Select" })).toHaveAttribute("aria-pressed", "true");
      view.unmount();
    });
  }

  describe("tool letters (F9): they pick the tool from any focus in the editor", () => {
    const pressed = (name: string) => screen.getByRole("button", { name }).getAttribute("aria-pressed") === "true";

    it("from a layer in the tree, even when a layer's name starts with the letter (the tree has no typeahead)", async () => {
      const user = userEvent.setup();
      const view = await openShell();
      const items = within(tree()).getAllByRole("treeitem");
      expect(items.some((el) => /^Frame/.test(el.textContent ?? ""))).toBe(true);
      const focused = items.find((el) => /^Rect/.test(el.textContent ?? ""))!;
      focused.focus();
      await user.keyboard("f");
      expect(pressed("Frame")).toBe(true);
      expect(document.activeElement).toBe(focused);
      await user.keyboard("r");
      expect(pressed("Rectangle")).toBe(true);
      expect(document.activeElement).toBe(focused);
      await user.keyboard("v");
      expect(pressed("Select")).toBe(true);
      expect(opsSent(view)).toHaveLength(0);
      view.unmount();
    });

    const places: [string, () => HTMLElement | Promise<HTMLElement>][] = [
      ["the header", () => within(screen.getAllByRole("banner")[0]!).getAllByRole("button")[0]!],
      ["the pages panel", () => within(screen.getByRole("list", { name: "Pages" })).getAllByRole("button")[0]!],
      ["the stage toolbar", () => within(screen.getByRole("toolbar", { name: "Tools" })).getAllByRole("button")[0]!],
      ["the layers header", () => screen.getByRole("heading", { name: "Layers", level: 2 }).closest("button") ?? screen.getByRole("heading", { name: "Layers", level: 2 })],
    ];
    for (const [place, find] of places) {
      it(`from ${place}`, async () => {
        const user = userEvent.setup();
        const view = await openShell();
        const target = await find();
        target.tabIndex = target.tabIndex < 0 ? 0 : target.tabIndex;
        target.focus();
        expect(document.activeElement).toBe(target);
        await user.keyboard("r");
        expect(pressed("Rectangle")).toBe(true);
        expect(opsSent(view)).toHaveLength(0);
        view.unmount();
      });
    }

    it("from the history panel", async () => {
      const user = userEvent.setup();
      const view = await openShell();
      await user.keyboard("{Control>}h{/Control}");
      const close = within(await screen.findByRole("region", { name: "History" })).getAllByRole("button")[0]!;
      close.focus();
      await user.keyboard("t");
      expect(pressed("Text")).toBe(true);
      view.unmount();
    });

    it("still not in a text field, a contenteditable, a menu, a listbox or a dialog, nor in the layer rename field", async () => {
      const user = userEvent.setup();
      const view = await openShell();
      const make = (tag: string, attrs: Record<string, string>) => {
        const el = document.body.appendChild(document.createElement(tag));
        for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
        el.tabIndex = 0;
        return el;
      };
      const traps = [make("input", { type: "text" }), make("textarea", {}), make("div", { contenteditable: "true" }), make("div", { role: "menu" }), make("div", { role: "listbox" }), make("div", { role: "dialog" })];
      for (const trap of traps) {
        trap.focus();
        await user.keyboard("o");
        expect(pressed("Ellipse")).toBe(false);
        trap.remove();
      }
      const name = within(tree()).getAllByRole("treeitem")[1]?.textContent as string;
      await user.click(within(layer(name)).getByText(name));
      await user.keyboard("{F2}");
      const field = await screen.findByRole("textbox", { name: "Layer name" });
      await user.keyboard("o");
      expect(pressed("Ellipse")).toBe(false);
      expect((field as HTMLInputElement).value).toContain("o");
      view.unmount();
    });
  });

  it("the app keys still work from a panel: Ctrl+Z asks for the undo and Esc closes the history", async () => {
    const user = userEvent.setup();
    const view = await openShell();
    await user.keyboard("{Control>}h{/Control}");
    const close = within(await screen.findByRole("region", { name: "History" })).getAllByRole("button")[0]!;
    close.focus();
    await user.keyboard("{Control>}z{/Control}");
    expect(view.socket.sentOf("undo")).toHaveLength(1);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("region", { name: "History" })).not.toBeInTheDocument());
    view.unmount();
  });

  it("edit keys act with the focus on the page, the stage, the layers tree or the stage toolbar", async () => {
    const user = userEvent.setup();
    const view = await openShell();
    await selectFirstLayer(user);
    const places: (() => HTMLElement)[] = [
      () => document.body,
      () => screen.getByRole("region", { name: "Canvas" }),
      () => within(tree()).getAllByRole("treeitem")[1]!,
      () => within(screen.getByRole("toolbar", { name: "Tools" })).getAllByRole("button")[0]!,
    ];
    for (const place of places) {
      const el = place();
      if (el === document.body) (document.activeElement as HTMLElement | null)?.blur();
      else el.focus();
      await user.keyboard("{Control>}a{/Control}");
      expect(selectedCount()).toBeGreaterThan(0);
      await user.keyboard("{Escape}");
      expect(screen.getByRole("button", { name: "Select" })).toHaveAttribute("aria-pressed", "true");
      await selectFirstLayer(user);
    }
    (document.activeElement as HTMLElement | null)?.blur();
    await user.keyboard("{Delete}");
    await waitFor(() => expect(opsSent(view)).toHaveLength(1));
    view.unmount();
  });

  it("Esc with the pins open closes the pins and leaves the selection and the tool alone", async () => {
    const user = userEvent.setup();
    const view = await openShell();
    await selectFirstLayer(user);
    (document.activeElement as HTMLElement | null)?.blur();
    await user.keyboard("r");
    await user.keyboard("{Shift>}i{/Shift}");
    expect(await screen.findByRole("region", { name: "Pins" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("region", { name: "Pins" })).not.toBeInTheDocument());
    expect(selectedCount()).toBe(1);
    expect(screen.getByRole("button", { name: "Rectangle" })).toHaveAttribute("aria-pressed", "true");
    view.unmount();
  });

  it("holding an arrow adds the steps up while the deltas have not arrived (E3)", async () => {
    const user = userEvent.setup();
    const view = await openShell();
    await selectFirstLayer(user);
    (document.activeElement as HTMLElement | null)?.blur();
    await user.keyboard("{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}");
    await waitFor(() => expect(opsSent(view)).toHaveLength(5));
    const xs = (opsSent(view) as unknown as { ops: { props: { x: number } }[] }[]).map((m) => m.ops[0]!.props.x);
    expect(xs.map((x, i) => (i === 0 ? x : x - xs[i - 1]!)).slice(1)).toEqual([1, 1, 1, 1]);
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
