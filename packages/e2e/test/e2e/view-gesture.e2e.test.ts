import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { callTool, closeSeededCanvas, connectAgent, openSeededCanvas, repoRoot, webDist, type CanvasSession } from "./seededCanvas.js";

const wasmBuilt = existsSync(join(repoRoot, "apps/web/src/wasm/paprika_render.js"));

type Probe = { renders: number; nodes: number };

describe.skipIf(!existsSync(webDist))("E2E: pan, scroll and zoom do not re-render the nodes", () => {
  let session: CanvasSession | undefined;
  let page: Page;
  const clients: Client[] = [];

  const probe = (): Promise<Probe> =>
    page.evaluate(() => {
      const world = document.querySelector(".world") as unknown as { __paprikaNodeRenders: number };
      return { renders: world.__paprikaNodeRenders, nodes: document.querySelectorAll(".world [data-paprika-id]").length };
    });
  const view = async () => {
    const t = (await page.locator(".world").getAttribute("style"))!.match(/translate\(\s*(-?[\d.]+)px,\s*(-?[\d.]+)px\)\s*scale\(\s*([\d.]+)/)!;
    return { x: Number(t[1]), y: Number(t[2]), zoom: Number(t[3]) };
  };
  const center = async () => {
    const vp = (await page.locator('[data-testid="viewport"]').boundingBox())!;
    return { x: vp.x + vp.width / 2, y: vp.y + vp.height / 2, vp };
  };
  const settle = () => page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 250)))));

  beforeAll(async () => {
    session = await openSeededCanvas("paprika-view-");
    page = session.page;
    await connectAgent(session.url, "view-agent", clients);
    await page.waitForSelector('[data-paprika-id="login"]');
    await page.waitForTimeout(400);
  }, 60_000);

  afterAll(async () => {
    await closeSeededCanvas(session, clients);
  });

  it("a wheel pan, a Shift pan, a zoom and a space drag render no node", async () => {
    const c = await center();
    await page.mouse.move(c.x, c.y);
    const before = await probe();
    expect(before.nodes).toBeGreaterThan(10);
    expect(before.renders).toBeGreaterThan(0);
    for (let i = 0; i < 30; i++) await page.mouse.wheel(0, i < 15 ? 20 : -20);
    await page.keyboard.down("Shift");
    for (let i = 0; i < 10; i++) await page.mouse.wheel(0, 15);
    await page.keyboard.up("Shift");
    await page.keyboard.down("Control");
    for (let i = 0; i < 20; i++) await page.mouse.wheel(0, i < 10 ? -30 : 30);
    await page.keyboard.up("Control");
    await page.keyboard.down("Space");
    await page.mouse.down();
    await page.mouse.move(c.x + 90, c.y + 40, { steps: 12 });
    await page.mouse.up();
    await page.keyboard.up("Space");
    await settle();
    expect((await probe()).renders).toBe(before.renders);
  });

  it("selecting and deselecting a node renders no node", async () => {
    const before = await probe();
    await page.locator('[data-layer-id="login"]').click();
    await expect.poll(() => page.getByTestId("selection").count()).toBe(1);
    await page.keyboard.press("Escape");
    await expect.poll(() => page.getByTestId("selection").count()).toBe(0);
    await settle();
    expect((await probe()).renders).toBe(before.renders);
  });

  it("changing one node renders only that node and the nodes around it, not the page", async () => {
    const before = await probe();
    const leaf = await page.evaluate(() => {
      const el = [...document.querySelectorAll<HTMLElement>(".world [data-paprika-id]")].find((e) => e.dataset.paprikaType === "text" && !e.querySelector("[data-paprika-id]"));
      let depth = 0;
      for (let p = el!.parentElement; p; p = p.parentElement) if (p.dataset.paprikaId) depth++;
      return { id: el!.dataset.paprikaId!, depth };
    });
    await callTool(clients[0]!, "update_nodes", { updates: [{ id: leaf.id, props: { opacity: 0.8 } }] });
    await expect.poll(async () => (await probe()).renders).toBeGreaterThan(before.renders);
    await settle();
    const delta = (await probe()).renders - before.renders;
    expect(delta).toBeGreaterThan(0);
    expect(delta).toBeLessThanOrEqual(leaf.depth + 3);
  });

  it("a pan moves the content by exactly the wheel delta and the selection follows it", async () => {
    await page.locator('[data-layer-id="login"]').click();
    await expect.poll(() => page.getByTestId("selection").count()).toBe(1);
    const c = await center();
    await page.mouse.move(c.x, c.y);
    const v0 = await view();
    const b0 = (await page.locator('[data-paprika-id="login"]').boundingBox())!;
    await page.mouse.wheel(60, 140);
    await expect.poll(async () => (await view()).y).toBeCloseTo(v0.y - 140, 0);
    const v1 = await view();
    expect(v1.x).toBeCloseTo(v0.x - 60, 0);
    expect(v1.zoom).toBe(v0.zoom);
    await settle();
    const b1 = (await page.locator('[data-paprika-id="login"]').boundingBox())!;
    expect(b1.x - b0.x).toBeCloseTo(-60, 0);
    expect(b1.y - b0.y).toBeCloseTo(-140, 0);
    const sel = (await page.getByTestId("selection").boundingBox())!;
    expect(Math.abs(sel.x - b1.x)).toBeLessThan(2);
    expect(Math.abs(sel.y - b1.y)).toBeLessThan(2);
    expect(Math.abs(sel.width - b1.width)).toBeLessThan(2);
    expect(Math.abs(sel.height - b1.height)).toBeLessThan(2);
    await page.keyboard.press("Escape");
  });

  it("Ctrl+wheel zooms around the cursor and respects the limits; the label follows", async () => {
    const vp = (await page.locator('[data-testid="viewport"]').boundingBox())!;
    const cx = vp.x + 300;
    const cy = vp.y + 250;
    await page.mouse.move(cx, cy);
    const v0 = await view();
    const wx = (cx - vp.x - v0.x) / v0.zoom;
    const wy = (cy - vp.y - v0.y) / v0.zoom;
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -200);
    await page.keyboard.up("Control");
    await expect.poll(async () => (await view()).zoom).toBeGreaterThan(v0.zoom * 1.2);
    await settle();
    const v1 = await view();
    expect(v1.x + wx * v1.zoom).toBeCloseTo(cx - vp.x, 0);
    expect(v1.y + wy * v1.zoom).toBeCloseTo(cy - vp.y, 0);
    await expect.poll(() => page.getByText(`${Math.round(v1.zoom * 100)}%`, { exact: true }).count()).toBe(1);
    await page.keyboard.down("Control");
    for (let i = 0; i < 40; i++) await page.mouse.wheel(0, -400);
    await settle();
    expect((await view()).zoom).toBe(8);
    for (let i = 0; i < 80; i++) await page.mouse.wheel(0, 400);
    await settle();
    expect((await view()).zoom).toBeCloseTo(0.1, 5);
    await page.keyboard.up("Control");
  }, 60_000);

  it.skipIf(!wasmBuilt)("with the WASM layer on, a pan and a zoom render no node either and the layer stays shown", async () => {
    await page.goto(`${session!.url}/w/${encodeURIComponent((await session!.external.doc()).id)}?renderer=wasm`);
    await page.waitForSelector('[data-paprika-id="login"]');
    await page.waitForFunction(() => ["cpu", "webgpu"].includes(document.querySelector<HTMLElement>('[data-testid="renderer-toggle"]')?.dataset.backend ?? ""), undefined, { timeout: 60_000 });
    await settle();
    const c = await center();
    await page.mouse.move(c.x, c.y);
    const before = await probe();
    for (let i = 0; i < 20; i++) await page.mouse.wheel(0, 25);
    await page.keyboard.down("Control");
    for (let i = 0; i < 10; i++) await page.mouse.wheel(0, -30);
    await page.keyboard.up("Control");
    await settle();
    expect((await probe()).renders).toBe(before.renders);
    await expect.poll(() => page.locator(".world").getAttribute("data-wasm-active")).toBe("1");
  }, 90_000);
});
