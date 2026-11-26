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

  const open = async (renderer?: "wasm") => {
    await page.goto(`${external!.url}/w/panelsbig01${renderer ? "?renderer=wasm" : ""}`);
    await page.waitForSelector('[data-paprika-id="r0"]', { state: "attached", timeout: 60_000 });
    if (renderer) {
      await page.waitForFunction(() => {
        const b = document.querySelector<HTMLElement>('[data-testid="renderer-toggle"]')?.dataset.backend;
        return b === "cpu" || b === "webgpu";
      });
    }
    await page.waitForTimeout(400);
  };
  const renders = () => page.evaluate(() => (document.querySelector(".world") as unknown as { __paprikaNodeRenders: number }).__paprikaNodeRenders);
  const rowCount = () => page.locator("[data-layer-id]").count();
  const aside = () => page.locator("aside.left");
  const scrollLayersTo = async (index: number) => {
    await aside().evaluate((el, i) => {
      const list = el.querySelector<HTMLElement>('[role="tree"]')!;
      el.scrollTop = list.offsetTop + i * 26 - 100;
    }, index);
    await page.waitForTimeout(150);
  };
  const posinset = (id: string) => page.locator(`[data-layer-id="${id}"]`).getAttribute("aria-posinset");

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
    const sep = page.locator('[role="separator"]').first();
    const vp = page.getByTestId("viewport");
    const w0 = (await vp.boundingBox())!.width;
    const before = await renders();
    expect(before).toBeGreaterThan(0);
    const b = (await sep.boundingBox())!;
    const x = b.x + b.width / 2;
    const y = b.y + 300;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 90, y, { steps: 12 });
    expect(await renders()).toBe(before);
    const mid = (await vp.boundingBox())!.width;
    expect(mid).toBeLessThan(w0 - 80);
    await expect.poll(() => sep.getAttribute("aria-valuenow")).toBe("330");
    await page.mouse.up();
    await page.waitForTimeout(300);
    expect(await renders()).toBe(before);
    expect(Math.abs((await vp.boundingBox())!.width - mid)).toBeLessThan(1);
    expect(await page.evaluate(() => localStorage.getItem("paprika.panel.left"))).toBe("330");
    expect(await page.locator("main").evaluate((el) => (el.parentElement as HTMLElement).style.getPropertyValue("--left-w"))).toBe("330px");
    await page.mouse.move(x + 90, y);
    await page.mouse.down();
    await page.mouse.move(x, y, { steps: 6 });
    await page.mouse.up();
    await expect.poll(() => sep.getAttribute("aria-valuenow")).toBe("240");
  });

  it("keeps the layers DOM bounded on thousands of layers", async () => {
    expect(await rowCount()).toBeLessThan(80);
    const first = page.locator('[data-layer-id="r0"]');
    await expect.poll(() => first.getAttribute("role")).toBe("treeitem");
    await expect.poll(() => first.getAttribute("aria-level")).toBe("1");
    await expect.poll(() => first.getAttribute("aria-posinset")).toBe("1");
    await expect.poll(() => first.getAttribute("aria-setsize")).toBe(String(ROOTS + 1));
    const total = await aside().evaluate((el) => el.querySelector<HTMLElement>('[role="tree"]')!.offsetHeight);
    expect(total).toBe((ROOTS + 1 + 5) * 26);
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
    await expect.poll(async () => ((await row.getAttribute("class")) ?? "")).toMatch(/is-selected/);
    const inside = async () => {
      const r = (await row.boundingBox())!;
      const a = (await aside().boundingBox())!;
      return r.y >= a.y && r.y + r.height <= a.y + a.height;
    };
    await expect.poll(inside).toBe(true);
    expect(await rowCount()).toBeLessThan(80);
    await page.locator('[data-paprika-id="r7"]').click();
    await expect.poll(() => page.locator('[data-layer-id="r7"].is-selected').count()).toBe(1);
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
      await row.locator(".layer-name").click();
      await expect.poll(async () => ((await row.getAttribute("class")) ?? "")).toMatch(/is-selected/);
      await expect.poll(() => page.getByTestId("selection").count()).toBe(1);
      await row.locator("button").nth(1).click();
      await expect.poll(async () => ((await row.getAttribute("class")) ?? "")).toMatch(/is-hidden/);
      await row.locator("button").nth(1).click();
      await expect.poll(async () => ((await row.getAttribute("class")) ?? "")).not.toMatch(/is-hidden/);
      await row.hover();
      await row.getByTestId("layer-lock").click();
      await expect.poll(() => row.getByTestId("layer-lock").getAttribute("aria-label")).toMatch(/Destravar/);
      await row.getByTestId("layer-lock").click();
      await row.locator(".layer-name").dblclick();
      const input = page.getByLabel("Nome da camada");
      await input.fill("Renomeada");
      await input.press("Enter");
      await expect.poll(() => row.locator(".layer-name").textContent()).toBe("Renomeada");
      await row.locator(".layer-name").click();
      await page.locator('[data-layer-id="r1503"] .layer-name').click({ modifiers: ["Shift"] });
      await expect.poll(() => page.locator(".layer.is-selected").count()).toBe(2);
    });

    it("expands and collapses a frame in the middle of the list", async () => {
      await scrollLayersTo(BOX_AT);
      const box = page.locator('[data-layer-id="box"]');
      await expect.poll(() => box.getAttribute("aria-expanded")).toBe("true");
      await expect.poll(() => page.locator('[data-layer-id="b2"]').getAttribute("aria-level")).toBe("2");
      await box.locator("button").first().click();
      await expect.poll(() => box.getAttribute("aria-expanded")).toBe("false");
      await expect.poll(() => page.locator('[data-layer-id="b2"]').count()).toBe(0);
      await expect.poll(() => page.locator('[data-layer-id="r2000"]').getAttribute("aria-posinset")).toBe("2002");
      await box.locator("button").first().click();
      await expect.poll(() => page.locator('[data-layer-id="b2"]').count()).toBe(1);
      await expect.poll(() => page.locator('[data-layer-id="r2000"]').getAttribute("aria-posinset")).toBe("2002");
    });

    it("reorders by dragging between far rows and reparents into a frame", async () => {
      await scrollLayersTo(1600);
      const a = page.locator('[data-layer-id="r1600"]');
      const c = page.locator('[data-layer-id="r1604"]');
      await a.dragTo(c, { targetPosition: { x: 40, y: 22 } });
      await expect.poll(() => posinset("r1600")).toBe("1605");
      await expect.poll(() => posinset("r1601")).toBe("1601");
      await scrollLayersTo(BOX_AT - 3);
      const box = page.locator('[data-layer-id="box"]');
      await page.locator('[data-layer-id="r1998"]').dragTo(box, { targetPosition: { x: 80, y: 13 } });
      await expect.poll(() => page.locator('[data-layer-id="r1998"]').getAttribute("aria-level")).toBe("2");
      await expect.poll(() => box.getAttribute("aria-expanded")).toBe("true");
    });

    it("drops on a row that was not in the DOM when the drag started", async () => {
      await scrollLayersTo(0);
      const dt = await page.evaluateHandle(() => new DataTransfer());
      const src = page.locator('[data-layer-id="r20"]');
      await src.dispatchEvent("dragstart", { dataTransfer: dt });
      await scrollLayersTo(1200);
      expect(await page.locator('[data-layer-id="r1200"]').count()).toBe(1);
      expect(await page.locator('[data-layer-id="r20"]').count()).toBe(1);
      const target = page.locator('[data-layer-id="r1200"]');
      const box = (await target.boundingBox())!;
      await target.dispatchEvent("dragover", { dataTransfer: dt, clientX: box.x + 40, clientY: box.y + box.height - 2 });
      await expect.poll(() => page.getByTestId("layer-drop-marker").count()).toBe(1);
      await target.dispatchEvent("drop", { dataTransfer: dt, clientX: box.x + 40, clientY: box.y + box.height - 2 });
      await src.dispatchEvent("dragend", { dataTransfer: dt });
      await expect.poll(() => posinset("r1200")).toBe("1200");
      await expect.poll(() => posinset("r20")).toBe("1201");
    });

    it("Tab walks across the edge of the rendered rows", async () => {
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await scrollLayersTo(900);
      const last = await page.evaluate(() => {
        const rows = [...document.querySelectorAll<HTMLElement>("[data-layer-id]")];
        return rows[rows.length - 1]!.dataset.layerId!;
      });
      const n = Number(last.slice(1));
      await page.locator(`[data-layer-id="${last}"]`).focus();
      await page.keyboard.press("Tab");
      await page.keyboard.press("Tab");
      await expect.poll(() => page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.layerId)).toBe(`r${n + 1}`);
      await page.keyboard.press("Shift+Tab");
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
    await page.goto(`${page.url().split("?")[0]}?renderer=wasm`);
    await page.waitForFunction(() => {
      const b = document.querySelector<HTMLElement>('[data-testid="renderer-toggle"]')?.dataset.backend;
      return b === "cpu" || b === "webgpu";
    });
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
  const renders = () => page.evaluate(() => (document.querySelector(".world") as unknown as { __paprikaNodeRenders: number }).__paprikaNodeRenders);

  it("the WASM canvas matches the viewport after dragging either separator", async () => {
    const s0 = await size();
    expect(s0.w).toBe(s0.ew);
    expect(s0.h).toBe(s0.eh);
    const before = await renders();
    for (const [index, dx] of [[1, -120], [0, 80]] as const) {
      const b = (await page.locator('[role="separator"]').nth(index).boundingBox())!;
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
