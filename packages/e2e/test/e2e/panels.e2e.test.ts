import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "playwright";
import { chromium, type Browser } from "playwright";
import { startServer, type ExternalServer } from "../harness.js";
import { closeSeededCanvas, openSeededCanvas, repoRoot, webDist, type CanvasSession } from "./seededCanvas.js";
import { pinLocale } from "./locale.js";

const wasmBuilt = existsSync(join(repoRoot, "apps/web/src/wasm/paprika_render.js"));
const ROOTS = 3000;
const BOX_AT = 2000;
const ROW_PITCH = 30;

function bigDocument() {
  const nodes: Record<string, Record<string, unknown>> = {};
  const roots: string[] = [];
  const rect = (id: string, parentId: string, i: number) => ({ id, type: "rect", name: id, parentId, x: (i % 60) * 8, y: Math.floor(i / 60) * 8, width: 6, height: 6, fill: "#e11d48" });
  for (let i = 0; i < ROOTS; i++) {
    if (i === BOX_AT) {
      const kids = [0, 1, 2, 3, 4].map((k) => `b${k}`);
      nodes.box = { id: "box", type: "frame", name: "box", parentId: "pg", x: 520, y: 0, width: 120, height: 120, fill: "#ffffff", children: kids };
      kids.forEach((k, n) => (nodes[k] = rect(k, "box", n)));
      roots.push("box");
    }
    const id = `r${i}`;
    nodes[id] = rect(id, "pg", i);
    roots.push(id);
  }
  nodes.pg = { id: "pg", type: "page", name: "Big", parentId: null, children: roots };
  return { format: "paprika/1", id: "panelsbig01", name: "Big", tokens: {}, rootIds: ["pg"], nodes };
}

