import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startServer, type ExternalServer } from "../harness.js";
import { pinLocale } from "./locale.js";

const root = resolve(import.meta.dirname, "../../../..");
const webRoot = join(root, "apps/web/dist");
// The WASM renderer is built by crates/render/build.mjs during `pnpm build` when Rust is installed.
const wasmBuilt = existsSync(join(root, "apps/web/src/wasm/paprika_render.js")) && existsSync(webRoot);
const shots = process.env.PAPRIKA_E2E_SHOTS;

async function workspaceCanvasUrl(base: string): Promise<string> {
  const active = ((await (await fetch(`${base}/api/workspaces`)).json()) as { active: string }).active;
  return `${base}/w/${encodeURIComponent(active)}`;
}

async function toggleUntilReady(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const sel = '[data-testid="renderer-toggle"]';
    const btn = document.querySelector<HTMLElement>(sel)!;
    const t0 = performance.now();
    btn.click();
    await new Promise<void>((ok) => {
      const tick = () => {
        const backend = document.querySelector<HTMLElement>(sel)?.dataset.backend;
        if (backend === "cpu" || backend === "webgpu") ok();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    return Math.round(performance.now() - t0);
  });
}

async function openCanvas(page: Page, base: string, renderer: "dom" | "wasm") {
  await page.goto(`${await workspaceCanvasUrl(base)}?renderer=${renderer}`);
  await page.waitForSelector('[data-paprika-id="board"]');
  if (renderer === "wasm") {
    await page.waitForFunction(() => {
      const b = document.querySelector<HTMLElement>('[data-testid="renderer-toggle"]')?.dataset.backend;
      return b === "cpu" || b === "webgpu" || b === "error" || b === "unavailable";
    });
  }
  await page.waitForTimeout(300);
}

/** Fraction of pixels whose channels differ by more than `tol` (decoded in the page). */
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

describe.skipIf(!wasmBuilt)("E2E: canvas com renderizador WASM", () => {
  let dir: string;
  let external: ExternalServer | undefined;
  let url: string;
  let browser: Browser;
  let page: Page;
  let agent: Client;
  const errors: string[] = [];

  const canvasUrl = () => workspaceCanvasUrl(url);
  const open = (renderer: "dom" | "wasm") => openCanvas(page, url, renderer);
  const shot = () => page.getByTestId("viewport").screenshot();

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "paprika-wasm-e2e-"));
    const file = join(dir, "bezier.paprika.json");
    await copyFile(join(root, "examples/bezier.paprika.json"), file);
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
    // WebAssembly.instantiateStreaming only accepts application/wasm.
    expect(res.headers.get("content-type")).toBe("application/wasm");
  });

  it("desenha as formas no WASM (CPU sem GPU) e fica igual ao DOM", async () => {
    await open("dom");
    const dom = await shot();
    await open("wasm");
    const backend = await page.getByTestId("renderer-toggle").getAttribute("data-backend");
    // Headless Chromium has no hardware adapter: the renderer must fall back to vello_cpu.
    expect(["cpu", "webgpu"]).toContain(backend);
    expect(await page.getByTestId("wasm-layer").count()).toBe(1);
    // The DOM keeps the board's box but no longer paints it.
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

  it("edição do agente via MCP aparece nos pixels do WASM", async () => {
    await open("wasm");
    const before = await shot();
    await agent.callTool({ name: "update_nodes", arguments: { updates: [{ id: "board", props: { fill: "#2a9d8f" } }] } });
    // The DOM layer stays transparent in WASM mode. Read the computed color: the serialized `style`
    // differs between Chromium versions (`background: transparent` became `background: none`).
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
    ["camadas", "Largura do painel de camadas", 1],
    ["propriedades", "Largura do painel de propriedades", -1],
  ] as const)("redimensionar o painel de %s não pisca a camada WASM", async (_name, label, dir) => {
    await open("wasm");
    // A ResizeObserver created after the canvas's runs right after it, still before the frame is
    // painted: if the layer is blank here, that frame reaches the screen without the shapes.
    await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="wasm-layer"]')!;
      const ctx = canvas.getContext("2d")!; // CPU backend: the same 2d context the renderer uses
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
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width / 2, y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) {
      await page.mouse.move(box.x + box.width / 2 + i * 12 * dir, y);
      await page.evaluate(() => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok))));
    }
    await page.mouse.up();
    await page.getByRole("separator", { name: label }).dblclick(); // back to the default width
    const frames = await page.evaluate(() => (window as unknown as { __frames: boolean[] }).__frames);
    expect(frames.length).toBeGreaterThan(4); // the first call is the observe() itself
    expect(frames.filter((p) => !p)).toEqual([]);
    expect(errors).toEqual([]);
  });

  it("o botão alterna o renderizador e a escolha fica salva", async () => {
    await open("dom");
    await page.evaluate(() => {
      const w = window as unknown as {
        __adapters: number;
        __devices: number;
        __labels: { text: string; busy: string | null }[];
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
      const btn = document.querySelector<HTMLElement>('[data-testid="renderer-toggle"]')!;
      const snap = () => w.__labels.push({ text: (btn.textContent ?? "").trim(), busy: btn.getAttribute("aria-busy") });
      snap();
      new MutationObserver(snap).observe(btn, { attributes: true, childList: true, subtree: true, characterData: true });
    });
    const toggle = page.getByTestId("renderer-toggle");
    const coldMs = await toggleUntilReady(page);
    await expect.poll(() => toggle.getAttribute("data-backend")).toMatch(/^(cpu|webgpu)$/);
    const cold = await page.evaluate(() => {
      const w = window as unknown as {
        __adapters: number;
        __devices: number;
        __labels: { text: string; busy: string | null }[];
      };
      const btn = document.querySelector<HTMLElement>('[data-testid="renderer-toggle"]')!;
      return {
        adapters: w.__adapters,
        devices: w.__devices,
        labels: w.__labels,
        creates: btn.dataset.creates ?? "",
        text: (btn.textContent ?? "").trim(),
        busy: btn.getAttribute("aria-busy"),
      };
    });
    expect(cold.creates).toBe("1");
    expect(cold.text).toMatch(/^(CPU|GPU)$/);
    expect(cold.busy).toBeNull();
    expect(cold.labels.some((s) => s.text === "WASM")).toBe(false);
    expect(cold.labels.some((s) => s.busy === "true" && s.text === "DOM")).toBe(true);
    await toggle.click();
    await expect.poll(() => toggle.getAttribute("data-backend")).toBe("dom");
    expect((await toggle.textContent())?.trim()).toBe("DOM");
    const warmMs = await toggleUntilReady(page);
    const warm = await page.evaluate(() => {
      const w = window as unknown as { __adapters: number; __devices: number };
      const btn = document.querySelector<HTMLElement>('[data-testid="renderer-toggle"]')!;
      return { adapters: w.__adapters, devices: w.__devices, creates: btn.dataset.creates ?? "", busy: btn.getAttribute("aria-busy") };
    });
    expect(warm.creates, `cold ${coldMs}ms warm ${warmMs}ms adapters ${cold.adapters}->${warm.adapters}`).toBe("1");
    expect(warm.adapters).toBe(cold.adapters);
    expect(warm.devices).toBe(cold.devices);
    expect(warm.busy).toBeNull();
    expect(warmMs).toBeLessThan(100);
    await page.goto(await canvasUrl());
    await expect.poll(() => toggle.getAttribute("data-backend")).toMatch(/^(cpu|webgpu)$/);
    await toggle.click();
    await expect.poll(() => toggle.getAttribute("data-backend")).toBe("dom");
    expect(await page.getByTestId("wasm-layer").getAttribute("aria-hidden")).toBe("true");
    expect(await toggle.getAttribute("data-creates")).toBe("1");
  });

  it("trocar DOM e WASM não deixa quadro com a pintura desligada e o canvas vazio", async () => {
    await open("dom");
    await page.evaluate(() => {
      const world = document.querySelector<HTMLElement>(".world");
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
      await page.getByTestId("renderer-toggle").click();
      await expect.poll(() => page.getByTestId("renderer-toggle").getAttribute("data-backend")).toMatch(/^(cpu|webgpu)$/);
      await page.evaluate(() => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok))));
      await page.getByTestId("renderer-toggle").click();
      await expect.poll(() => page.getByTestId("renderer-toggle").getAttribute("data-backend")).toBe("dom");
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
    await open("wasm");
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
    await expect.poll(() => page.getByTestId("renderer-toggle").getAttribute("data-backend")).toBe("error");
    expect(await board.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
    expect(await shape.count()).toBeGreaterThan(0);
    expect(await page.locator(".world").getAttribute("data-wasm-active")).toBe("0");
    await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="wasm-layer"]')!;
      const ctx = canvas.getContext("2d")!;
      ctx.putImageData = (window as unknown as { __origPut: typeof ctx.putImageData }).__origPut;
    });
    expect(errors).toEqual([]);
  });
});

