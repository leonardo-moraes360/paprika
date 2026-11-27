import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startServer, type ExternalServer } from "../harness.js";
import { pinLocale } from "./locale.js";
import { repoRoot as root, webDist as webRoot } from "./seededCanvas.js";
import { chooseRenderer, hasWasmAsset, openCanvas, rendererMenu, timedChoose, HIDE_FLOATING, isTeamProbe, viewportShot, workspaceCanvasUrl, WORLD, type Renderer } from "./support-e2.js";

const wasmBuilt = existsSync(webRoot) && hasWasmAsset();
const shots = process.env.PAPRIKA_E2E_SHOTS;
const layerAttr = (page: Page, name: string) => page.getByTestId("wasm-layer").getAttribute(name);

async function diffRatio(page: Page, a: Buffer, b: Buffer, tol = 40, slack = 0): Promise<number> {
  return page.evaluate(
    async ([a64, b64, t, sl]) => {
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
      const w = (await new Promise<number>((ok) => {
        const img = new Image();
        img.onload = () => ok(img.width);
        img.src = `data:image/png;base64,${a64}`;
      })) as number;
      const h = pa.length / 4 / w;
      const r = sl as number;
      const soften = (src: Uint8ClampedArray) => {
        if (!r) return src;
        const out = new Uint8ClampedArray(src.length);
        for (let y = 0; y < h; y++)
          for (let x = 0; x < w; x++)
            for (let c = 0; c < 3; c++) {
              let sum = 0;
              let n = 0;
              for (let dy = -r; dy <= r; dy++)
                for (let dx = -r; dx <= r; dx++) {
                  const x2 = x + dx;
                  const y2 = y + dy;
                  if (x2 < 0 || y2 < 0 || x2 >= w || y2 >= h) continue;
                  sum += src[(y2 * w + x2) * 4 + c]!;
                  n++;
                }
              out[(y * w + x) * 4 + c] = sum / n;
            }
        return out;
      };
      const [qa, qb] = [soften(pa), soften(pb)];
      let bad = 0;
      for (let i = 0; i < pa.length; i += 4) {
        if (Math.max(Math.abs(qa[i]! - qb[i]!), Math.abs(qa[i + 1]! - qb[i + 1]!), Math.abs(qa[i + 2]! - qb[i + 2]!)) > (t as number)) bad++;
      }
      return bad / (pa.length / 4);
    },
    [a.toString("base64"), b.toString("base64"), tol, slack] as const,
  );
}

