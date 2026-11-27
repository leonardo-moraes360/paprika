import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { repoRoot, startServer, type ExternalServer } from "../harness.js";
import { pinLocale } from "./locale.js";

const webRoot = join(repoRoot, "apps/web/dist/client");
const wasmBuilt = existsSync(join(repoRoot, "apps/web/src/wasm/paprika_render.js"));
const NODE = '[data-paprika-id="plano"]';

type Gesture = { from: { x: number; y: number }; by: { x: number; y: number } };
type Trail = { __trail: string[] };

describe.skipIf(!existsSync(webRoot))("E2E: arraste sem piscar", () => {
  let server: ExternalServer;
  let browser: Browser;
  let page: Page;
  const link = { holding: false, losing: false, queue: [] as (() => void)[] };
  const flush = () => {
    link.holding = false;
    for (const deliver of link.queue.splice(0)) deliver();
  };

  const open = async (renderer: "dom" | "cpu") => {
    const { active } = (await (await fetch(`${server.url}/api/workspaces`)).json()) as { active: string };
    await page.goto(`${server.url}/w/${encodeURIComponent(active)}?renderer=${renderer}`);
    await page.waitForSelector(NODE);
    if (renderer === "cpu") {
      await page.waitForFunction(() => ["cpu", "webgpu"].includes(document.querySelector<HTMLElement>('[data-testid="wasm-layer"]')?.dataset.backend ?? ""));
    }
    await page.waitForTimeout(300);
  };

  beforeAll(async () => {
    server = await startServer({ seed: join(repoRoot, "packages/e2e/fixtures/demo.paprika.json"), webRoot });
    browser = await chromium.launch({ executablePath: process.env.PAPRIKA_CHROMIUM || undefined });
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await pinLocale(page, "pt-BR");
    await page.routeWebSocket(/\/ws$/, (ws) => {
      const upstream = ws.connectToServer();
      upstream.onMessage((m) => (link.holding ? link.queue.push(() => ws.send(m)) : ws.send(m)));
      ws.onMessage((m) => {
        if (!link.losing) upstream.send(m);
      });
    });
    await open("dom");
  }, 60_000);

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

  const press = async ({ from, by }: Gesture) => {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + by.x, from.y + by.y, { steps: 8 });
    return shown();
  };

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
    await expect.poll(async () => (await stored())[prop]).not.toBe(before[prop]);
    await page.waitForTimeout(150);
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
    // o canto nw: depois do arraste do teste anterior o canto se do card fica sob o botão do painel de propriedades
    const handle = (await page.locator('[data-handle="nw"]').boundingBox())!;
    await dropWithoutFlash({ from: { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 }, by: { x: -46, y: -26 } }, "width");
  });

  it("se o servidor nunca recebe a mudança, o canvas volta ao que o servidor tem", async () => {
    await page.keyboard.press("Escape");
    const b = await shown();
    const before = JSON.stringify(await stored());
    link.losing = true;
    await press({ from: { x: b.x + 6, y: b.y + 6 }, by: { x: 40, y: 30 } });
    await page.mouse.up();
    await page.waitForTimeout(150);
    expect(Math.abs((await shown()).x - (b.x + 40))).toBeLessThan(2);
    await expect.poll(async () => (await shown()).x, { timeout: 6000 }).toBeCloseTo(b.x, 0);
    expect(JSON.stringify(await stored())).toBe(before);
  });

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

  it("Shift no redimensionamento mantém a proporção e o canto oposto; a dica mostra Proporção", async () => {
    await open("dom");
    const b = await shown();
    await page.mouse.click(b.x + 6, b.y + 6);
    const before = await stored();
    const ratio = before.width / before.height;
    const nw = { x: before.x, y: before.y };
    const se = page.locator('[data-handle="se"]');
    const handle = (await se.boundingBox())!;
    const hx = handle.x + handle.width / 2;
    const hy = handle.y + handle.height / 2;
    await se.hover();
    await page.mouse.down();
    await page.keyboard.down("Shift");
    await page.mouse.move(hx + 80, hy + 10, { steps: 8 });
    const hint = page.getByTestId("resize-lock-hint");
    expect(await hint.count()).toBe(1);
    expect(await hint.getAttribute("data-lock")).toBe("ratio");
    expect(await hint.textContent()).toContain("Proporção");
    await page.mouse.up();
    await page.keyboard.up("Shift");
    await expect.poll(async () => (await stored()).width).not.toBe(before.width);
    const after = await stored();
    expect(Math.min(Math.abs(after.width - Math.round(after.height * ratio)), Math.abs(after.height - Math.round(after.width / ratio)))).toBeLessThanOrEqual(1);
    expect(after.x).toBeCloseTo(nw.x, 0);
    expect(after.y).toBeCloseTo(nw.y, 0);
    expect(await page.getByTestId("resize-lock-hint").count()).toBe(0);
  }, 30_000);

  it("Shift+Alt no redimensionamento trava 1:1 e mantém o canto oposto", async () => {
    await open("dom");
    const b = await shown();
    await page.mouse.click(b.x + 6, b.y + 6);
    const before = await stored();
    const nw = { x: before.x, y: before.y };
    const se = page.locator('[data-handle="se"]');
    const handle = (await se.boundingBox())!;
    const hx = handle.x + handle.width / 2;
    const hy = handle.y + handle.height / 2;
    await se.hover();
    await page.mouse.down();
    await page.keyboard.down("Shift");
    await page.keyboard.down("Alt");
    await page.mouse.move(hx + 60, hy + 20, { steps: 8 });
    const hint = page.getByTestId("resize-lock-hint");
    expect(await hint.count()).toBe(1);
    expect(await hint.getAttribute("data-lock")).toBe("square");
    expect(await hint.textContent()).toContain("1:1");
    await page.mouse.up();
    await page.keyboard.up("Alt");
    await page.keyboard.up("Shift");
    await expect.poll(async () => Math.abs((await stored()).width - (await stored()).height)).toBeLessThanOrEqual(1);
    const after = await stored();
    expect(after.x).toBeCloseTo(nw.x, 0);
    expect(after.y).toBeCloseTo(nw.y, 0);
  }, 30_000);

  it("arrastar a toolbar pela alça ancora em cada borda e o lado fica no localStorage", async () => {
    const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await pinLocale(p, "pt-BR");
    try {
      const { active } = (await (await fetch(`${server.url}/api/workspaces`)).json()) as { active: string };
      await p.goto(`${server.url}/w/${encodeURIComponent(active)}`);
      await p.waitForSelector(NODE);
      await p.evaluate(() => localStorage.removeItem("paprika.toolbar.dock"));
      await p.reload();
      await p.waitForSelector(NODE);

      const toolbar = () => p.getByRole("toolbar", { name: "Ferramentas" });
      const dockOf = () => p.locator("[data-dock]").getAttribute("data-dock");
      const grip = () => p.getByRole("button", { name: "Mover a barra" });
      const mainBox = async () => (await p.getByRole("region", { name: "Canvas", exact: true }).boundingBox())!;

      const expectDock = async (dock: "top" | "left" | "right" | "bottom") => {
        await expect.poll(dockOf).toBe(dock);
        const bar = (await toolbar().boundingBox())!;
        const main = await mainBox();
        if (dock === "top" || dock === "bottom") {
          expect(bar.height).toBeLessThan(bar.width);
          expect(Math.abs(bar.x + bar.width / 2 - (main.x + main.width / 2))).toBeLessThan(3);
          if (dock === "top") expect(bar.y).toBeLessThan(main.y + 60);
          else expect(bar.y + bar.height).toBeGreaterThan(main.y + main.height - 60);
        } else {
          expect(bar.width).toBeLessThan(bar.height);
          expect(Math.abs(bar.y + bar.height / 2 - (main.y + main.height / 2))).toBeLessThan(3);
          if (dock === "left") expect(bar.x).toBeLessThan(main.x + 60);
          else expect(bar.x + bar.width).toBeGreaterThan(main.x + main.width - 60);
        }
        expect(await p.evaluate(() => localStorage.getItem("paprika.toolbar.dock") ?? "top")).toBe(dock);
      };

      await expectDock("top");

      const dragGripTo = async (x: number, y: number) => {
        const g = (await grip().boundingBox())!;
        await p.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
        await p.mouse.down();
        await p.mouse.move(x, y, { steps: 12 });
        await p.mouse.up();
      };

      const main = await mainBox();
      await dragGripTo(main.x + 8, main.y + main.height / 2);
      await expectDock("left");

      await p.reload();
      await p.waitForSelector(NODE);
      await expectDock("left");

      await dragGripTo(main.x + main.width - 8, main.y + main.height / 2);
      await expectDock("right");

      await dragGripTo(main.x + main.width / 2, main.y + main.height - 8);
      await expectDock("bottom");

      await dragGripTo(main.x + main.width / 2, main.y + 8);
      await expectDock("top");

      await toolbar().getByRole("button", { name: "Mais ações" }).click();
      await p.getByRole("menuitemradio", { name: "Esquerda" }).click();
      await expectDock("left");

      // o painel de camadas recolhido (e lembrado ao recarregar) deixa o botão de mostrar na borda, onde a barra à esquerda não pode ficar por cima
      await p.getByRole("separator", { name: "Redimensionar painel de camadas" }).focus();
      await p.keyboard.press("Enter");
      await expect.poll(() => p.evaluate(() => localStorage.getItem("paprika.ui-sdk-resizable:editor"))).toMatch(/\[0,/);
      await p.reload();
      await p.waitForSelector(NODE);
      await expectDock("left");
      const showLeft = p.getByRole("button", { name: "Mostrar painel de camadas" });
      expect(await showLeft.count()).toBe(1);
      const toggle = (await showLeft.boundingBox())!;
      const bar = (await toolbar().boundingBox())!;
      const overlap =
        toggle.x < bar.x + bar.width && bar.x < toggle.x + toggle.width && toggle.y < bar.y + bar.height && bar.y < toggle.y + toggle.height;
      expect(overlap).toBe(false);
    } finally {
      await p.close();
    }
  });

  it("arrastar um painel lateral além do mínimo o recolhe num botão na borda que devolve a última largura", async () => {
    const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await pinLocale(p, "pt-BR");
    try {
      const { active } = (await (await fetch(`${server.url}/api/workspaces`)).json()) as { active: string };
      await p.goto(`${server.url}/w/${encodeURIComponent(active)}`);
      await p.waitForSelector(NODE);
      const leftPanel = 'aside[aria-label="Painel de camadas"]';
      const rightPanel = 'aside[aria-label="Painel de propriedades"]';
      const width = (sel: string) => p.locator(sel).evaluate((el) => Math.round(el.getBoundingClientRect().width));
      const left = p.getByRole("separator", { name: "Redimensionar painel de camadas" });
      const right = p.getByRole("separator", { name: "Redimensionar painel de propriedades" });
      const showLeft = p.getByRole("button", { name: "Mostrar painel de camadas" });
      const showRight = p.getByRole("button", { name: "Mostrar painel de propriedades" });
      const viewport = (await p.getByTestId("viewport").boundingBox())!;

      const dragBy = async (handle: typeof left, dx: number) => {
        const b = (await handle.boundingBox())!;
        await p.mouse.move(b.x + b.width / 2, b.y + 200);
        await p.mouse.down();
        await p.mouse.move(b.x + b.width / 2 + dx / 2, b.y + 200);
        await p.mouse.move(b.x + b.width / 2 + dx, b.y + 200);
        await p.mouse.up();
      };

      expect(await width(leftPanel)).toBe(248);
      await dragBy(left, 60);
      await expect.poll(() => width(leftPanel)).toBe(308);
      await dragBy(left, -400);
      await expect.poll(() => showLeft.count()).toBe(1);
      expect(await p.locator(leftPanel).isVisible()).toBe(false);
      await expect.poll(async () => (await p.getByTestId("viewport").boundingBox())!.width).toBeGreaterThan(viewport.width);
      await expect.poll(() => p.evaluate(() => localStorage.getItem("paprika.ui-sdk-resizable:editor"))).toMatch(/\[0,/);

      await showLeft.click();
      await expect.poll(() => showLeft.count()).toBe(0);
      await expect.poll(() => width(leftPanel)).toBe(308);
      await dragBy(left, -60);
      await expect.poll(() => width(leftPanel)).toBe(248);
      expect(await showLeft.count()).toBe(0);

      await dragBy(right, 400);
      await expect.poll(() => showRight.count()).toBe(1);
      expect(await p.locator(rightPanel).isVisible()).toBe(false);
      const toolbar = (await p.getByRole("toolbar", { name: "Ferramentas" }).boundingBox())!;
      const rightButton = (await showRight.boundingBox())!;
      expect(rightButton.x).toBeGreaterThan(toolbar.x + toolbar.width);
      await showRight.click();
      await expect.poll(() => width(rightPanel)).toBe(320);

      // pelo teclado: Enter no separador recolhe e o foco fica nele (o antigo o levava ao botão de mostrar); outro Enter devolve a largura
      await left.focus();
      await p.keyboard.press("Enter");
      await expect.poll(() => showLeft.count()).toBe(1);
      expect(await left.evaluate((el) => el === document.activeElement)).toBe(true);
      await p.keyboard.press("Enter");
      await expect.poll(() => width(leftPanel)).toBe(248);
    } finally {
      await p.close();
    }
  });

  // PAP-E2E: depois de recarregar, o botão de mostrar devolve a largura padrão (248), não a última que o painel tinha (o antigo guardava a última)
  it.fails("um painel recolhido, depois de recarregar, volta à última largura ao mostrar", async () => {
    const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await pinLocale(p, "pt-BR");
    try {
      const { active } = (await (await fetch(`${server.url}/api/workspaces`)).json()) as { active: string };
      await p.goto(`${server.url}/w/${encodeURIComponent(active)}`);
      await p.waitForSelector(NODE);
      const leftPanel = 'aside[aria-label="Painel de camadas"]';
      const width = () => p.locator(leftPanel).evaluate((el) => Math.round(el.getBoundingClientRect().width));
      const left = p.getByRole("separator", { name: "Redimensionar painel de camadas" });
      const b = (await left.boundingBox())!;
      for (const dx of [60, -400]) {
        const at = (await left.boundingBox()) ?? b;
        await p.mouse.move(at.x + at.width / 2, at.y + 200);
        await p.mouse.down();
        await p.mouse.move(at.x + at.width / 2 + dx / 2, at.y + 200);
        await p.mouse.move(at.x + at.width / 2 + dx, at.y + 200);
        await p.mouse.up();
        if (dx === 60) await expect.poll(width).toBe(308);
      }
      const show = p.getByRole("button", { name: "Mostrar painel de camadas" });
      await expect.poll(() => show.count()).toBe(1);
      await p.reload();
      await p.waitForSelector(NODE);
      await show.click();
      await expect.poll(width).toBe(308);
    } finally {
      await p.close();
    }
  });

  for (const renderer of ["dom", "cpu"] as const) {
    it.skipIf(renderer === "cpu" && !wasmBuilt)(`renderizador ${renderer}: a imagem solta é a mesma do fim do arraste`, async () => {
      await open(renderer);
      const b = await shown();
      const viewport = page.getByTestId("viewport");
      await press({ from: { x: b.x + 6, y: b.y + 6 }, by: { x: 64, y: 44 } });
      await page.waitForTimeout(150);
      const frames = [await viewport.screenshot()];
      link.holding = true;
      await page.mouse.up();
      await page.waitForTimeout(150);
      frames.push(await viewport.screenshot());
      flush();
      await page.waitForTimeout(300);
      frames.push(await viewport.screenshot());
      expect(await changedShare(frames[0]!, frames[1]!)).toBeLessThan(0.002);
      expect(await changedShare(frames[1]!, frames[2]!)).toBeLessThan(0.002);
    });
  }
});

