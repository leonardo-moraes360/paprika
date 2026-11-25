import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import type { Page } from "playwright";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { callTool, closeSeededCanvas, connectAgent, openSeededCanvas, webDist, type CanvasSession } from "./seededCanvas.js";

describe.skipIf(!existsSync(webDist))("E2E: a selected path's box matches its ink", () => {
  let session!: CanvasSession;
  let page: Page;
  let agent: Client;
  const clients: Client[] = [];

  beforeAll(async () => {
    session = await openSeededCanvas("paprika-pathbox-");
    page = session.page;
    agent = await connectAgent(session.url, "e2e-pathbox", clients);
  }, 60_000);

  afterAll(async () => {
    await closeSeededCanvas(session, clients);
  });

  const select = async (id: string) => {
    await page.locator(`[data-layer-id="${id}"]`).click();
    await expect.poll(() => page.locator(".layer.is-selected").getAttribute("data-layer-id")).toBe(id);
    await expect.poll(() => page.getByTestId("selection").count()).toBe(1);
  };

  const selectionBox = () =>
    page.evaluate(() => {
      const el = document.querySelector<HTMLElement>('[data-testid="selection"]')!;
      const vp = document.querySelector('[data-testid="viewport"]')!.getBoundingClientRect();
      return { x: vp.left + parseFloat(el.style.left), y: vp.top + parseFloat(el.style.top), width: parseFloat(el.style.width), height: parseFloat(el.style.height) };
    });

  const rectOf = (locator: string) =>
    page.evaluate((sel) => {
      const r = document.querySelector(sel)!.getBoundingClientRect();
      return { x: r.left, y: r.top, width: r.width, height: r.height };
    }, locator);

  const expectBoxMatchesInk = async (id: string) => {
    await select(id);
    await expect.poll(() => page.locator(`svg[data-paprika-id="${id}"] path`).count()).toBe(1);
    const box = await selectionBox();
    const ink = await rectOf(`svg[data-paprika-id="${id}"] path`);
    expect(box.x, `${id} x`).toBeCloseTo(ink.x, 0);
    expect(box.y, `${id} y`).toBeCloseTo(ink.y, 0);
    expect(box.width, `${id} width`).toBeCloseTo(ink.width, 0);
    expect(box.height, `${id} height`).toBeCloseTo(ink.height, 0);
    return box;
  };

  it("a d in frame coordinates under x: 0, y: 0 selects with a box on the drawing", async () => {
    await callTool(agent, "create_nodes", {
      place: "none",
      nodes: [
        {
          type: "frame",
          id: "pb-frame",
          x: 1500,
          y: 0,
          width: 700,
          height: 600,
          fill: "#ffffff",
          children: [
            { type: "path", id: "pb-traced", x: 0, y: 0, d: "M320 240 C 380 200 460 200 520 260 L500 420 L340 400 Z", fill: "#c43d27" },
          ],
        },
      ],
    });
    await expect.poll(() => page.locator('[data-paprika-id="pb-traced"]').count()).toBe(1);
    const box = await expectBoxMatchesInk("pb-traced");
    expect(box.width).toBeLessThan(260);
    expect(box.height).toBeLessThan(260);
  });

  it("normalize_paths repairs an old box and the selection follows", async () => {
    await callTool(agent, "create_nodes", {
      place: "none",
      nodes: [
        {
          type: "path",
          id: "pb-old",
          x: 1600,
          y: 100,
          d: "M300 200 L420 200 L360 320 Z",
          normalize: false,
          fill: "#1e2336",
        },
      ],
    });
    await expect.poll(() => page.locator('svg[data-paprika-id="pb-old"] path').count()).toBe(1);
    await select("pb-old");
    const before = await selectionBox();
    const inkBefore = await rectOf('svg[data-paprika-id="pb-old"] path');
    expect(before.width).toBeGreaterThan(inkBefore.width + 20);
    await callTool(agent, "normalize_paths", { ids: ["pb-old"] });
    await expect
      .poll(async () => (await selectionBox()).width)
      .toBeLessThan(before.width - 20);
    await expectBoxMatchesInk("pb-old");
    const inkAfter = await rectOf('svg[data-paprika-id="pb-old"] path');
    expect(inkAfter.x).toBeCloseTo(inkBefore.x, 0);
    expect(inkAfter.y).toBeCloseTo(inkBefore.y, 0);
  });
});
