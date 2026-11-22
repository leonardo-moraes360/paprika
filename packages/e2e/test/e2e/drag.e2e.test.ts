import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { repoRoot, startServer, type ExternalServer } from "../harness.js";

const webRoot = join(repoRoot, "apps/web/dist");
const wasmBuilt = existsSync(join(repoRoot, "apps/web/src/wasm/paprika_render.js"));
const NODE = '[data-paprika-id="plano"]';

type Gesture = { from: { x: number; y: number }; by: { x: number; y: number } };
type Trail = { __trail: string[] };

/**
 * Regression: dropping a dragged/resized node must not flash it back to where it was before the
 * server echoes the change. The server's messages are held back so that the window between the
 * drop and the echo is long enough to observe (on localhost it is one or two frames).
 */
describe.skipIf(!existsSync(webRoot))("E2E: arraste sem piscar", () => {
  let server: ExternalServer;
  let browser: Browser;
  let page: Page;
  /** Server → page messages wait in `queue` while `holding`; page → server ones are dropped while `losing`. */
  const link = { holding: false, losing: false, queue: [] as (() => void)[] };
  const flush = () => {
    link.holding = false;
    for (const deliver of link.queue.splice(0)) deliver();
  };

  /** Opens the canvas with the given renderer (the WASM one paints shapes on a <canvas> under the DOM). */
  const open = async (renderer: "dom" | "wasm") => {
    // Straight to the active workspace's canvas (`/` is the overview), no clicks to race with the first render.
    const { active } = (await (await fetch(`${server.url}/api/workspaces`)).json()) as { active: string };
    await page.goto(`${server.url}/w/${encodeURIComponent(active)}?renderer=${renderer}`);
    await page.waitForSelector(NODE);
    if (renderer === "wasm") {
      await page.waitForFunction(() => ["cpu", "webgpu"].includes(document.querySelector<HTMLElement>('[data-testid="renderer-toggle"]')?.dataset.backend ?? ""));
    }
    await page.waitForTimeout(300);
  };

  beforeAll(async () => {
    server = await startServer({ seed: join(repoRoot, "examples/demo.paprika.json"), webRoot });
    browser = await chromium.launch({ executablePath: process.env.PAPRIKA_CHROMIUM || undefined });
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.routeWebSocket(/\/ws$/, (ws) => {
      const upstream = ws.connectToServer();
      upstream.onMessage((m) => (link.holding ? link.queue.push(() => ws.send(m)) : ws.send(m)));
      ws.onMessage((m) => {
        if (!link.losing) upstream.send(m);
      });
    });
    await open("dom");
  }, 60_000);

  // A failed assertion must not leave the next test with a socket that never delivers.
  afterEach(() => {
    link.losing = false;
    flush();
  });

  afterAll(async () => {
    await browser?.close();
    await server?.stop();
  });

  const shown = async () => (await page.locator(NODE).boundingBox())!;
  const stored = async () => (await server.doc()).nodes.plano as unknown as Record<"x" | "y" | "width" | "height", number>;

  /** Presses at `from`, moves by `by` and returns the node's box at the end of the gesture (before release). */
  const press = async ({ from, by }: Gesture) => {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + by.x, from.y + by.y, { steps: 8 });
    return shown();
  };

  /**
   * Runs a gesture with the server's echo held back and checks that the node keeps the dropped box
   * until the echo arrives, and that its inline style never goes back to the value it started with.
   */
  const dropWithoutFlash = async (gesture: Gesture, prop: "x" | "width") => {
    const before = await stored();
    await page.evaluate((sel) => {
      const el = document.querySelector<HTMLElement>(sel)!;
      const trail = [el.getAttribute("style") ?? ""];
      (window as unknown as Trail).__trail = trail;
      new MutationObserver(() => trail.push(el.getAttribute("style") ?? "")).observe(el, { attributeFilter: ["style"] });
    }, NODE);
    const end = await press(gesture);
    link.holding = true;
    await page.mouse.up();
    await expect.poll(async () => (await stored())[prop]).not.toBe(before[prop]); // applied on the server...
    await page.waitForTimeout(150); // ...but not echoed to the canvas yet
    const held = await shown();
    const gaps = [held.x - end.x, held.y - end.y, held.width - end.width, held.height - end.height].map(Math.abs);
    expect(Math.max(...gaps)).toBeLessThan(1);
    flush();
    await expect.poll(async () => (await shown()).x + (await shown()).width).toBeCloseTo(end.x + end.width, 0);
    const trail = await page.evaluate(() => (window as unknown as Trail).__trail);
    const first = trail.findIndex((s) => s !== trail[0]);
    expect(first).toBeGreaterThan(0);
    expect(trail.slice(first)).not.toContain(trail[0]);
  };

  it("soltar um frame arrastado não volta à posição antiga antes do eco do servidor", async () => {
    const b = await shown();
    await dropWithoutFlash({ from: { x: b.x + 6, y: b.y + 6 }, by: { x: 54, y: 40 } }, "x");
  });

  it("soltar um redimensionamento não volta ao tamanho antigo antes do eco do servidor", async () => {
    const b = await shown();
    await page.mouse.click(b.x + 6, b.y + 6);
    const handle = (await page.getByTestId("selection").locator('[data-resize="se"]').boundingBox())!;
    await dropWithoutFlash({ from: { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 }, by: { x: 46, y: 26 } }, "width");
  });

  it("se o servidor nunca recebe a mudança, o canvas volta ao que o servidor tem", async () => {
    await page.keyboard.press("Escape");
    const b = await shown();
    const before = JSON.stringify(await stored());
    link.losing = true; // the ops are lost on the way: no echo will ever come
    await press({ from: { x: b.x + 6, y: b.y + 6 }, by: { x: 40, y: 30 } });
    await page.mouse.up();
    await page.waitForTimeout(150);
    expect(Math.abs((await shown()).x - (b.x + 40))).toBeLessThan(2);
    // Once the wait for the server runs out, the canvas shows the server's position again.
    await expect.poll(async () => (await shown()).x, { timeout: 6000 }).toBeCloseTo(b.x, 0);
    expect(JSON.stringify(await stored())).toBe(before);
  });

  /** Share of pixels whose RGB channels differ by more than 40 between two PNG screenshots. */
  const changedShare = (a: Buffer, b: Buffer) =>
    page.evaluate(async (pngs) => {
      const pixels = await Promise.all(
        pngs.map(async (b64) => {
          const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
          const ctx = new OffscreenCanvas(bitmap.width, bitmap.height).getContext("2d")!;
          ctx.drawImage(bitmap, 0, 0);
          return ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
        }),
      );
      const [p, q] = pixels as [Uint8ClampedArray, Uint8ClampedArray];
      let changed = 0;
      for (let i = 0; i < p.length; i += 4) if ([0, 1, 2].some((c) => Math.abs(p[i + c]! - q[i + c]!) > 40)) changed++;
      return changed / (p.length / 4);
    }, [a.toString("base64"), b.toString("base64")]);

  for (const renderer of ["dom", "wasm"] as const) {
    it.skipIf(renderer === "wasm" && !wasmBuilt)(`renderizador ${renderer}: a imagem solta é a mesma do fim do arraste`, async () => {
      await open(renderer);
      const b = await shown();
      const viewport = page.getByTestId("viewport");
      await press({ from: { x: b.x + 6, y: b.y + 6 }, by: { x: 64, y: 44 } });
      await page.waitForTimeout(150); // the WASM layer draws on the next animation frame
      const frames = [await viewport.screenshot()];
      link.holding = true;
      await page.mouse.up();
      await page.waitForTimeout(150);
      frames.push(await viewport.screenshot());
      flush();
      await page.waitForTimeout(300);
      frames.push(await viewport.screenshot());
      // Before the fix the card jumped back ~64px on drop: about 5% of the viewport changed.
      expect(await changedShare(frames[0]!, frames[1]!)).toBeLessThan(0.002);
      expect(await changedShare(frames[1]!, frames[2]!)).toBeLessThan(0.002);
    });
  }
});
