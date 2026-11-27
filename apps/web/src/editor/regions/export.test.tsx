import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeHttp, jsonResponse, renderRegions, serve } from "@/test/collab-harness";
import { Export } from "./export";

afterEach(() => vi.unstubAllGlobals());

/** The editor mounts the dialog only after the document is in, so the flag is raised once it is served. */
async function setup(initial: Record<string, unknown> = {}, routes: Parameters<typeof fakeHttp>[0] = {}, flag = true) {
  const downloads: Blob[] = [];
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: (blob: Blob) => (downloads.push(blob), "blob:x"), revokeObjectURL: () => {} }));
  const calls = fakeHttp({
    "GET /api/health": () => jsonResponse({ ok: true, docId: "doc-1" }),
    "GET /api/screenshot": () => new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "content-type": "image/png" } }),
    ...routes,
  });
  const view = await renderRegions({ regions: [["export", <Export key="e" />]], initial });
  serve(view.rig, view.doc);
  if (flag) act(() => view.handle.current!.actions.openDialog("export"));
  return { ...view, calls, downloads };
}

describe("Export region", () => {
  it("is not mounted until the editor flag opens it", async () => {
    const view = await setup({}, {}, false);
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => view.handle.current!.actions.openDialog("export"));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("offers only the formats that exist: PNG and SVG, and React code; scope is the selection or the page", async () => {
    await setup({ selection: ["n3"] });
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("tab", { name: /image/i })).toBeInTheDocument();
    expect(within(dialog).getByRole("tab", { name: /code/i })).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(within(dialog).getByRole("combobox", { name: "What" }));
    expect(await screen.findByRole("option", { name: "Selection" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Page" })).toBeInTheDocument();
  });

  it("exports the selected node as PNG at the scale chosen, from the server's screenshot, when the workspace in view is the one the server has open", async () => {
    const view = await setup({ selection: ["n3"] });
    const dialog = await screen.findByRole("dialog");
    const user = userEvent.setup();
    await user.click(within(dialog).getByRole("radio", { name: "2x" }));
    await user.click(within(dialog).getByRole("button", { name: /export/i }));
    await waitFor(() => expect(view.downloads).toHaveLength(1));
    expect(view.calls.map((c) => `${c.method} ${c.url}`)).toEqual(["GET /api/health", "GET /api/screenshot?root=n3&scale=2"]);
    expect(view.downloads[0]!.type).toBe("image/png");
  });

  it("never changes the workspace the server has open: when another one is open the PNG is refused with the reason, and nothing is asked of the server but its health", async () => {
    const view = await setup({ selection: ["n3"] }, { "GET /api/health": () => jsonResponse({ ok: true, docId: "someone-else" }) });
    const dialog = await screen.findByRole("dialog");
    await userEvent.setup().click(within(dialog).getByRole("button", { name: /export/i }));
    expect(await within(dialog).findByText(/PNG needs this workspace to be the one the server has open/)).toBeInTheDocument();
    expect(view.calls.map((c) => `${c.method} ${c.url}`)).toEqual(["GET /api/health"]);
    expect(view.calls.some((c) => c.method === "POST")).toBe(false);
    expect(view.downloads).toHaveLength(0);
  });

  it("exports SVG made here with @paprika/core, with no request to the server, even when another workspace is the open one", async () => {
    const view = await setup({ selection: ["n3"] }, { "GET /api/health": () => jsonResponse({ ok: true, docId: "someone-else" }) });
    const dialog = await screen.findByRole("dialog");
    const user = userEvent.setup();
    await user.click(within(dialog).getByRole("radio", { name: "SVG" }));
    await user.click(within(dialog).getByRole("button", { name: /export/i }));
    await waitFor(() => expect(view.downloads).toHaveLength(1));
    expect(view.calls).toEqual([]);
    expect(view.downloads[0]!.type).toBe("image/svg+xml");
    const text = await view.downloads[0]!.text();
    expect(text).toMatch(/^<svg /);
    expect(text).toContain('data-paprika-id="n3"');
  });

  it("shows the server's error in the dialog when the screenshot is unavailable, and keeps it open", async () => {
    await setup({ selection: ["n3"] }, { "GET /api/screenshot": () => jsonResponse({ error: "screenshot unavailable: Chromium not found" }, 500) });
    const dialog = await screen.findByRole("dialog");
    await userEvent.setup().click(within(dialog).getByRole("button", { name: /export/i }));
    expect(await within(dialog).findByText(/screenshot unavailable: Chromium not found/)).toBeInTheDocument();
  });

  it("generates the React code of the selected node with @paprika/core, and of the first frame when nothing is selected", async () => {
    await setup({ selection: ["n3"] });
    const dialog = await screen.findByRole("dialog");
    await userEvent.setup().click(within(dialog).getByRole("tab", { name: /code/i }));
    expect(await screen.findByText(/export function Rect3\(\)/)).toBeInTheDocument();
  });

  it("with nothing selected the code is the first frame of the page", async () => {
    await setup({ selection: [] });
    const dialog = await screen.findByRole("dialog");
    await userEvent.setup().click(within(dialog).getByRole("tab", { name: /code/i }));
    expect(await screen.findByText(/export function Frame\(\)/)).toBeInTheDocument();
  });
});
