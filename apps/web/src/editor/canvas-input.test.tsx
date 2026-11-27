import { act, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CanvasInputRequest } from "@/components/frontends/canvas";
import { dismissToasts } from "@/lib/notify";
import { renderRegions, serve } from "@/test/collab-harness";
import { placeAt, useCanvasInputHandler } from "./canvas-input";

afterEach(() => {
  dismissToasts();
  vi.unstubAllGlobals();
});

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20" viewBox="0 0 40 20"><rect width="40" height="20" fill="#ff0000"/></svg>';

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

const handlerRef: { current: ((request: CanvasInputRequest) => void) | null } = { current: null };
function Probe() {
  handlerRef.current = useCanvasInputHandler();
  return null;
}

async function setup() {
  const view = await renderRegions({ regions: [["probe", <Probe key="p" />]] });
  serve(view.rig, view.doc);
  view.socket.autoAck = true;
  return view;
}

const request = (over: Partial<CanvasInputRequest>): CanvasInputRequest => ({ kind: "paste", plain: "", html: "", files: [], parentId: null, at: { x: 100, y: 50 }, ...over });
const sent = (view: Awaited<ReturnType<typeof setup>>) => view.socket.sentOf("ops");
type Created = { op: string; parentId: string | null; node: { id: string; type: string; x: number; y: number; width?: number; height?: number; layoutPositioning?: string; name?: string } };

describe("placeAt", () => {
  const doc = { nodes: { page: { id: "page", type: "page" }, flow: { id: "flow", type: "frame", layout: { mode: "column" } }, free: { id: "free", type: "frame" } } } as never;
  const node = (x: number, y: number, width = 10) => ({ type: "rect", name: "r", x, y, width, height: 10 }) as never;

  it("puts the top-left corner of a group at the point and keeps the nodes' distances", () => {
    const [group] = placeAt(doc, "page", { x: 100, y: 50 }, [{ name: "a", nodes: [node(30, 30), node(50, 40)], warnings: [] }]);
    const made = (group?.ops as unknown as Created[]).map((op) => [op.node.x, op.node.y]);
    expect(made).toEqual([[100, 50], [120, 60]]);
    expect(new Set(group?.ids).size).toBe(2);
  });

  it("puts the next group beside the first, 16 px apart", () => {
    const groups = placeAt(doc, "page", { x: 0, y: 0 }, [
      { name: "a", nodes: [node(0, 0, 100)], warnings: [] },
      { name: "b", nodes: [node(7, 0, 20)], warnings: [] },
    ]);
    expect((groups[1]?.ops[0] as unknown as Created).node.x).toBe(116);
  });

  it("pins what goes into a flow layout, and only that", () => {
    const [inFlow] = placeAt(doc, "flow", { x: 0, y: 0 }, [{ name: "a", nodes: [node(0, 0)], warnings: [] }]);
    expect((inFlow?.ops[0] as unknown as Created).node.layoutPositioning).toBe("absolute");
    const [free] = placeAt(doc, "free", { x: 0, y: 0 }, [{ name: "a", nodes: [node(0, 0)], warnings: [] }]);
    expect((free?.ops[0] as unknown as Created).node.layoutPositioning).toBeUndefined();
  });

  it("skips an empty group without a hole in the result", () => {
    const groups = placeAt(doc, "page", { x: 0, y: 0 }, [{ name: "a", nodes: [], warnings: [] }, { name: "b", nodes: [node(0, 0)], warnings: [] }]);
    expect(groups.map((g) => g.ops.length)).toEqual([0, 1]);
  });
});

