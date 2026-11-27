import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dismissToasts } from "@/lib/notify";
import { renderRegions, serve } from "@/test/collab-harness";
import { Import } from "./import";

afterEach(() => {
  dismissToasts();
  vi.unstubAllGlobals();
});

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20" viewBox="0 0 40 20"><rect width="40" height="20" fill="#ff0000"/></svg>';

/** The picture a fake `Image` reports (jsdom does not decode). */
function stubImage(width: number, height: number) {
  vi.stubGlobal(
    "Image",
    class {
      naturalWidth = width;
      naturalHeight = height;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    },
  );
}

async function setup(initial = {}) {
  const view = await renderRegions({ regions: [["import", <Import key="i" />]], initial });
  serve(view.rig, view.doc);
  view.socket.autoAck = true;
  act(() => view.handle.current!.actions.openDialog("import"));
  const dialog = await screen.findByRole("dialog");
  const input = dialog.querySelector("input[type=file]") as HTMLInputElement;
  return { ...view, dialog, input };
}

const sent = (view: Awaited<ReturnType<typeof setup>>) => view.socket.sentOf("ops");
const placeButton = (dialog: HTMLElement) => within(dialog).getByRole("button", { name: /place on canvas/i });

describe("Import region", () => {
  it("has only the Files tab and names the page in view as the destination", async () => {
    const view = await setup();
    expect(within(view.dialog).getAllByRole("tab")).toHaveLength(1);
    expect(within(view.dialog).getByRole("tab", { name: "Files" })).toBeInTheDocument();
    expect(view.dialog).toHaveTextContent("Page 1");
  });

  it("converts an SVG file into nodes in the active page, selects what came in, and closes", async () => {
    const view = await setup();
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    await user.upload(view.input, new File([SVG], "logo.svg", { type: "image/svg+xml" }));
    await waitFor(() => expect(placeButton(view.dialog)).toBeEnabled());
    await user.click(placeButton(view.dialog));
    await waitFor(() => expect(sent(view)).toHaveLength(1));
    const message = sent(view)[0]!;
    expect(message.label).toBe("import 1 file(s)");
    const created = message.ops as unknown as { op: string; parentId: string; node: { id: string; type: string } }[];
    expect(created.length).toBeGreaterThan(0);
    expect(created.every((op) => op.op === "create" && op.parentId === "page-0")).toBe(true);
    await waitFor(() => expect(view.handle.current!.state.selection).toEqual(created.map((op) => op.node.id)));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("places a picture as an image node with the limits of the old canvas (480 px on the long side)", async () => {
    stubImage(1200, 600);
    const view = await setup();
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    await user.upload(view.input, new File([new Uint8Array([1, 2, 3])], "hero.png", { type: "image/png" }));
    await waitFor(() => expect(placeButton(view.dialog)).toBeEnabled());
    await user.click(placeButton(view.dialog));
    await waitFor(() => expect(sent(view)).toHaveLength(1));
    const node = (sent(view)[0]!.ops[0] as unknown as { node: Record<string, unknown> }).node;
    expect(node).toMatchObject({ type: "image", name: "hero", width: 480, height: 240, fit: "contain", alt: "hero.png" });
    expect(String(node.src)).toMatch(/^data:image\/png;base64,/);
  });

  it("does not offer a .paprika.json (it is a whole document and is always refused) and sends nothing", async () => {
    const view = await setup();
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    expect(view.input.getAttribute("accept") ?? "").not.toMatch(/paprika/);
    expect(view.dialog.textContent ?? "").not.toMatch(/\.paprika\.json/);
    await user.upload(view.input, new File(["{}"], "board.paprika.json", { type: "application/json" }));
    expect(placeButton(view.dialog)).toBeDisabled();
    expect(sent(view)).toHaveLength(0);
  });

  it("refuses a picture over 3.5 MB and sends nothing", async () => {
    const view = await setup();
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    await user.upload(view.input, new File([new Uint8Array(3_500_001)], "big.png", { type: "image/png" }));
    const place = placeButton(view.dialog);
    if (!(place as HTMLButtonElement).disabled) await user.click(place);
    await waitFor(() => expect(within(view.dialog).getByText(/Larger than 3\.5/)).toBeInTheDocument());
    expect(sent(view)).toHaveLength(0);
  });

  it("keeps the files that work when another fails, and says which failed", async () => {
    const view = await setup();
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    await user.upload(view.input, [new File([SVG], "ok.svg", { type: "image/svg+xml" }), new File(["<div>no</div>"], "bad.svg", { type: "image/svg+xml" })]);
    await waitFor(() => expect(placeButton(view.dialog)).toBeEnabled());
    await user.click(placeButton(view.dialog));
    await waitFor(() => expect(sent(view)).toHaveLength(1));
    expect(await screen.findByText("1 of 2 files imported.")).toBeInTheDocument();
    expect(screen.getByText(/bad\.svg/)).toBeInTheDocument();
  });

  it("shows the server's message when it refuses the ops, and keeps the dialog open", async () => {
    const view = await setup();
    view.socket.autoAck = false;
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    await user.upload(view.input, new File([SVG], "logo.svg", { type: "image/svg+xml" }));
    await waitFor(() => expect(placeButton(view.dialog)).toBeEnabled());
    await user.click(placeButton(view.dialog));
    await waitFor(() => expect(sent(view)).toHaveLength(1));
    act(() => view.socket.receive({ type: "error", reqId: sent(view)[0]!.reqId as string, message: "op[0]: node is not valid" }));
    expect(await within(view.dialog).findByText(/node is not valid/)).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("says it is offline instead of waiting when the socket is down", async () => {
    const view = await setup();
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    await user.upload(view.input, new File([SVG], "logo.svg", { type: "image/svg+xml" }));
    await waitFor(() => expect(placeButton(view.dialog)).toBeEnabled());
    act(() => view.socket.drop());
    await user.click(placeButton(view.dialog));
    expect(await within(view.dialog).findByText(/offline: the import was not sent/i)).toBeInTheDocument();
  });

  it("tells each converter note in the language of the app, one line per note", async () => {
    const view = await setup();
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const noisy = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><style>a{}</style><rect width="40" height="20" fill="url(#g)"/></svg>';
    await user.upload(view.input, new File([noisy], "noisy.svg", { type: "image/svg+xml" }));
    await waitFor(() => expect(placeButton(view.dialog)).toBeEnabled());
    await user.click(placeButton(view.dialog));
    expect(await screen.findByText("Imported with notes from the converter")).toBeInTheDocument();
    expect(screen.getByText("Gradients and patterns are not imported; gray was used.")).toBeInTheDocument();
    expect(screen.getByText(/CSS in <style> is not applied/)).toBeInTheDocument();
  });

  it("says why when every file fails, as one sentence in the dialog and one line per file in a list", async () => {
    const view = await setup();
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    await user.upload(view.input, [new File(["<div>a</div>"], "a.svg", { type: "image/svg+xml" }), new File(["<div>b</div>"], "b.svg", { type: "image/svg+xml" })]);
    await waitFor(() => expect(placeButton(view.dialog)).toBeEnabled());
    await user.click(placeButton(view.dialog));
    expect(await within(view.dialog).findByText(/None of the 2 files could be imported\./)).toBeInTheDocument();
    const items = (await screen.findAllByRole("listitem")).map((item) => item.textContent);
    expect(items.some((text) => text?.includes("a.svg"))).toBe(true);
    expect(items.some((text) => text?.includes("b.svg"))).toBe(true);
    expect(sent(view)).toHaveLength(0);
  });

  describe("files that together pass the 8 MiB the server takes in a message", () => {
    /** Three pictures of 2.5 MB: about 3.3 M characters of data URI each, so two fit under the batch limit, and all three (10 M) pass the 8 MiB of the server. */
    const pictures = () => [1, 2, 3].map((n) => new File([new Uint8Array(2_500_000)], `big${n}.png`, { type: "image/png" }));
    const bytes = (message: unknown) => new TextEncoder().encode(JSON.stringify(message)).length;

    it("sends them in batches that each stay under the limit, one history step per batch, and selects everything that came in", async () => {
      stubImage(100, 100);
      const view = await setup();
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      await user.upload(view.input, pictures());
      await waitFor(() => expect(placeButton(view.dialog)).toBeEnabled());
      await user.click(placeButton(view.dialog));
      await waitFor(() => expect(sent(view)).toHaveLength(2), { timeout: 8000 });
      const messages = sent(view);
      const total = messages.reduce((sum, message) => sum + bytes(message), 0);
      expect(total).toBeGreaterThan(8 * 1024 * 1024);
      for (const message of messages) expect(bytes(message)).toBeLessThan(8 * 1024 * 1024);
      expect(messages.map((message) => message.label)).toEqual(["import 2 file(s)", "import 1 file(s)"]);
      const ids = messages.flatMap((message) => (message.ops as unknown as { node: { id: string } }[]).map((op) => op.node.id));
      expect(ids).toHaveLength(3);
      await waitFor(() => expect(view.handle.current!.state.selection).toEqual(ids));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    }, 30_000);

    it("keeps what went in when a later batch is refused, and says which files did not (the dialog closes, the socket stays up)", async () => {
      stubImage(100, 100);
      const view = await setup();
      view.socket.autoAck = false;
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      await user.upload(view.input, pictures());
      await waitFor(() => expect(placeButton(view.dialog)).toBeEnabled());
      await user.click(placeButton(view.dialog));
      await waitFor(() => expect(sent(view)).toHaveLength(1), { timeout: 8000 });
      act(() => view.socket.ack(sent(view)[0]!.reqId as string, 2));
      await waitFor(() => expect(sent(view)).toHaveLength(2));
      act(() => view.socket.receive({ type: "error", reqId: sent(view)[1]!.reqId as string, message: "op[0]: node is not valid" }));
      expect(await screen.findByText("2 of 3 files imported.")).toBeInTheDocument();
      expect(screen.getByText(/big3\.png/)).toBeInTheDocument();
      expect(screen.getByText(/node is not valid/)).toBeInTheDocument();
      const first = (sent(view)[0]!.ops as unknown as { node: { id: string } }[]).map((op) => op.node.id);
      expect(view.handle.current!.state.selection).toEqual(first);
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(view.socket.readyState).toBe(1);
    }, 30_000);

    it("stops sending when the connection drops in flight, and says the batch that was on its way may have been applied", async () => {
      stubImage(100, 100);
      const view = await setup();
      view.socket.autoAck = false;
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      await user.upload(view.input, pictures());
      await waitFor(() => expect(placeButton(view.dialog)).toBeEnabled());
      await user.click(placeButton(view.dialog));
      await waitFor(() => expect(sent(view)).toHaveLength(1), { timeout: 8000 });
      act(() => view.socket.ack(sent(view)[0]!.reqId as string, 2));
      await waitFor(() => expect(sent(view)).toHaveLength(2));
      act(() => view.socket.drop());
      expect(await screen.findByText("2 of 3 files imported.")).toBeInTheDocument();
      expect(screen.getByText(/big3\.png: the connection dropped while sending, so it may have been applied/)).toBeInTheDocument();
      expect(sent(view)).toHaveLength(2);
    }, 30_000);

    it("keeps the dialog open with the may-have-been-applied message when the first send is the one that drops", async () => {
      const view = await setup();
      view.socket.autoAck = false;
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      await user.upload(view.input, new File([SVG], "logo.svg", { type: "image/svg+xml" }));
      await waitFor(() => expect(placeButton(view.dialog)).toBeEnabled());
      await user.click(placeButton(view.dialog));
      await waitFor(() => expect(sent(view)).toHaveLength(1));
      act(() => view.socket.drop());
      expect(await within(view.dialog).findByText(/may have been applied: check the canvas before trying again/)).toBeInTheDocument();
    });
  });
});