describe.skipIf(!wasmBuilt)("E2E: WASM respeita a ordem de pintura", () => {
  let dir: string;
  let external: ExternalServer | undefined;
  let url: string;
  let browser: Browser;
  let page: Page;
  const errors: string[] = [];
  const open = (renderer: "dom" | "wasm") => openCanvas(page, url, renderer);
  const bg = (id: string) => page.locator(`[data-paprika-id="${id}"]`).evaluate((el) => getComputedStyle(el).backgroundColor);

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "paprika-wasm-layers-"));
    external = await startServer({ seed: join(root, "examples/wasm-layers.paprika.json"), webRoot });
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
    const dom = await page.getByTestId("viewport").screenshot();
    await open("wasm");
    const backend = await page.getByTestId("renderer-toggle").getAttribute("data-backend");
    expect(["cpu", "webgpu"]).toContain(backend);
    expect(await bg("board")).toBe("rgba(0, 0, 0, 0)");
    expect(await bg("back")).toBe("rgba(0, 0, 0, 0)");
    expect(await bg("card")).toBe("rgba(0, 0, 0, 0)");
    for (const id of ["dash", "front", "nest", "child", "cover"]) expect(await bg(id)).not.toBe("rgba(0, 0, 0, 0)");
    const wasm = await page.getByTestId("viewport").screenshot();
    expect(await diffRatio(page, dom, wasm)).toBeLessThan(0.005);
    expect(errors).toEqual([]);
  });
});
