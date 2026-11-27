import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright";
import { webDist } from "./seededCanvas.js";

/** The world element of the canvas: the nodes live under it. */
export const WORLD = '[data-testid="canvas-world"]';

/** A backend the WASM layer paints with (the other states are `idle`, `loading`, `error` and `unavailable`). */
export const ready = (backend: string | null | undefined) => backend === "cpu" || backend === "webgpu";

export const hasWasmAsset = () => existsSync(join(webDist, "assets")) && readdirSync(join(webDist, "assets")).some((f) => f.endsWith(".wasm"));

export async function workspaceCanvasUrl(base: string): Promise<string> {
  const active = ((await (await fetch(`${base}/api/workspaces`)).json()) as { active: string }).active;
  return `${base}/w/${encodeURIComponent(active)}`;
}

/** The three modes of the renderer menu (`?renderer=`); the old single `wasm` is only read for the old links. */
export type Renderer = "dom" | "cpu";

/**
 * Opens the workspace in the given renderer and waits until it is painting: for the WASM the layer has a backend and the DOM has handed
 * its shapes over (`data-wasm-active`), so a screenshot taken now is the layer's.
 */
export async function openCanvas(page: Page, base: string, renderer: Renderer) {
  await page.goto(`${await workspaceCanvasUrl(base)}?renderer=${renderer}`);
  await page.waitForSelector('[data-paprika-id="board"]');
  if (renderer !== "dom") {
    await page.waitForFunction(() => {
      const b = document.querySelector<HTMLElement>('[data-testid="wasm-layer"]')?.dataset.backend;
      return b === "cpu" || b === "webgpu" || b === "error" || b === "unavailable";
    });
    if (ready(await page.getByTestId("wasm-layer").getAttribute("data-backend")))
      await page.waitForFunction((world) => document.querySelector<HTMLElement>(world)?.dataset.wasmActive === "1", WORLD);
  }
  await page.waitForTimeout(300);
}

export const rendererMenu = (page: Page) => page.getByRole("button", { name: /^Renderizador: / });

const menuItem: Record<Renderer, string> = { dom: "DOM (SVG)", cpu: "WASM · CPU" };

/** Picks a renderer in the zoom bar's menu, the way a person does. */
export async function chooseRenderer(page: Page, renderer: Renderer) {
  await rendererMenu(page).click();
  await page.getByRole("menuitemradio", { name: menuItem[renderer], exact: true }).click();
}

/**
 * Picks `cpu` in the menu and returns the milliseconds from the click on the item until the layer paints again (the backend is ready
 * and the DOM has handed its shapes over), measured inside the page so the protocol round trips do not count.
 */
export async function timedChoose(page: Page): Promise<number> {
  await rendererMenu(page).click();
  await page.evaluate(() => {
    document.addEventListener(
      "click",
      (e) => {
        if ((e.target as Element).closest('[role="menuitemradio"]')) (window as unknown as { __pick: number }).__pick = performance.now();
      },
      { capture: true, once: true },
    );
  });
  await page.getByRole("menuitemradio", { name: menuItem.cpu, exact: true }).click();
  return page.evaluate(
    (world) =>
      new Promise<number>((ok) => {
        const tick = () => {
          const layer = document.querySelector<HTMLElement>('[data-testid="wasm-layer"]');
          const painting = document.querySelector<HTMLElement>(world)?.dataset.wasmActive === "1";
          if (layer?.dataset.requested === "cpu" && (layer.dataset.backend === "cpu" || layer.dataset.backend === "webgpu") && painting)
            ok(Math.round(performance.now() - (window as unknown as { __pick: number }).__pick));
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    WORLD,
  );
}

/**
 * A screenshot of the canvas's viewport without what floats over it: the bars (tools and zoom), the agents' marks (outline, tag, cursor)
 * and the build replay's outlines. None of it is the renderer's: the zoom bar's renderer label ("DOM", "WASM · CPU") must differ between the
 * two renderers, and an agent's mark depends on when its last write was. They stay in the layout (`visibility`), so nothing moves.
 */
export const HIDE_FLOATING = '[role="toolbar"], [data-testid="agent-layer"], [data-testid="build-outlines"] { visibility: hidden !important; }';

export const viewportShot = (page: Page) => page.getByTestId("viewport").screenshot({ style: HIDE_FLOATING });

/**
 * The console error of `GET /api/team` answering 404: a server without `--team` has no such route, the app asks anyway, reads the
 * refusal as "no team" and the browser logs it. It is the one expected console error of a page opened on a local server.
 */