describe.skipIf(!existsSync(webDist))("E2E: panel resize and virtualized layers", { timeout: 90_000 }, () => {
  let dir: string;
  let external: ExternalServer | undefined;
  let browser: Browser;
  let page: Page;

  const open = async (renderer?: "cpu") => {
    await page.goto(`${external!.url}/w/panelsbig01${renderer ? `?renderer=${renderer}` : ""}`);
    await page.waitForSelector('[data-paprika-id="r0"]', { state: "attached", timeout: 60_000 });
    if (renderer) await page.waitForSelector('[data-testid="wasm-layer"][data-backend="cpu"]', { state: "attached" });
    await page.waitForTimeout(400);
  };
  const renders = () => page.evaluate(() => (document.querySelector("[data-canvas-world]") as unknown as { __paprikaNodeRenders: number }).__paprikaNodeRenders);
  const rowCount = () => page.locator("[data-layer-id]").count();
  const aside = () => page.getByRole("complementary", { name: "Painel de camadas" });
  const tree = () => aside().getByRole("tree");
  const scrollLayersTo = async (index: number) => {
    await tree().evaluate((el, [i, pitch]) => {
      let viewport: HTMLElement | null = el.parentElement;
      while (viewport && !["auto", "scroll"].includes(getComputedStyle(viewport).overflowY)) viewport = viewport.parentElement;
      const top = el.getBoundingClientRect().top - viewport!.getBoundingClientRect().top + viewport!.scrollTop;
      viewport!.scrollTop = top + i! * pitch! - 100;
    }, [index, ROW_PITCH]);
    await page.waitForTimeout(150);
  };
  const posinset = (id: string) => page.locator(`[data-layer-id="${id}"]`).getAttribute("aria-posinset");
  const selected = (id: string) => page.locator(`[data-layer-id="${id}"]`).getAttribute("aria-selected");
  const dragRow = async (from: string, to: string, at: number) => {
    const a = (await page.locator(`[data-layer-id="${from}"]`).boundingBox())!;
    await page.mouse.move(a.x + 70, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(a.x + 70, a.y + a.height / 2 + 12, { steps: 4 });
    const c = (await page.locator(`[data-layer-id="${to}"]`).boundingBox())!;
    await page.mouse.move(c.x + 70, c.y + c.height * at, { steps: 8 });
    await page.mouse.up();
  };

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "paprika-panels-"));
    const file = join(dir, "big.paprika.json");
    await writeFile(file, JSON.stringify(bigDocument()));
    external = await startServer({ seed: file, webRoot: webDist });
    browser = await chromium.launch(process.env.PAPRIKA_CHROMIUM ? { executablePath: process.env.PAPRIKA_CHROMIUM } : {});
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await pinLocale(page, "pt-BR");
    await open();
  }, 120_000);

  afterAll(async () => {
    await browser?.close();
    await external?.stop();
    await rm(dir, { recursive: true, force: true });
  });

  it("dragging a panel separator renders no node and leaves the viewport measured", async () => {
    const sep = page.getByRole("separator", { name: "Redimensionar painel de camadas" });
    const vp = page.getByTestId("viewport");
    const w0 = (await vp.boundingBox())!.width;
    const before = await renders();
    expect(before).toBeGreaterThan(0);
    const b = (await sep.boundingBox())!;
    const x = b.x + b.width / 2;
    const y = b.y + 300;
    const start = (await aside().boundingBox())!.width;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 90, y, { steps: 12 });
    expect(await renders()).toBe(before);
    const mid = (await vp.boundingBox())!.width;
    expect(mid).toBeLessThan(w0 - 80);
    await page.mouse.up();
    await page.waitForTimeout(300);
    expect(await renders()).toBe(before);
    expect(Math.abs((await vp.boundingBox())!.width - mid)).toBeLessThan(1);
    expect(Math.abs((await aside().boundingBox())!.width - (start + 90))).toBeLessThan(2);
    await page.mouse.move(x + 90, y);
    await page.mouse.down();
    await page.mouse.move(x, y, { steps: 6 });
    await page.mouse.up();
    await expect.poll(async () => Math.abs((await aside().boundingBox())!.width - start)).toBeLessThan(2);
  });

  it("remembers the panel width after a reload", async () => {
    const sep = page.getByRole("separator", { name: "Redimensionar painel de camadas" });
    const start = (await aside().boundingBox())!.width;
    const b = (await sep.boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + 300);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 + 60, b.y + 300, { steps: 8 });
    await page.mouse.up();
    await expect.poll(async () => Math.abs((await aside().boundingBox())!.width - (start + 60))).toBeLessThan(2);
    await open();
    await expect.poll(async () => Math.abs((await aside().boundingBox())!.width - (start + 60))).toBeLessThan(2);
  });

  it("keeps the layers DOM bounded on thousands of layers", async () => {
    expect(await rowCount()).toBeLessThan(80);
    const first = page.locator('[data-layer-id="r0"]');
    await expect.poll(() => first.getAttribute("role")).toBe("treeitem");
    await expect.poll(() => first.getAttribute("aria-level")).toBe("1");
    await expect.poll(() => first.getAttribute("aria-posinset")).toBe("1");
    await expect.poll(() => first.getAttribute("aria-setsize")).toBe(String(ROOTS + 1));
    const total = await tree().evaluate((el) => el.getBoundingClientRect().height);
    expect(total).toBe((ROOTS + 1 + 5) * ROW_PITCH);
    await scrollLayersTo(2500);
    expect(await rowCount()).toBeLessThan(80);
    expect(await posinset("r2500")).toBe("2502");
    await scrollLayersTo(0);
  });

  it("scrolls the layer row into view when a node is selected on the canvas", async () => {
    expect(await page.locator('[data-layer-id="r2500"]').count()).toBe(0);
    await page.locator('[data-paprika-id="r2500"]').click();
    const row = page.locator('[data-layer-id="r2500"]');
    await expect.poll(() => row.count()).toBe(1);
    await expect.poll(() => row.getAttribute("aria-selected")).toBe("true");
    const inside = async () => {
      const r = (await row.boundingBox())!;
      const a = (await aside().boundingBox())!;
      return r.y >= a.y && r.y + r.height <= a.y + a.height;
    };
    await expect.poll(inside).toBe(true);
    expect(await rowCount()).toBeLessThan(80);
    await page.locator('[data-paprika-id="r7"]').click();
    await expect.poll(() => selected("r7")).toBe("true");
    const near = page.locator('[data-layer-id="r7"]');
    await expect.poll(async () => {
      const r = await near.boundingBox();
      const a = (await aside().boundingBox())!;
      return r !== null && r.y >= a.y && r.y + r.height <= a.y + a.height;
    }).toBe(true);
  });
  describe("on rows that start outside the viewport", { timeout: 90_000 }, () => {
    it("selects, hides, locks and renames a far row", async () => {
      await scrollLayersTo(1500);
      const row = page.locator('[data-layer-id="r1500"]');
      await expect.poll(() => row.count()).toBe(1);
      const press = async (id: string) => page.locator(`[data-layer-id="${id}"]`).click({ position: { x: 70, y: 14 } });
      await press("r1500");
      await expect.poll(() => row.getAttribute("aria-selected")).toBe("true");
      await expect.poll(() => page.getByTestId("selection").count()).toBe(1);
      const hide = row.getByRole("button", { name: /^Ocultar/ });
      await row.hover();
      await hide.click();
      await expect.poll(() => hide.getAttribute("aria-pressed")).toBe("true");
      await row.hover();
      await hide.click();
      await expect.poll(() => hide.getAttribute("aria-pressed")).toBe("false");
      const lock = row.getByRole("button", { name: /^Travar/ });
      await row.hover();
      await lock.click();
      await expect.poll(() => lock.getAttribute("aria-pressed")).toBe("true");
      await row.hover();
      await lock.click();
      await expect.poll(() => lock.getAttribute("aria-pressed")).toBe("false");
      await row.dblclick({ position: { x: 70, y: 14 } });
      const input = page.getByLabel("Nome da camada");
      await input.fill("Renomeada");
      await input.press("Enter");
      await expect.poll(() => row.innerText()).toBe("Renomeada");
      await press("r1500");
      await page.locator('[data-layer-id="r1503"]').click({ position: { x: 70, y: 14 }, modifiers: ["Shift"] });
      await expect.poll(() => page.locator('[data-layer-id][aria-selected="true"]').count()).toBe(2);
      await page.locator('[data-layer-id="r1500"]').click({ position: { x: 70, y: 14 }, modifiers: ["Control"] });
      await expect.poll(() => page.locator('[data-layer-id][aria-selected="true"]').count()).toBe(1);
    });

    it("expands and collapses a frame in the middle of the list", async () => {
      await scrollLayersTo(BOX_AT);
      const box = page.locator('[data-layer-id="box"]');
      await expect.poll(() => box.getAttribute("aria-expanded")).toBe("true");
      await expect.poll(() => page.locator('[data-layer-id="b2"]').getAttribute("aria-level")).toBe("2");
      await box.locator('[data-slot="tree-item-indicator"], svg').first().click();
      await expect.poll(() => box.getAttribute("aria-expanded")).toBe("false");
      await expect.poll(() => page.locator('[data-layer-id="b2"]').count()).toBe(0);
      await expect.poll(() => page.locator('[data-layer-id="r2000"]').getAttribute("aria-posinset")).toBe("2002");
      await box.locator('[data-slot="tree-item-indicator"], svg').first().click();
      await expect.poll(() => page.locator('[data-layer-id="b2"]').count()).toBe(1);
      await expect.poll(() => page.locator('[data-layer-id="r2000"]').getAttribute("aria-posinset")).toBe("2002");
    });

    it("reorders by dragging between far rows and reparents into a frame", async () => {
      await scrollLayersTo(1600);
      await dragRow("r1600", "r1604", 0.85);
      await expect.poll(() => posinset("r1600")).toBe("1605");
      await expect.poll(() => posinset("r1601")).toBe("1601");
      await scrollLayersTo(BOX_AT - 3);
      await dragRow("r1998", "box", 0.5);
      await expect.poll(() => page.locator('[data-layer-id="r1998"]').getAttribute("aria-level")).toBe("2");
      await expect.poll(() => page.locator('[data-layer-id="box"]').getAttribute("aria-expanded")).toBe("true");
    });

    /** Holds the pointer on the bottom edge of the layers panel so the drag autoscrolls it; the pointer ends where the call leaves it. */
    const dragToEdge = async (from: string) => {
      const src = (await page.locator(`[data-layer-id="${from}"]`).boundingBox())!;
      const a = (await aside().boundingBox())!;
      await page.mouse.move(src.x + 70, src.y + src.height / 2);
      await page.mouse.down();
      await page.mouse.move(src.x + 70, src.y + src.height / 2 + 20, { steps: 4 });
      await page.mouse.move(src.x + 70, a.y + a.height - 10, { steps: 6 });
      return { x: src.x + 70, bottom: a.y + a.height - 10 };
    };
    const layersScrollTop = () =>
      tree().evaluate((el) => {
        let v: HTMLElement | null = el.parentElement;
        while (v && !["auto", "scroll"].includes(getComputedStyle(v).overflowY)) v = v.parentElement;
        return v!.scrollTop;
      });

    it("drops on a row that was not in the DOM when the drag started", async () => {
      await scrollLayersTo(0);
      expect(await page.locator('[data-layer-id="r38"]').count()).toBe(0);
      const pointer = await dragToEdge("r20");
      const target = page.locator('[data-layer-id="r38"]');
      await target.waitFor({ state: "attached" });
      expect(await page.locator('[data-layer-id="r20"]:not([data-drag-preview])').count()).toBe(1);
      const a = (await aside().boundingBox())!;
      await expect.poll(async () => {
        const r = (await target.boundingBox())!;
        return r.y + r.height < a.y + a.height - 60;
      }).toBe(true);
      await page.mouse.move(pointer.x, a.y + a.height / 2, { steps: 4 });
      await page.waitForTimeout(250);
      const box = (await target.boundingBox())!;
      await page.mouse.move(pointer.x, box.y + box.height - 2, { steps: 6 });
      await expect.poll(() => aside().locator('[data-mode="line"]').count()).toBe(1);
      await page.mouse.up();
      await scrollLayersTo(20);
      await expect.poll(() => posinset("r38")).toBe("38");
      await expect.poll(() => posinset("r20")).toBe("39");
    });

    it("autoscrolls a long drag without the list jumping back", async () => {
      await scrollLayersTo(0);
      await dragToEdge("r2");
      try {
        let last = 0;
        for (let i = 0; i < 30; i++) {
          await page.waitForTimeout(60);
          const top = await layersScrollTop();
          expect(top).toBeGreaterThanOrEqual(last);
          last = top;
        }
      } finally {
        await page.keyboard.press("Escape");
        await page.mouse.up();
      }
    });

    it("the arrow keys walk across the edge of the rendered rows", async () => {
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await scrollLayersTo(900);
      const last = await page.evaluate(() => {
        const rows = [...document.querySelectorAll<HTMLElement>("[data-layer-id]")];
        return rows[rows.length - 1]!.dataset.layerId!;
      });
      const n = Number(last.slice(1));
      await page.locator(`[data-layer-id="${last}"]`).focus();
      await page.keyboard.press("ArrowDown");
      await expect.poll(() => page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.layerId)).toBe(`r${n + 1}`);
      await page.keyboard.press("ArrowUp");
      await expect.poll(() => page.evaluate(() => document.activeElement?.closest<HTMLElement>("[data-layer-id]")?.dataset.layerId)).toBe(`r${n}`);
    });
  });
});