describe("the canvas input handler", () => {
  it("pastes SVG onto the page in view at the point, labels the step and selects what came in", async () => {
    const view = await setup();
    act(() => handlerRef.current!(request({ plain: SVG })));
    await waitFor(() => expect(sent(view)).toHaveLength(1));
    const message = sent(view)[0]!;
    expect(message.label).toBe("paste SVG");
    const ops = message.ops as unknown as Created[];
    expect(ops.every((op) => op.op === "create" && op.parentId === "page-0")).toBe(true);
    expect([ops[0]!.node.x, ops[0]!.node.y]).toEqual([100, 50]);
    await waitFor(() => expect(view.handle.current!.state.selection).toEqual(ops.map((op) => op.node.id)));
  });

  it("pastes HTML into the frame the canvas names, and pins it in a flow layout", async () => {
    const view = await setup();
    act(() => handlerRef.current!(request({ html: '<div style="width:50px;height:20px;background:#00ff00"></div>', parentId: "frame-0-0" })));
    await waitFor(() => expect(sent(view)).toHaveLength(1));
    expect(sent(view)[0]!.label).toBe("paste HTML");
    expect((sent(view)[0]!.ops as unknown as Created[])[0]!.parentId).toBe("frame-0-0");
  });

  it("pastes a picture as an image node scaled to 480 px, labelled as the old canvas", async () => {
    stubImage(1200, 600);
    const view = await setup();
    act(() => handlerRef.current!(request({ files: [new File([new Uint8Array([1, 2, 3])], "shot.png", { type: "image/png" })] })));
    await waitFor(() => expect(sent(view)).toHaveLength(1));
    expect(sent(view)[0]!.label).toBe("paste image");
    expect((sent(view)[0]!.ops[0] as unknown as Created).node).toMatchObject({ type: "image", width: 480, height: 240, x: 100, y: 50 });
  });

  it("refuses a picture over 3.5 MB with the reason, and sends nothing", async () => {
    stubImage(10, 10);
    const view = await setup();
    const big = new File([new Uint8Array(3_500_001)], "big.png", { type: "image/png" });
    act(() => handlerRef.current!(request({ kind: "drop", files: [big] })));
    expect(await screen.findByText(/image too large/i)).toBeInTheDocument();
    expect(sent(view)).toHaveLength(0);
  });

  it("drops several files side by side in one step; .fig and PDF are refused with the reason while the rest go in", async () => {
    stubImage(100, 100);
    const view = await setup();
    const files = [new File([SVG], "a.svg", { type: "image/svg+xml" }), new File(["x"], "b.fig"), new File(["x"], "c.pdf"), new File([new Uint8Array([1])], "d.png", { type: "image/png" })];
    act(() => handlerRef.current!(request({ kind: "drop", files, at: { x: 10, y: 10 } })));
    await waitFor(() => expect(sent(view)).toHaveLength(1));
    expect(sent(view)[0]!.label).toBe("import 2 files");
    const ops = sent(view)[0]!.ops as unknown as Created[];
    expect(ops.some((op) => op.node.type === "image")).toBe(true);
    expect(await screen.findByText(/\.fig files are not imported/i)).toBeInTheDocument();
    expect(screen.getByText(/PDF files are not imported/i)).toBeInTheDocument();
  });

  it("one file that goes in among refused ones is 'import file', not a count of what was dropped", async () => {
    stubImage(100, 100);
    const view = await setup();
    act(() => handlerRef.current!(request({ kind: "drop", files: [new File(["x"], "b.fig"), new File([new Uint8Array([1])], "d.png", { type: "image/png" })] })));
    await waitFor(() => expect(sent(view)).toHaveLength(1));
    expect(sent(view)[0]!.label).toBe("import file");
  });

  it("one file is 'import file'", async () => {
    const view = await setup();
    act(() => handlerRef.current!(request({ kind: "drop", files: [new File([SVG], "a.svg", { type: "image/svg+xml" })] })));
    await waitFor(() => expect(sent(view)).toHaveLength(1));
    expect(sent(view)[0]!.label).toBe("import file");
  });

  it("says why when the markup gives nothing, and when the server refuses", async () => {
    const view = await setup();
    act(() => handlerRef.current!(request({ plain: "<svg></svg>" })));
    expect(await screen.findByText(/Could not paste/i)).toBeInTheDocument();
    expect(sent(view)).toHaveLength(0);
    dismissToasts();
    view.socket.autoAck = false;
    act(() => handlerRef.current!(request({ plain: SVG })));
    await waitFor(() => expect(sent(view)).toHaveLength(1));
    act(() => view.socket.receive({ type: "error", reqId: view.socket.lastReqId("ops"), message: "refused by the server" }));
    expect(await screen.findByText(/refused by the server/i)).toBeInTheDocument();
  });

  it("splits a big drop in messages under the server's limit", async () => {
    stubImage(10, 10);
    const view = await setup();
    const files = [0, 1, 2, 3].map((i) => new File([new Uint8Array(3_400_000).fill(i + 1)], `p${i}.png`, { type: "image/png" }));
    act(() => handlerRef.current!(request({ kind: "drop", files })));
    await waitFor(() => expect(sent(view).length).toBeGreaterThan(1), { timeout: 5000 });
  });
});
