import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { impl, repoRoot, startServer, type ExternalServer } from "../external/harness.js";

const webRoot = join(repoRoot, "apps/web/dist");
const wasmBuilt = existsSync(join(repoRoot, "apps/web/src/wasm/paprika_render.js"));

/** Fraction of pixels that differ by more than `tol` in any channel (decoded in the page). */
async function diffRatio(page: Page, a: Buffer, b: Buffer, tol = 40): Promise<number> {
  return page.evaluate(
    async ([a64, b64, t]) => {
      const load = async (s: string) => {
        const img = new Image();
        img.src = `data:image/png;base64,${s}`;
        await img.decode();
        const c = document.createElement("canvas");
        c.width = img.width;
        c.height = img.height;
        const x = c.getContext("2d")!;
        x.drawImage(img, 0, 0);
        return x.getImageData(0, 0, c.width, c.height).data;
      };
      const [pa, pb] = await Promise.all([load(a64 as string), load(b64 as string)]);
      let bad = 0;
      for (let i = 0; i < pa.length; i += 4) {
        if (Math.max(Math.abs(pa[i]! - pb[i]!), Math.abs(pa[i + 1]! - pb[i + 1]!), Math.abs(pa[i + 2]! - pb[i + 2]!)) > (t as number)) bad++;
      }
      return bad / (pa.length / 4);
    },
    [a.toString("base64"), b.toString("base64"), tol] as const,
  );
}

/**
 * Regression: dropping a dragged/resized node must not flash it back to where it was before the
 * server echoes the change. The server's messages are held back so that the window between the
 * drop and the echo is long enough to observe (on localhost it is one or two frames).
 */