describe.skipIf(!wasmBuilt)("E2E: canvas com renderizador WASM", () => {
  let dir: string;
  let external: ExternalServer | undefined;
  let url: string;
  let browser: Browser;
  let page: Page;
  let agent: Client;
  const errors: string[] = [];

  const canvasUrl = () => workspaceCanvasUrl(url);
  const open = (renderer: Renderer) => openCanvas(page, url, renderer);
  const shot = () => viewportShot(page);

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "paprika-wasm-e2e-"));
    const file = join(dir, "bezier.paprika.json");
    await copyFile(join(root, "packages/e2e/fixtures/bezier.paprika.json"), file);
    external = await startServer({ seed: file, webRoot });
    url = external.url;
    browser = await chromium.launch(process.env.PAPRIKA_CHROMIUM ? { executablePath: process.env.PAPRIKA_CHROMIUM } : {});
    page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await pinLocale(page, "pt-BR");
    page.on("pageerror", (e) => errors.push(e.message));
    agent = new Client({ name: "e2e-wasm", version: "0" });
    await agent.connect(new StreamableHTTPClientTransport(new URL(`${url}/mcp`)));
  }, 60_000);

  afterAll(async () => {
    await agent?.close();
    await browser?.close();
    await external?.stop();
    await rm(dir, { recursive: true, force: true });
  });

  it("serve o .wasm com o MIME certo", async () => {
    const wasm = readdirSync(join(webRoot, "assets")).find((f) => f.endsWith(".wasm"));
    expect(wasm).toBeDefined();
    const res = await fetch(`${url}/assets/${wasm}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/wasm");
  });

  it("desenha as formas no WASM (CPU sem GPU) e fica igual ao DOM", async () => {
    await open("dom");
    const dom = await shot();
    await open("cpu");
    const backend = await layerAttr(page, "data-backend");
    expect(["cpu", "webgpu"]).toContain(backend);
    expect(await page.getByTestId("wasm-layer").count()).toBe(1);
    const bg = await page.locator('[data-paprika-id="board"]').evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg).toBe("rgba(0, 0, 0, 0)");
    const wasm = await shot();
    if (shots) {
      const { writeFile } = await import("node:fs/promises");
      await writeFile(join(shots, "wasm-dom.png"), dom);
      await writeFile(join(shots, "wasm-wasm.png"), wasm);
    }
    expect(await diffRatio(page, dom, wasm)).toBeLessThan(0.005);
    expect(errors).toEqual([]);
  });

  it("conteúdo centralizado numa forma (layout centro/centro) fica igual no DOM e no WASM", async () => {
    await agent.callTool({
      name: "create_nodes",
      arguments: {
        nodes: [
          {
            type: "frame",
            id: "centered",
            name: "centered",
            x: 0,
            y: 620,
            width: 220,
            height: 90,
            radius: 12,
            fill: "#cc3322",
            layout: { mode: "row", gap: 0, padding: 0, align: "center", justify: "center" },
            children: [
              { type: "text", id: "centered-label", text: "Começar", color: "#ffffff", fontSize: 22, fontWeight: 700 },
              { type: "rect", id: "centered-dot", width: 14, height: 14, radius: 7, fill: "#ffffff" },
            ],
          },
        ],
      },
    });
    const settled = async () => {
      await page.waitForSelector('[data-paprika-id="centered"]');
      await expect.poll(() => page.locator("[data-build]").count(), { interval: 50, timeout: 4000 }).toBe(0);
    };
    try {
      await open("dom");
      await settled();
      const dom = await shot();
      await open("cpu");
      await settled();
      await expect.poll(async () => diffRatio(page, dom, await shot()), { interval: 200, timeout: 5000 }).toBeLessThan(0.005);
    } finally {
      await agent.callTool({ name: "delete_nodes", arguments: { ids: ["centered"] } });
    }
    expect(errors).toEqual([]);
  });

  it("forma convertida em frame (rect e elipse redonda) desenha igual antes e depois, no DOM e no WASM", async () => {
    await agent.callTool({
      name: "create_nodes",
      arguments: {
        nodes: [
          {
            type: "frame",
            id: "conv-stage",
            x: 240,
            y: 590,
            width: 440,
            height: 150,
            fill: "#ffffff",
            children: [
              { type: "rect", id: "conv-rect", x: 20, y: 30, width: 220, height: 90, radius: 14, fill: "#cc3322", stroke: { color: "#1e1b4b", width: 3 }, shadow: { x: 0, y: 3, blur: 6, color: "#00000055" } },
              { type: "text", id: "conv-text", text: "Começar", x: 50, y: 60, color: "#ffffff", fontSize: 22, fontWeight: 700 },
              { type: "ellipse", id: "conv-circle", x: 280, y: 15, width: 120, height: 120, fill: "#fbbf24", stroke: { color: "#111111", width: 4 } },
              { type: "path", id: "conv-icon", d: "M12 2L15 9L22 9L16 14L18 21L12 17L6 21L8 14L2 9L9 9Z", x: 328, y: 63, width: 24, height: 24, fill: "#111111" },
            ],
          },
        ],
      },
    });
    let n = 0;
    const view = async (renderer: Renderer) => {
      await open(renderer);
      await page.waitForSelector('[data-paprika-id="conv-circle"]');
      const png = await shot();
      if (shots) await (await import("node:fs/promises")).writeFile(join(shots, `conv-${renderer}-${++n}.png`), png);
      return png;
    };
    const domBefore = await view("dom");
    const wasmBefore = await view("cpu");
    await agent.callTool({
      name: "apply_ops",
      arguments: {
        ops: [
          { op: "convert_to_frame", id: "conv-rect", adopt: ["conv-text"] },
          { op: "convert_to_frame", id: "conv-circle", adopt: ["conv-icon"] },
        ],
      },
    });
    const domAfter = await view("dom");
    const wasmAfter = await view("cpu");
    await agent.callTool({ name: "delete_nodes", arguments: { ids: ["conv-stage"] } });
    expect(await diffRatio(page, domBefore, domAfter, 8)).toBeLessThan(0.0005);
    expect(await diffRatio(page, wasmBefore, wasmAfter)).toBeLessThan(0.005);
    expect(await diffRatio(page, domAfter, wasmAfter)).toBeLessThan(0.005);
    expect(errors).toEqual([]);
  });

  it("render_screenshot renderer wasm captura o que a camada WASM pinta", async () => {
    await open("dom");
    // The board sits at a fractional offset in the new layout, so an element screenshot grows to 481 px: cut the 480 x 360 box at the rounded corner instead.
    const at = (await page.locator('[data-paprika-id="board"]').boundingBox())!;
    const dom = await page.screenshot({ clip: { x: Math.round(at.x), y: Math.round(at.y), width: 480, height: 360 }, style: HIDE_FLOATING });
    const r = (await agent.callTool({ name: "render_screenshot", arguments: { rootId: "board", renderer: "wasm" } })) as {
      isError?: boolean;
      content: { type: string; data?: string; text?: string }[];
    };
    expect(r.isError, JSON.stringify(r.content)).toBeFalsy();
    const png = Buffer.from(r.content.find((c) => c.type === "image")!.data!, "base64");
    if (shots) {
      const { writeFile } = await import("node:fs/promises");
      await writeFile(join(shots, "rs-dom.png"), dom);
      await writeFile(join(shots, "rs-mcp.png"), png);
    }
    expect(png.readUInt32BE(16)).toBe(480);
    expect(png.readUInt32BE(20)).toBe(360);
    expect(await diffRatio(page, dom, png)).toBeLessThan(0.01);
    const side = (await agent.callTool({ name: "render_screenshot", arguments: { rootId: "board", renderer: "wasm", scale: 2 } })) as typeof r;
    const big = Buffer.from(side.content.find((c) => c.type === "image")!.data!, "base64");
    expect(big.readUInt32BE(16)).toBe(960);
    const withMode = (await agent.callTool({ name: "render_screenshot", arguments: { rootId: "board", renderer: "wasm", mode: "dark" } })) as typeof r;
    expect(withMode.isError).toBe(true);
  }, 90_000);

  it("edição do agente via MCP aparece nos pixels do WASM", async () => {
    await open("cpu");
    const before = await shot();
    await agent.callTool({ name: "update_nodes", arguments: { updates: [{ id: "board", props: { fill: "#2a9d8f" } }] } });
    await expect
      .poll(() => page.locator('[data-paprika-id="board"]').evaluate((el) => getComputedStyle(el).backgroundColor))
      .toBe("rgba(0, 0, 0, 0)");
    await page.waitForTimeout(300);
    const box = (await page.locator('[data-paprika-id="board"]').boundingBox())!;
    const vp = (await page.getByTestId("viewport").boundingBox())!;
    const pixel = await page.evaluate(
      async ([png, x, y]) => {
        const img = new Image();
        img.src = `data:image/png;base64,${png}`;
        await img.decode();
        const c = document.createElement("canvas");
        c.width = img.width;
        c.height = img.height;
        const g = c.getContext("2d")!;
        g.drawImage(img, 0, 0);
        return Array.from(g.getImageData(x as number, y as number, 1, 1).data.slice(0, 3));
      },
      [(await shot()).toString("base64"), Math.round(box.x - vp.x + 6), Math.round(box.y - vp.y + box.height - 6)] as const,
    );
    expect(pixel).toEqual([0x2a, 0x9d, 0x8f]);
    expect(await diffRatio(page, before, await shot())).toBeGreaterThan(0.05);
  });

  it.each([
    ["camadas", "Redimensionar painel de camadas", 1],
    ["propriedades", "Redimensionar painel de propriedades", -1],
  ] as const)("redimensionar o painel de %s não pisca a camada WASM", async (_name, label, dir) => {
    await open("cpu");
    await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="wasm-layer"]')!;
      const ctx = canvas.getContext("2d")!;
      const frames: boolean[] = [];
      (window as unknown as { __frames: boolean[] }).__frames = frames;
      new ResizeObserver(() => {
        const px = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let painted = false;
        for (let i = 3; i < px.length; i += 4) if (px[i]) { painted = true; break; }
        frames.push(painted);
      }).observe(document.querySelector('[data-testid="viewport"]')!);
    });
    const handle = page.getByRole("separator", { name: label });
    const box = (await handle.boundingBox())!;
    // The collapse button of the panel sits over the middle of the separator: grab it near the top.
    const y = box.y + 20;
    const x = box.x + box.width / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    // Out and back: the panel gets wider and narrower while the layer must keep its pixels at every size.
    for (let i = 1; i <= 8; i++) {
      await page.mouse.move(x + i * 12 * dir, y);
      await page.evaluate(() => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok))));
    }
    for (let i = 7; i >= 0; i--) {
      await page.mouse.move(x + i * 12 * dir, y);
      await page.evaluate(() => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok))));
    }
    await page.mouse.up();
    for (let i = 0; i < 2; i++) {
      const at = (await handle.boundingBox())!;
      await page.mouse.dblclick(at.x + at.width / 2, y);
      await page.waitForTimeout(300);
    }
    const frames = await page.evaluate(() => (window as unknown as { __frames: boolean[] }).__frames);
    expect(frames.length).toBeGreaterThan(4);
    expect(frames.filter((p) => !p)).toEqual([]);
    expect(errors).toEqual([]);
  });

  it("duplo clique no separador recolhe o painel de camadas e outro devolve a largura que ele tinha", async () => {
    await open("cpu");
    const handle = page.getByRole("separator", { name: "Redimensionar painel de camadas" });
    const panel = page.locator('aside[aria-label="Painel de camadas"]');
    const width = () => panel.evaluate((el) => Math.round(el.getBoundingClientRect().width));
    const box = (await handle.boundingBox())!;
    const y = box.y + 20;
    const x = box.x + box.width / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 60, y, { steps: 6 });
    await page.mouse.up();
    const widened = await width();
    expect(widened).toBeGreaterThan(248);
    const after = (await handle.boundingBox())!;
    await page.mouse.dblclick(after.x + after.width / 2, y);
    await expect.poll(width).toBe(0);
    const collapsed = (await handle.boundingBox())!;
    await page.mouse.dblclick(collapsed.x + collapsed.width / 2, y);
    await expect.poll(width).toBe(widened);
  });

  it("o menu alterna o renderizador, cria o dispositivo uma vez só e a escolha fica salva", async () => {
    await open("dom");
    await page.evaluate(() => {
      const w = window as unknown as {
        __adapters: number;
        __devices: number;
        __labels: { label: string; busy: string | null }[];
      };
      w.__adapters = 0;
      w.__devices = 0;
      w.__labels = [];
      const gpu = navigator.gpu;
      if (gpu) {
        const origAdapter = gpu.requestAdapter.bind(gpu);
        gpu.requestAdapter = async (opts) => {
          w.__adapters += 1;
          const adapter = await origAdapter(opts);
          if (adapter) {
            const origDevice = adapter.requestDevice.bind(adapter);
            adapter.requestDevice = async (desc) => {
              w.__devices += 1;
              return origDevice(desc);
            };
          }
          return adapter;
        };
      }
      const btn = document.querySelector<HTMLElement>('button[aria-label^="Renderizador: "]')!;
      const snap = () => w.__labels.push({ label: btn.getAttribute("aria-label") ?? "", busy: btn.getAttribute("aria-busy") });
      snap();
      new MutationObserver(snap).observe(btn, { attributes: true, childList: true, subtree: true, characterData: true });
    });
    const trigger = rendererMenu(page);
    expect(await trigger.getAttribute("aria-label")).toBe("Renderizador: DOM");
    await chooseRenderer(page, "cpu");
    await expect.poll(() => layerAttr(page, "data-backend")).toMatch(/^(cpu|webgpu)$/);
    await expect.poll(() => trigger.getAttribute("aria-busy")).toBeNull();
    const state = () =>
      page.evaluate(() => {
        const w = window as unknown as { __adapters: number; __devices: number; __labels: { label: string; busy: string | null }[] };
        const layer = document.querySelector<HTMLElement>('[data-testid="wasm-layer"]')!;
        const btn = document.querySelector<HTMLElement>('button[aria-label^="Renderizador: "]')!;
        return { adapters: w.__adapters, devices: w.__devices, labels: w.__labels, creates: layer.dataset.creates ?? "", requested: layer.dataset.requested ?? "", label: btn.getAttribute("aria-label"), busy: btn.getAttribute("aria-busy") };
      });
    const cold = await state();
    expect(cold.creates).toBe("1");
    expect(cold.requested).toBe("cpu");
    expect(cold.label).toBe("Renderizador: WASM · CPU");
    expect(cold.busy).toBeNull();
    // While it boots the menu says so (and is busy); the label never claims the WASM before the layer paints.
    expect(cold.labels.some((l) => l.busy === "true" && l.label === "Renderizador: Trocando…")).toBe(true);
    expect(cold.labels.some((l) => l.label === "Renderizador: WASM · CPU" && l.busy === "true")).toBe(false);
    await chooseRenderer(page, "dom");
    await expect.poll(() => layerAttr(page, "data-requested")).toBe("dom");
    expect(await trigger.getAttribute("aria-label")).toBe("Renderizador: DOM");
    await expect.poll(() => page.locator(WORLD).getAttribute("data-wasm-active")).toBe("0");
    const warmMs = await timedChoose(page);
    const warm = await state();
    expect(warm.creates, `warm ${warmMs}ms adapters ${cold.adapters}->${warm.adapters}`).toBe("1");
    expect(warm.adapters).toBe(cold.adapters);
    expect(warm.devices).toBe(cold.devices);
    expect(warm.busy).toBeNull();
    expect(warmMs).toBeLessThan(100);
    // The choice is saved: opened without \`?renderer=\`, it comes back on the WASM.
    await page.goto(await canvasUrl());
    await expect.poll(() => layerAttr(page, "data-backend")).toMatch(/^(cpu|webgpu)$/);
    await chooseRenderer(page, "dom");
    await expect.poll(() => layerAttr(page, "data-requested")).toBe("dom");
    expect(await page.getByTestId("wasm-layer").getAttribute("aria-hidden")).toBe("true");
    expect(await layerAttr(page, "data-creates")).toBe("1");
    // And so is going back to the DOM.
    await page.goto(await canvasUrl());
    await page.waitForSelector('[data-paprika-id="board"]');
    expect(await rendererMenu(page).getAttribute("aria-label")).toBe("Renderizador: DOM");
  });

  it("o endereço antigo ?renderer=wasm vira CPU (ou GPU onde há WebGPU)", async () => {
    await page.goto(`${await canvasUrl()}?renderer=wasm`);
    await page.waitForSelector('[data-paprika-id="board"]');
    // With WebGPU in the browser the old value asks for the GPU; one that cannot start (no adapter here) falls back to the CPU on its own.
    await expect.poll(() => layerAttr(page, "data-backend")).toMatch(/^(cpu|webgpu)$/);
    expect(await layerAttr(page, "data-requested")).toBe((await layerAttr(page, "data-backend")) === "webgpu" ? "gpu" : "cpu");
  });

  it("trocar DOM e WASM não deixa quadro com a pintura desligada e o canvas vazio", async () => {
    await open("dom");
    await page.evaluate(() => {
      const world = document.querySelector<HTMLElement>('[data-testid="canvas-world"]');
      const board = document.querySelector<HTMLElement>('[data-paprika-id="board"]');
      if (!world || !board) throw new Error("missing world");
      const frames: { domOff: boolean; canvasEmpty: boolean }[] = [];
      const sample = () => {
        const domOff = world.dataset.wasmActive === "1";
        const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="wasm-layer"]');
        let canvasEmpty = true;
        if (domOff && canvas && canvas.width > 0 && canvas.height > 0) {
          const ctx = canvas.getContext("2d");
          if (!ctx) canvasEmpty = false;
          else {
            const br = board.getBoundingClientRect();
            const cr = canvas.getBoundingClientRect();
            const x0 = Math.max(br.left, cr.left);
            const y0 = Math.max(br.top, cr.top);
            const x1 = Math.min(br.right, cr.right);
            const y1 = Math.min(br.bottom, cr.bottom);
            if (x1 > x0 && y1 > y0 && cr.width > 0) {
              const dpr = canvas.width / cr.width;
              const x = Math.min(canvas.width - 1, Math.max(0, Math.round((x0 + 4 - cr.left) * dpr)));
              const y = Math.min(canvas.height - 1, Math.max(0, Math.round((y1 - 4 - cr.top) * dpr)));
              canvasEmpty = ctx.getImageData(x, y, 1, 1).data[3] === 0;
            }
          }
        }
        frames.push({ domOff, canvasEmpty });
      };
      let stop = false;
      const tick = () => {
        sample();
        if (!stop) requestAnimationFrame(tick);
      };
      const obs = new MutationObserver(sample);
      obs.observe(world, { attributes: true, attributeFilter: ["data-wasm-active"] });
      requestAnimationFrame(tick);
      (window as unknown as { __handoff: { stop(): typeof frames } }).__handoff = {
        stop: () => {
          stop = true;
          obs.disconnect();
          return frames;
        },
      };
    });
    for (let round = 0; round < 2; round++) {
      await chooseRenderer(page, "cpu");
      await expect.poll(() => layerAttr(page, "data-backend")).toMatch(/^(cpu|webgpu)$/);
      await expect.poll(() => page.locator(WORLD).getAttribute("data-wasm-active")).toBe("1");
      await page.evaluate(() => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok))));
      await chooseRenderer(page, "dom");
      await expect.poll(() => layerAttr(page, "data-requested")).toBe("dom");
      await page.evaluate(() => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok))));
    }
    const frames = await page.evaluate(() => (window as unknown as { __handoff: { stop(): { domOff: boolean; canvasEmpty: boolean }[] } }).__handoff.stop());
    expect(frames.length).toBeGreaterThan(4);
    expect(frames.some((f) => f.domOff && !f.canvasEmpty)).toBe(true);
    expect(frames.some((f) => !f.domOff)).toBe(true);
    expect(frames.filter((f) => f.domOff && f.canvasEmpty)).toEqual([]);
    expect(errors).toEqual([]);
  });

  it("erro de render devolve as formas ao DOM", async () => {
    await open("cpu");
    const board = page.locator('[data-paprika-id="board"]');
    const shape = page.locator('[data-paprika-id="1j39qe3gt7"] path');
    await expect.poll(() => board.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgba(0, 0, 0, 0)");
    expect(await shape.count()).toBe(0);
    await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="wasm-layer"]');
      const ctx = canvas?.getContext("2d");
      if (!ctx) throw new Error("cpu context missing");
      const orig = ctx.putImageData.bind(ctx);
      (window as unknown as { __origPut: typeof orig }).__origPut = orig;
      ctx.putImageData = (() => {
        throw new Error("injected render error");
      }) as typeof ctx.putImageData;
    });
    await page.getByRole("button", { name: "Aumentar zoom" }).click();
    await expect.poll(() => layerAttr(page, "data-backend")).toBe("error");
    expect(await board.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
    expect(await shape.count()).toBeGreaterThan(0);
    expect(await page.locator(WORLD).getAttribute("data-wasm-active")).toBe("0");
    await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="wasm-layer"]')!;
      const ctx = canvas.getContext("2d")!;
      ctx.putImageData = (window as unknown as { __origPut: typeof ctx.putImageData }).__origPut;
    });
    expect(errors).toEqual([]);
  });

  it("200 nós criados por um agente aparecem pintados no WASM em 1 s, e o passeio termina em cerca de 2 s", async () => {
    await open("cpu");
    const fills = ["#e11d48", "#2563eb", "#16a34a", "#d97706"];
    const kids = Array.from({ length: 199 }, (_, i) => ({ type: "rect", id: `wb-${i}`, width: 12, height: 12, fill: fills[i % 4] }));
    await agent.callTool({
      name: "create_nodes",
      arguments: { nodes: [{ type: "frame", id: "wb", name: "wb", x: 0, y: 400, width: 480, height: 140, fill: "#ffffff", layout: { mode: "row", wrap: true, gap: 2, padding: 6 }, children: kids }] },
    });
    const t0 = Date.now();
    const paintedRects = async () => {
      const png = await shot();
      return page.evaluate(
        async ([b64, rgb]) => {
          const img = new Image();
          img.src = `data:image/png;base64,${b64}`;
          await img.decode();
          const c = document.createElement("canvas");
          c.width = img.width;
          c.height = img.height;
          const g = c.getContext("2d")!;
          g.drawImage(img, 0, 0);
          const vp = document.querySelector<HTMLElement>('[data-testid="viewport"]')!.getBoundingClientRect();
          const want = rgb as unknown as number[][];
          let ok = 0;
          let missing = 0;
          for (let i = 0; i < 199; i++) {
            const el = document.querySelector<HTMLElement>(`[data-testid="canvas-world"] [data-paprika-id="wb-${i}"]`);
            if (!el) {
              missing++;
              continue;
            }
            const r = el.getBoundingClientRect();
            const [pr, pg, pb] = g.getImageData(Math.round(r.left - vp.left + r.width / 2), Math.round(r.top - vp.top + r.height / 2), 1, 1).data;
            const w = want[i % 4]!;
            if (Math.abs(pr! - w[0]!) < 6 && Math.abs(pg! - w[1]!) < 6 && Math.abs(pb! - w[2]!) < 6) ok++;
          }
          return { ok, missing };
        },
        [png.toString("base64"), [[225, 29, 72], [37, 99, 235], [22, 163, 74], [217, 119, 6]]] as const,
      );
    };
    await expect.poll(paintedRects, { interval: 20, timeout: 5000 }).toEqual({ ok: 199, missing: 0 });
    expect(Date.now() - t0).toBeLessThan(1000);
    await expect.poll(() => page.locator("[data-build]").count(), { interval: 50, timeout: 4000 }).toBe(0);
    expect(Date.now() - t0).toBeLessThan(2800);
    expect(await paintedRects()).toEqual({ ok: 199, missing: 0 });
    await agent.callTool({ name: "delete_nodes", arguments: { ids: ["wb"] } });
    expect(errors).toEqual([]);
  }, 60_000);
});

function useFixtureServer(example: string, opts: { consoleErrors?: boolean } = {}) {
  const ctx = { url: "", page: undefined as unknown as Page, errors: [] as string[] };
  let external: ExternalServer | undefined;
  let browser: Browser | undefined;
  beforeAll(async () => {
    external = await startServer({ seed: join(root, "packages/e2e/fixtures", example), webRoot });
    ctx.url = external.url;
    browser = await chromium.launch(process.env.PAPRIKA_CHROMIUM ? { executablePath: process.env.PAPRIKA_CHROMIUM } : {});
    ctx.page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await pinLocale(ctx.page, "pt-BR");
    ctx.page.on("pageerror", (e) => ctx.errors.push(e.message));
    if (opts.consoleErrors)
      ctx.page.on("console", (m) => {
        if (m.type() === "error" && !isTeamProbe(m)) ctx.errors.push(m.text());
      });
  }, 60_000);
  afterAll(async () => {
    await browser?.close();
    await external?.stop();
  });
  return ctx;
}

describe.skipIf(!wasmBuilt)("E2E: WASM respeita a ordem de pintura", () => {
  let dir: string;
  let external: ExternalServer | undefined;
  let url: string;
  let browser: Browser;
  let page: Page;
  const errors: string[] = [];
  const open = (renderer: Renderer) => openCanvas(page, url, renderer);
  const bg = (id: string) => page.locator(`[data-paprika-id="${id}"]`).evaluate((el) => getComputedStyle(el).backgroundColor);

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "paprika-wasm-layers-"));
    external = await startServer({ seed: join(root, "packages/e2e/fixtures/wasm-layers.paprika.json"), webRoot });
    url = external.url;
    browser = await chromium.launch(process.env.PAPRIKA_CHROMIUM ? { executablePath: process.env.PAPRIKA_CHROMIUM } : {});
    page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await pinLocale(page, "pt-BR");
    page.on("pageerror", (e) => errors.push(e.message));
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    await external?.stop();
    await rm(dir, { recursive: true, force: true });
  });

  it("os três casos de overlap ficam iguais ao DOM", async () => {
    await open("dom");
    const dom = await viewportShot(page);
    await open("cpu");
    const backend = await layerAttr(page, "data-backend");
    expect(["cpu", "webgpu"]).toContain(backend);
    expect(await bg("board")).toBe("rgba(0, 0, 0, 0)");
    expect(await bg("back")).toBe("rgba(0, 0, 0, 0)");
    expect(await bg("card")).toBe("rgba(0, 0, 0, 0)");
    for (const id of ["dash", "front", "nest", "child", "cover"]) expect(await bg(id)).not.toBe("rgba(0, 0, 0, 0)");
    const wasm = await viewportShot(page);
    expect(await diffRatio(page, dom, wasm)).toBeLessThan(0.005);
    expect(errors).toEqual([]);
  });
});

describe.skipIf(!wasmBuilt)("E2E: WASM desenha formas escuras sobre o fundo do quadro (PAP-A-012)", () => {
  const fx = useFixtureServer("wasm-gpu-blank.paprika.json");

  async function darkPixels(png: Buffer): Promise<number> {
    return fx.page.evaluate(async (b64) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext("2d")!;
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i]! < 40 && d[i + 1]! < 40 && d[i + 2]! < 40) n++;
      return n;
    }, png.toString("base64"));
  }

  it.each([0, 1, 2])("o logo escuro continua visível no WASM depois de %i aumentos de zoom", async (zoomIns) => {
    const open = async (renderer: Renderer) => {
      await openCanvas(fx.page, fx.url, renderer);
      for (let i = 0; i < zoomIns; i++) await fx.page.getByRole("button", { name: "Aumentar zoom" }).click();
      await fx.page.waitForTimeout(300);
      return viewportShot(fx.page);
    };
    const dom = await open("dom");
    const domDark = await darkPixels(dom);
    expect(domDark).toBeGreaterThan(1000);
    const wasm = await open("cpu");
    expect(["cpu", "webgpu"]).toContain(await layerAttr(fx.page, "data-backend"));
    expect(await fx.page.locator('[data-paprika-id="board"]').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgba(0, 0, 0, 0)");
    expect(await fx.page.locator('[data-paprika-id="hull"] path').count()).toBe(0);
    expect(Math.abs((await darkPixels(wasm)) - domDark) / domDark).toBeLessThan(0.1);
    expect(await diffRatio(fx.page, dom, wasm)).toBeLessThan(0.005);
    expect(fx.errors).toEqual([]);
  });
});

describe.skipIf(!wasmBuilt)("E2E: WASM estabiliza um path de caixa fracionária (PAP-A-035)", () => {
  const fx = useFixtureServer("wasm-fractional-path.paprika.json", { consoleErrors: true });

  it("abre sem estourar a profundidade de atualização e mantém o path no WASM", async () => {
    await openCanvas(fx.page, fx.url, "cpu");
    expect(["cpu", "webgpu"]).toContain(await layerAttr(fx.page, "data-backend"));
    expect(await fx.page.getByText("O canvas parou").count()).toBe(0);
    await fx.page.waitForTimeout(500);
    // The same answer after settling: no flip-flop between the layers.
    expect(await fx.page.locator('[data-paprika-id="ink"]').evaluate((el) => el.tagName.toLowerCase())).toBe("div");
    expect(fx.errors.filter((e) => !/WebSocket|adapters/i.test(e))).toEqual([]);
  });
});

describe.skipIf(!wasmBuilt)("E2E: traço de path em unidades do viewBox fica igual ao DOM", () => {
  const fx = useFixtureServer("wasm-path-stroke.paprika.json", { consoleErrors: true });

  it("paths com caixa diferente do viewBox, traço fino e grosso, ficam iguais nos dois renderizadores", async () => {
    await openCanvas(fx.page, fx.url, "dom");
    const dom = await viewportShot(fx.page);
    await openCanvas(fx.page, fx.url, "cpu");
    expect(["cpu", "webgpu"]).toContain(await layerAttr(fx.page, "data-backend"));
    for (const id of ["small", "wordmark", "large", "thin", "wide", "origin"])
      expect(await fx.page.locator(`[data-paprika-id="${id}"] path`).count(), id).toBe(0);
    const wasm = await viewportShot(fx.page);
    expect(await diffRatio(fx.page, dom, wasm, 60)).toBeLessThan(0.005);
    expect(fx.errors.filter((e) => !/WebSocket|adapters/i.test(e))).toEqual([]);
  });
});

describe.skipIf(!wasmBuilt)("E2E: caixas do WASM são exatas com bordas e auto-layout fracionário (PAP-A-065)", () => {
  const fx = useFixtureServer("wasm-nested-borders.paprika.json", { consoleErrors: true });

  interface Geometry {
    checked: number;
    worst: number;
    worstId: string;
    ids: string[];
    exact: Record<string, { x: number; y: number; w: number; h: number }>;
    boxes: Record<string, { x: number; y: number; w: number; h: number }>;
  }

  async function geometry(): Promise<Geometry> {
    return fx.page.evaluate(() => {
      const world = document.querySelector<HTMLElement>('[data-testid="canvas-world"]')!;
      const boxes = (world as unknown as { __paprikaBoxes: Map<string, { x: number; y: number; w: number; h: number }> }).__paprikaBoxes;
      const wr = world.getBoundingClientRect();
      const zoom = Number(world.style.transform.match(/scale\(([^)]+)\)/)![1]);
      const turned = (el: Element | null): boolean => {
        for (; el && el !== world; el = el.parentElement) {
          const t = (el as HTMLElement).style.transform;
          if (t && t !== "none") return true;
        }
        return false;
      };
      let worst = 0;
      let worstId = "";
      let checked = 0;
      const exact: Geometry["exact"] = {};
      for (const [id, b] of boxes) {
        const el = world.querySelector<HTMLElement>(`[data-paprika-id="${id}"]`)!;
        if (turned(el) || el.dataset.paprikaType === "path") continue;
        const r = el.getBoundingClientRect();
        const e = { x: (r.left - wr.left) / zoom, y: (r.top - wr.top) / zoom, w: r.width / zoom, h: r.height / zoom };
        exact[id] = e;
        const err = Math.max(Math.abs(b.x - e.x), Math.abs(b.y - e.y), Math.abs(b.w - e.w), Math.abs(b.h - e.h));
        checked++;
        if (err > worst) {
          worst = err;
          worstId = id;
        }
      }
      return { checked, worst, worstId, ids: [...boxes.keys()], exact, boxes: Object.fromEntries(boxes) };
    });
  }

  it("a caixa entregue ao displayList bate com o layout do DOM a 0,1 px, em zoom 1 e ampliado", async () => {
    await openCanvas(fx.page, fx.url, "cpu");
    expect(["cpu", "webgpu"]).toContain(await layerAttr(fx.page, "data-backend"));
    for (let zoomIns = 0; zoomIns < 3; zoomIns++) {
      if (zoomIns) {
        await fx.page.getByRole("button", { name: "Aumentar zoom" }).click();
        await chooseRenderer(fx.page, "dom");
        await expect.poll(() => layerAttr(fx.page, "data-requested")).toBe("dom");
        await chooseRenderer(fx.page, "cpu");
        await expect.poll(() => layerAttr(fx.page, "data-backend")).toMatch(/^(cpu|webgpu)$/);
        await expect.poll(() => fx.page.locator(WORLD).getAttribute("data-wasm-active")).toBe("1");
        await fx.page.waitForTimeout(200);
      }
      const g = await geometry();
      expect(g.checked).toBeGreaterThan(15);
      expect(g.worst, `${g.worstId} zoom step ${zoomIns}`).toBeLessThan(0.1);
    }
    expect(fx.errors.filter((e) => !/WebSocket|adapters/i.test(e))).toEqual([]);
  });

  it("os valores batem com a conta feita à mão: borda de 1+2+3 px e preenchimento de 7,5 px acumulam", async () => {
    await openCanvas(fx.page, fx.url, "cpu");
    const g = await geometry();
    expect(g.boxes.board!.x).toBeCloseTo(0, 1);
    expect(g.boxes.l1!.x).toBeCloseTo(3 + 11.5, 1);
    expect(g.boxes.l2!.x).toBeCloseTo(3 + 11.5 + 1 + 7.5, 1);
    expect(g.boxes.l3!.x).toBeCloseTo(3 + 11.5 + 1 + 7.5 + 2 + 7.5, 1);
    expect(g.boxes.label!.x).toBeCloseTo(3 + 11.5 + 1 + 7.5 + 2 + 7.5 + 3 + 7.5, 1);
    expect(g.boxes.board!.y + 3 + 11.5).toBeCloseTo(g.boxes.l1!.y, 1);
    expect(g.boxes.spinFrame!.w).toBeCloseTo(60.3, 1);
    expect(g.boxes.square!.w).toBeCloseTo(40.5, 1);
  });

  it("DOM e WASM ficam iguais pixel a pixel e o rótulo do botão fica centrado", async () => {
    await openCanvas(fx.page, fx.url, "dom");
    const dom = await viewportShot(fx.page);
    await openCanvas(fx.page, fx.url, "cpu");
    for (const id of ["l1", "l2", "l3", "button", "circle", "clipper", "square"]) expect((await geometry()).ids, id).toContain(id);
    const wasm = await viewportShot(fx.page);
    const shotDir = process.env.PAPRIKA_E2E_SHOTS;
    if (shotDir) {
      const { writeFile } = await import("node:fs/promises");
      await writeFile(join(shotDir, "nested-dom.png"), dom);
      await writeFile(join(shotDir, "nested-wasm.png"), wasm);
    }
    expect(await diffRatio(fx.page, dom, wasm, 40, 1)).toBeLessThan(0.005);
    const off = await fx.page.evaluate(() => {
      const world = document.querySelector<HTMLElement>('[data-testid="canvas-world"]')!;
      const boxes = (world as unknown as { __paprikaBoxes: Map<string, { x: number; y: number; w: number; h: number }> }).__paprikaBoxes;
      const wr = world.getBoundingClientRect();
      const lbl = document.querySelector<HTMLElement>('[data-paprika-id="buttonLabel"]')!.getBoundingClientRect();
      const b = boxes.get("button")!;
      // The camera opens fitted, not at 1:1: the screen distance goes back to world units, as `geometry()` does.
      const zoom = Number(world.style.transform.match(/scale\(([^)]+)\)/)![1]);
      return { dx: (lbl.left - wr.left + lbl.width / 2) / zoom - (b.x + b.w / 2), dy: (lbl.top - wr.top + lbl.height / 2) / zoom - (b.y + b.h / 2) };
    });
    expect(Math.abs(off.dx)).toBeLessThan(0.1);
    expect(Math.abs(off.dy)).toBeLessThan(0.1);
    expect(fx.errors.filter((e) => !/WebSocket|adapters/i.test(e))).toEqual([]);
  });
});

function synthetic(rows: number): string {
  const nodes: Record<string, Record<string, unknown>> = {};
  const base = { rotation: 0, opacity: 1, visible: true, locked: false, radius: 0, x: 0, y: 0 };
  const put = (id: string, parentId: string | null, o: Record<string, unknown>) => {
    nodes[id] = { id, name: id, parentId, ...base, ...o };
    if (parentId) (nodes[parentId]!.children as string[]).push(id);
  };
  const stroke = (w: number) => ({ color: "#5a6a9a", width: w, style: "solid", position: "inside" });
  const lay = (mode: string, gap: number, padding: number) => ({ mode, gap, padding, align: "center", justify: "start", wrap: false });
  put("board", null, { type: "frame", width: 800, height: "hug", fill: "#101826", clip: false, children: [], layout: lay("column", 3.3, 7.5), stroke: stroke(2) });
  for (let i = 0; i < rows; i++) {
    put(`r${i}`, "board", { type: "frame", width: "fill", height: "hug", fill: "#1c2740", clip: false, children: [], layout: lay("row", 3.3, 7.5), stroke: stroke(1 + (i % 3)) });
    put(`b${i}`, `r${i}`, { type: "frame", width: "hug", height: "hug", fill: "#e63946", radius: 6, clip: false, children: [], layout: lay("row", 0, 5.5) });
    put(`t${i}`, `b${i}`, { type: "text", text: `Row ${i}`, color: "#fff", fontFamily: "Inter, system-ui, sans-serif", fontSize: 13.7, fontWeight: 600, lineHeight: 1.3, letterSpacing: 0, textAlign: "left", width: "hug", height: "hug" });
    put(`c${i}`, `r${i}`, { type: "ellipse", width: 20.5, height: 20.5, fill: "#2a9d8f" });
    put(`s${i}`, `r${i}`, { type: "rect", width: 30.3, height: 20.5, fill: "#e9c46a", radius: 3 });
  }
  return JSON.stringify({ format: "paprika/1", id: "wasm-measure-perf", name: "measure perf", tokens: {}, rootIds: ["board"], nodes });
}

describe.skipIf(!wasmBuilt)("E2E: measureBoxes escala linear e não força layout (perf)", () => {
  let dir: string;
  const servers: ExternalServer[] = [];
  let browser: Browser;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "paprika-wasm-perf-"));
    browser = await chromium.launch(process.env.PAPRIKA_CHROMIUM ? { executablePath: process.env.PAPRIKA_CHROMIUM } : {});
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    for (const s of servers) await s.stop();
    await rm(dir, { recursive: true, force: true });
  });

  async function measure(rows: number) {
    const { writeFile } = await import("node:fs/promises");
    const file = join(dir, `perf-${rows}.paprika.json`);
    await writeFile(file, synthetic(rows));
    const server = await startServer({ seed: file, webRoot });
    servers.push(server);
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Performance.enable");
    await openCanvas(page, server.url, "cpu");
    await page.waitForFunction(() => !!(document.querySelector('[data-testid="canvas-world"]') as unknown as { __paprikaMeasure?: unknown })?.__paprikaMeasure, undefined, { timeout: 60_000 });
    await page.waitForTimeout(800);
    const layouts = async () => ((await cdp.send("Performance.getMetrics")).metrics.find((m) => m.name === "LayoutCount")?.value ?? 0);
    const before = await layouts();
    const r = await page.evaluate(() => {
      const world = document.querySelector<HTMLElement>('[data-testid="canvas-world"]')! as unknown as { __paprikaMeasure: () => Map<string, unknown> };
      const times: number[] = [];
      let size = 0;
      for (let i = 0; i < 7; i++) {
        const t = performance.now();
        size = world.__paprikaMeasure().size;
        times.push(performance.now() - t);
      }
      return { size, ms: Math.min(...times) };
    });
    const after = await layouts();
    await page.close();
    return { ...r, layouts: after - before };
  }

  it("custo por nó não cresce com o documento e leituras seguidas não geram layout", async () => {
    const small = await measure(20);
    const big = await measure(700);
    expect(big.size).toBeGreaterThan(3400);
    console.log(`measureBoxes: ${small.size} nodes ${small.ms.toFixed(2)} ms, ${big.size} nodes ${big.ms.toFixed(2)} ms`);
    expect(small.layouts).toBeLessThanOrEqual(1);
    expect(big.layouts).toBeLessThanOrEqual(1);
    const perSmall = small.ms / small.size;
    const perBig = big.ms / big.size;
    expect(perBig).toBeLessThan(perSmall * 4 + 0.005);
  }, 120_000);
});