describe.skipIf(!existsSync(webDist) || !wasmBuilt)("E2E: the GPU canvas follows a panel resize", { timeout: 90_000 }, () => {
  let session: CanvasSession | undefined;
  let page: Page;

  beforeAll(async () => {
    session = await openSeededCanvas("paprika-panels-gpu-");
    page = session.page;
    await page.goto(`${page.url().split("?")[0]}?renderer=cpu`);
    await page.waitForSelector('[data-testid="wasm-layer"][data-backend="cpu"]', { state: "attached", timeout: 60_000 });
    await page.waitForSelector('[data-paprika-id="login"]');
    await page.waitForTimeout(400);
  }, 90_000);

  afterAll(async () => {
    await closeSeededCanvas(session, []);
  });

  const size = () =>
    page.evaluate(() => {
      const vp = document.querySelector<HTMLElement>('[data-testid="viewport"]')!.getBoundingClientRect();
      const c = document.querySelector<HTMLCanvasElement>('[data-testid="wasm-layer"]')!;
      const dpr = window.devicePixelRatio || 1;
      return { w: c.width, h: c.height, ew: Math.max(1, Math.round(vp.width * dpr)), eh: Math.max(1, Math.round(vp.height * dpr)), vw: vp.width };
    });
  const renders = () => page.evaluate(() => (document.querySelector("[data-canvas-world]") as unknown as { __paprikaNodeRenders: number }).__paprikaNodeRenders);

  it("the WASM canvas matches the viewport after dragging either separator", async () => {
    const s0 = await size();
    expect(s0.w).toBe(s0.ew);
    expect(s0.h).toBe(s0.eh);
    const before = await renders();
    for (const [name, dx] of [["Redimensionar painel de propriedades", -120], ["Redimensionar painel de camadas", 80]] as const) {
      const b = (await page.getByRole("separator", { name }).boundingBox())!;
      const x = b.x + b.width / 2;
      await page.mouse.move(x, b.y + 300);
      await page.mouse.down();
      await page.mouse.move(x + dx, b.y + 300, { steps: 10 });
      await page.mouse.up();
      await page.waitForTimeout(400);
      const s = await size();
      expect(s.w).toBe(s.ew);
      expect(s.h).toBe(s.eh);
    }
    const s2 = await size();
    expect(s2.vw).toBeLessThan(s0.vw - 150);
    expect(await renders()).toBe(before);
  });
});