describe.skipIf(!existsSync(webRoot))(`E2E (${impl}): arraste sem piscar`, () => {
  let server: ExternalServer;
  let browser: Browser;
  let page: Page;
  let hold = false;
  let held: (() => void)[] = [];
  let dropOutgoing = false;
  const release = () => {
    hold = false;
    for (const send of held.splice(0)) send();
  };

  /** Opens the canvas with the given renderer (the WASM one paints shapes on a <canvas> under the DOM). */
  const open = async (renderer: "dom" | "wasm") => {
    await page.goto(server.url);
    await page.locator(".workspace-card.is-active").click();
    await page.waitForSelector('[data-paprika-id="plano"]');
    await page.goto(`${page.url().split("?")[0]}?renderer=${renderer}`);
    await page.waitForSelector('[data-paprika-id="plano"]');
    if (renderer === "wasm") {
      await page.waitForFunction(() => {
        const b = document.querySelector<HTMLElement>('[data-testid="renderer-toggle"]')?.dataset.backend;
        return b === "cpu" || b === "webgpu";
      });
    }
    await page.waitForTimeout(300);
  };

  beforeAll(async () => {
    server = await startServer({ seed: join(repoRoot, "examples/demo.paprika.json"), webRoot });
    browser = await chromium.launch(process.env.PAPRIKA_CHROMIUM ? { executablePath: process.env.PAPRIKA_CHROMIUM } : {});
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.routeWebSocket(/\/ws$/, (ws) => {
      const upstream = ws.connectToServer();
      upstream.onMessage((m) => (hold ? held.push(() => ws.send(m)) : ws.send(m)));
      ws.onMessage((m) => {
        if (!dropOutgoing) upstream.send(m);
      });
    });
    await page.goto(server.url);
    await page.locator(".workspace-card.is-active").click();
    await page.waitForSelector('[data-paprika-id="plano"]');
  }, 60_000);

  // A failed assertion must not leave the next test with a socket that never delivers.
  afterEach(() => {
    dropOutgoing = false;
    release();
  });

  afterAll(async () => {
    await browser?.close();
    await server?.stop();
  });

  /** Records every inline left/top/width/height the node gets, so a flash back shows up even if it lasts one frame. */
  const watch = (id: string) =>
    page.evaluate((id) => {
      const el = document.querySelector<HTMLElement>(`[data-paprika-id="${id}"]`)!;
      const w = window as unknown as { __styles: string[] };
      const snap = () => `${el.style.left}|${el.style.top}|${el.style.width}|${el.style.height}`;
      w.__styles = [snap()];
      new MutationObserver(() => w.__styles.push(snap())).observe(el, { attributes: true, attributeFilter: ["style"] });
    }, id);
  const styles = () => page.evaluate(() => (window as unknown as { __styles: string[] }).__styles);

  it("soltar um frame arrastado não volta à posição antiga antes do eco do servidor", async () => {
    const frame = page.locator('[data-paprika-id="plano"]');
    const before = (await server.doc()).nodes.plano as { x: number; y: number };
    const box = (await frame.boundingBox())!;
    await watch("plano");
    await page.mouse.move(box.x + 6, box.y + 6);
    await page.mouse.down();
    await page.mouse.move(box.x + 60, box.y + 46, { steps: 8 });
    const dragged = (await frame.boundingBox())!;
    hold = true;
    await page.mouse.up();
    // The server applied the move, but the canvas has not heard back yet.
    await expect.poll(async () => ((await server.doc()).nodes.plano as { x: number }).x).not.toBe(before.x);
    await page.waitForTimeout(150);
    const dropped = (await frame.boundingBox())!;
    expect(Math.abs(dropped.x - dragged.x)).toBeLessThan(1);
    expect(Math.abs(dropped.y - dragged.y)).toBeLessThan(1);
    release();
    const after = (await server.doc()).nodes.plano as { x: number; y: number };
    await expect.poll(async () => (await frame.boundingBox())!.x).toBeCloseTo(dragged.x, 0);
    // Once it moved, it never went back to the original left/top.
    const seen = await styles();
    const original = seen[0]!;
    const firstMove = seen.findIndex((s) => s !== original);
    expect(firstMove).toBeGreaterThan(0);
    expect(seen.slice(firstMove)).not.toContain(original);
    expect(seen.at(-1)!.startsWith(`${after.x}px|${after.y}px|`)).toBe(true);
  });

  it("soltar um redimensionamento não volta ao tamanho antigo antes do eco do servidor", async () => {
    const frame = page.locator('[data-paprika-id="plano"]');
    await frame.click({ position: { x: 6, y: 6 } });
    const handle = page.locator(".selection .handle");
    await handle.waitFor();
    const before = (await server.doc()).nodes.plano as { width: number };
    const h = (await handle.boundingBox())!;
    await watch("plano");
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
    await page.mouse.down();
    await page.mouse.move(h.x + 50, h.y + 30, { steps: 6 });
    const resized = (await frame.boundingBox())!;
    hold = true;
    await page.mouse.up();
    await expect.poll(async () => ((await server.doc()).nodes.plano as { width: number }).width).not.toBe(before.width);
    await page.waitForTimeout(150);
    const dropped = (await frame.boundingBox())!;
    expect(Math.abs(dropped.width - resized.width)).toBeLessThan(1);
    release();
    await expect.poll(async () => (await frame.boundingBox())!.width).toBeCloseTo(resized.width, 0);
    const seen = await styles();
    const firstChange = seen.findIndex((s) => s !== seen[0]);
    expect(firstChange).toBeGreaterThan(0);
    expect(seen.slice(firstChange)).not.toContain(seen[0]);
  });

  it("se o servidor nunca recebe a mudança, o canvas volta ao que o servidor tem", async () => {
    const frame = page.locator('[data-paprika-id="plano"]');
    await page.keyboard.press("Escape");
    const box = (await frame.boundingBox())!;
    const before = JSON.stringify((await server.doc()).nodes.plano);
    dropOutgoing = true; // the ops are lost on the way: no echo will ever come
    try {
      await page.mouse.move(box.x + 6, box.y + 6);
      await page.mouse.down();
      await page.mouse.move(box.x + 46, box.y + 36, { steps: 6 });
      await page.mouse.up();
      await page.waitForTimeout(150);
      expect(Math.abs((await frame.boundingBox())!.x - (box.x + 40))).toBeLessThan(2);
      // After the wait for the server runs out, the canvas shows the server's position again.
      await expect.poll(async () => (await frame.boundingBox())!.x, { timeout: 6000 }).toBeCloseTo(box.x, 0);
      expect(JSON.stringify((await server.doc()).nodes.plano)).toBe(before);
    } finally {
      dropOutgoing = false;
    }
  });

  for (const renderer of ["dom", "wasm"] as const) {
    it.skipIf(renderer === "wasm" && !wasmBuilt)(`renderizador ${renderer}: a imagem solta é a mesma do fim do arraste`, async () => {
      await open(renderer);
      const frame = page.locator('[data-paprika-id="plano"]');
      const box = (await frame.boundingBox())!;
      const vp = page.getByTestId("viewport");
      await page.mouse.move(box.x + 6, box.y + 6);
      await page.mouse.down();
      await page.mouse.move(box.x + 70, box.y + 50, { steps: 8 });
      await page.waitForTimeout(150); // the WASM layer draws on the next animation frame
      const dragging = await vp.screenshot();
      hold = true;
      await page.mouse.up();
      await page.waitForTimeout(150);
      const dropped = await vp.screenshot();
      release();
      await page.waitForTimeout(300);
      const settled = await vp.screenshot();
      // Before the fix the card jumped back ~64px on drop: a large share of the viewport changed.
      expect(await diffRatio(page, dragging, dropped)).toBeLessThan(0.002);
      expect(await diffRatio(page, dropped, settled)).toBeLessThan(0.002);
    });
  }
});