describe.skipIf(!existsSync(webRoot))("E2E: drag and drop reparent e arquivos (PAP-B-049)", () => {
  let server: ExternalServer;
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    server = await startServer({ seed: join(repoRoot, "packages/e2e/fixtures/demo.paprika.json"), webRoot });
    browser = await chromium.launch({ executablePath: process.env.PAPRIKA_CHROMIUM || undefined });
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await pinLocale(page, "pt-BR");
    const { active } = (await (await fetch(`${server.url}/api/workspaces`)).json()) as { active: string };
    await page.goto(`${server.url}/w/${encodeURIComponent(active)}`);
    await page.waitForSelector(NODE);
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    await server?.stop();
  });

  const postOps = async (ops: unknown[], label: string) => {
    const res = await page.evaluate(
      async ({ ops, label }) => {
        const r = await fetch("/api/ops", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ops, label }),
        });
        return { ok: r.ok, status: r.status, text: await r.text() };
      },
      { ops, label },
    );
    if (!res.ok) throw new Error(`ops ${res.status}: ${res.text}`);
  };

  const boxOf = async (id: string) => (await page.locator(`[data-paprika-id="${id}"]`).boundingBox())!;

  const undoOnce = async () => {
    await page.keyboard.press("Control+z");
  };

  it("reparent: soltar um nó livre dentro de um frame troca o pai (um undo)", async () => {
    await postOps(
      [
        { op: "create", parentId: null, node: { type: "frame", id: "drop-frame", name: "Alvo", x: 900, y: 40, width: 260, height: 200, fill: "#ffffff" } },
        { op: "create", parentId: null, node: { type: "rect", id: "drop-rect", name: "Livre", x: 820, y: 280, width: 80, height: 50, fill: "#c43d27" } },
      ],
      "setup reparent",
    );
    await page.waitForSelector('[data-paprika-id="drop-rect"]');
    await page.waitForSelector('[data-paprika-id="drop-frame"]');
    await page.getByRole("button", { name: "Enquadrar" }).click();
    await page.waitForTimeout(200);
    await page.locator('[data-paprika-id="drop-rect"]').click({ position: { x: 10, y: 10 } });
    const from = await boxOf("drop-rect");
    const to = await boxOf("drop-frame");
    await page.mouse.move(from.x + 10, from.y + 10);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 16 });
    await expect.poll(async () => page.getByTestId("drop-target").count()).toBe(1);
    await page.mouse.up();
    await expect.poll(async () => (await server.doc()).nodes["drop-rect"]?.parentId).toBe("drop-frame");
    await undoOnce();
    await expect.poll(async () => (await server.doc()).nodes["drop-rect"]?.parentId ?? null).toBe(null);
  }, 30_000);

  it("auto-layout: reordenar filhos pelo arraste com marcador", async () => {
    await postOps(
      [
        {
          op: "create",
          parentId: null,
          node: {
            type: "frame",
            id: "flow",
            name: "Flow",
            x: 900,
            y: 280,
            width: 200,
            height: 260,
            fill: "#ffffff",
            layout: { mode: "column", gap: 8, padding: 12 },
          },
        },
        { op: "create", parentId: "flow", node: { type: "rect", id: "flow-a", name: "A", width: 160, height: 40, fill: "#d9d4cf" } },
        { op: "create", parentId: "flow", node: { type: "rect", id: "flow-b", name: "B", width: 160, height: 40, fill: "#c43d27" } },
        { op: "create", parentId: "flow", node: { type: "rect", id: "flow-c", name: "C", width: 160, height: 40, fill: "#4cc7d8" } },
      ],
      "setup flow",
    );
    await page.waitForSelector('[data-paprika-id="flow-a"]');
    await page.getByRole("button", { name: "Enquadrar" }).click();
    await page.waitForTimeout(200);
    await expect.poll(async () => ((await server.doc()).nodes.flow as { children: string[] }).children.join(",")).toBe("flow-a,flow-b,flow-c");
    const a = await boxOf("flow-a");
    const c = await boxOf("flow-c");
    await page.locator('[data-paprika-id="flow-a"]').click({ position: { x: 20, y: 10 } });
    await page.mouse.move(a.x + 20, a.y + 10);
    await page.mouse.down();
    await page.mouse.move(c.x + c.width / 2, c.y + c.height + 4, { steps: 16 });
    await expect.poll(async () => page.getByTestId("drop-marker").count()).toBe(1);
    await page.mouse.up();
    await expect.poll(async () => ((await server.doc()).nodes.flow as { children: string[] }).children.join(",")).toBe("flow-b,flow-c,flow-a");
    await undoOnce();
    await expect.poll(async () => ((await server.doc()).nodes.flow as { children: string[] }).children.join(",")).toBe("flow-a,flow-b,flow-c");
  }, 30_000);

  it("camadas: arrastar linha reordena irmãos (um undo)", async () => {
    const kids = ((await server.doc()).nodes.flow as { children: string[] } | undefined)?.children;
    expect(kids).toEqual(["flow-a", "flow-b", "flow-c"]);
    const rowA = page.locator('[data-layer-id="flow-a"]');
    const rowC = page.locator('[data-layer-id="flow-c"]');
    await rowC.scrollIntoViewIfNeeded();
    await rowA.dragTo(rowC, { targetPosition: { x: 40, y: 8 } });
    await expect.poll(async () => ((await server.doc()).nodes.flow as { children: string[] }).children.join(",")).not.toBe("flow-a,flow-b,flow-c");
    expect(((await server.doc()).nodes.flow as { children: string[] }).children[0]).not.toBe("flow-a");
    await undoOnce();
    await expect.poll(async () => ((await server.doc()).nodes.flow as { children: string[] }).children.join(",")).toBe("flow-a,flow-b,flow-c");
  }, 30_000);

  it("soltar PNG e SVG no canvas importa (um undo cada)", async () => {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR42mP8z8BQz0AEYBxVSF+FAP5FDvcfRYWgAAAAAElFTkSuQmCC",
      "base64",
    );
    const before = Object.keys((await server.doc()).nodes).length;
    const at = await page.evaluate(async (pngB64) => {
      const frame = document.querySelector('[data-paprika-id="login"]')!.getBoundingClientRect();
      const zoom = new DOMMatrix(getComputedStyle(document.querySelector("[data-canvas-world]")!).transform).a || 1;
      const dt = new DataTransfer();
      dt.items.add(new File([Uint8Array.from(atob(pngB64), (c) => c.charCodeAt(0))], "pixel.png", { type: "image/png" }));
      const target = document.querySelector('[data-testid="viewport"]')!;
      const clientX = frame.left + 16;
      const clientY = frame.top + 16;
      target.dispatchEvent(new DragEvent("dragenter", { bubbles: true, cancelable: true, dataTransfer: dt }));
      target.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, clientX, clientY, dataTransfer: dt }));
      const drop = new DragEvent("drop", { bubbles: true, cancelable: true, clientX, clientY, dataTransfer: dt });
      target.dispatchEvent(drop);
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="#c43d27"/></svg>`;
      const dt2 = new DataTransfer();
      dt2.items.add(new File([svg], "box.svg", { type: "image/svg+xml" }));
      target.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, clientX: drop.clientX + 40, clientY: drop.clientY + 40, dataTransfer: dt2 }));
      const box = document.querySelector('[data-paprika-id="login"]')!.getBoundingClientRect();
      return { x: Math.round((drop.clientX - box.left) / zoom), y: Math.round((drop.clientY - box.top) / zoom) };
    }, png.toString("base64"));
    await expect.poll(async () => Object.keys((await server.doc()).nodes).length).toBeGreaterThan(before + 1);
    const nodes = (await server.doc()).nodes;
    const images = Object.values(nodes).filter((n) => (n as { type: string }).type === "image");
    expect(images.length).toBeGreaterThanOrEqual(1);
    const dropped = images.find((n) => String((n as { src?: string }).src).startsWith("data:image/png")) as
      | { src: string; parentId?: string; x: number; y: number; layoutPositioning?: string }
      | undefined;
    expect(dropped).toBeTruthy();
    expect(dropped!.src).toContain(png.toString("base64"));
    expect(dropped!.parentId).toBe("login");
    expect(dropped!.layoutPositioning).toBe("absolute");
    expect(dropped!.x).toBe(at.x);
    expect(dropped!.y).toBe(at.y);
    await undoOnce();
    await undoOnce();
  }, 30_000);
});
