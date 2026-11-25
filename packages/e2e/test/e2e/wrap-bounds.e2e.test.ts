import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import type { Page } from "playwright";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { callTool, closeSeededCanvas, connectAgent, openSeededCanvas, webDist, type CanvasSession } from "./seededCanvas.js";

type Box = { x: number; y: number; width: number; height: number };

describe.skipIf(!existsSync(webDist))("E2E: get_bounds follows the wrapping flex layout", () => {
  let session!: CanvasSession;
  let page: Page;
  let agent: Client;
  const clients: Client[] = [];

  beforeAll(async () => {
    session = await openSeededCanvas("paprika-wrap-");
    page = session.page;
    agent = await connectAgent(session.url, "e2e-wrap", clients);
  }, 60_000);

  afterAll(async () => {
    await closeSeededCanvas(session, clients);
  });

  const chips = (prefix: string, n: number, w: number, h: number) =>
    Array.from({ length: n }, (_, i) => ({ type: "rect", id: `${prefix}${i}`, width: w, height: h, fill: "#c43d27" }));

  const boundsOf = async (ids: string[]) => {
    const res = await callTool(agent, "get_bounds", { ids });
    return (JSON.parse(res.content.map((c) => c.text ?? "").join("")) as { boxes: Record<string, Box> }).boxes;
  };

  const domBoxes = (ids: string[], rootId: string) =>
    page.evaluate(
      ([list, root]) => {
        const rect = (id: string) => document.querySelector(`[data-paprika-id="${id}"]`)!.getBoundingClientRect();
        const r0 = rect(root!);
        const zoom = r0.width / (document.querySelector(`[data-paprika-id="${root}"]`) as HTMLElement).offsetWidth;
        const out: Record<string, { x: number; y: number; width: number; height: number }> = {};
        for (const id of list as string[]) {
          const r = rect(id);
          out[id] = { x: (r.left - r0.left) / zoom, y: (r.top - r0.top) / zoom, width: r.width / zoom, height: r.height / zoom };
        }
        return out;
      },
      [ids, rootId] as const,
    );

  const expectSame = async (ids: string[], rootId: string) => {
    const want = await boundsOf(ids);
    const root = want[rootId]!;
    await expect.poll(() => page.locator(`[data-paprika-id="${ids[ids.length - 1]}"]`).count()).toBe(1);
    const dom = await domBoxes(ids, rootId);
    for (const id of ids) {
      const b = want[id]!;
      expect(dom[id]!.x, `${id} x`).toBeCloseTo(b.x - root.x, 0);
      expect(dom[id]!.y, `${id} y`).toBeCloseTo(b.y - root.y, 0);
      expect(dom[id]!.width, `${id} width`).toBeCloseTo(b.width, 0);
      expect(dom[id]!.height, `${id} height`).toBeCloseTo(b.height, 0);
    }
  };

  it("a row of chips that wraps (the reported repro) has the height the canvas paints", async () => {
    await callTool(agent, "create_nodes", {
      place: "none",
      nodes: [
        {
          type: "frame",
          id: "wrap-chips",
          x: 40,
          y: 40,
          width: 400,
          height: "hug",
          layout: { mode: "row", gap: 12, wrap: true },
          children: chips("wc", 11, 88, 40),
        },
      ],
    });
    const ids = ["wrap-chips", ...Array.from({ length: 11 }, (_, i) => `wc${i}`)];
    await expectSame(ids, "wrap-chips");
    const b = await boundsOf(["wrap-chips"]);
    expect(b["wrap-chips"]!.height).toBeGreaterThan(40 * 2);
  });

  it("fill-width grid in a column, align center and justify between per line, and a wrapping column", async () => {
    await callTool(agent, "create_nodes", {
      place: "none",
      nodes: [
        {
          type: "frame",
          id: "wrap-page",
          x: 520,
          y: 40,
          width: 360,
          height: "hug",
          layout: { mode: "column", gap: 16, padding: 8 },
          children: [
            { type: "frame", id: "wrap-grid", width: "fill", height: "hug", layout: { mode: "row", gap: 12, wrap: true }, children: chips("wg", 5, 100, 30) },
            { type: "rect", id: "wrap-tail", width: "fill", height: 10, fill: "#445566" },
          ],
        },
        {
          type: "frame",
          id: "wrap-spread",
          x: 40,
          y: 400,
          width: 400,
          height: 200,
          layout: { mode: "row", gap: 8, wrap: true, align: "center", justify: "between" },
          children: Array.from({ length: 9 }, (_, i) => ({ type: "rect", id: `ws${i}`, width: 90, height: 20 + (i % 3) * 10, fill: "#c43d27" })),
        },
        {
          type: "frame",
          id: "wrap-col",
          x: 520,
          y: 400,
          width: "hug",
          height: 120,
          layout: { mode: "column", gap: 8, wrap: true, padding: [4, 6, 4, 6] },
          children: chips("wk", 7, 50, 40),
        },
      ],
    });
    await expectSame(["wrap-page", "wrap-grid", "wg0", "wg3", "wg4", "wrap-tail"], "wrap-page");
    await expectSame(["wrap-spread", ...Array.from({ length: 9 }, (_, i) => `ws${i}`)], "wrap-spread");
    await expectSame(["wrap-col", ...Array.from({ length: 7 }, (_, i) => `wk${i}`)], "wrap-col");
  });
});
