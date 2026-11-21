import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { DocumentStore, closeBrowser, startHttpServer, type RunningServer } from "../../src/index.js";
import { goBin, impl, startServer, type ExternalServer } from "../external/harness.js";

const root = resolve(import.meta.dirname, "../../../..");
const webRoot = join(root, "apps/web/dist");
// The WASM renderer is built by crates/render/build.mjs during `pnpm build` when Rust is installed.
const wasmBuilt = existsSync(join(root, "apps/web/src/wasm/paprika_render.js")) && existsSync(webRoot);
const shots = process.env.PAPRIKA_E2E_SHOTS;

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

describe.skipIf(!wasmBuilt)(`E2E (${impl}): canvas com renderizador WASM`, () => {
  let dir: string;
  let store: DocumentStore | undefined;
  let http: RunningServer | undefined;
  let external: ExternalServer | undefined;
  let url: string;
  let browser: Browser;
  let page: Page;
  let agent: Client;
  const errors: string[] = [];

  const open = async (renderer: "dom" | "wasm") => {
    await page.goto(`${url}/?renderer=${renderer}`);
    await page.waitForSelector('[data-paprika-id="board"]');
    if (renderer === "wasm") {
      await page.waitForFunction(() => {
        const b = document.querySelector<HTMLElement>('[data-testid="renderer-toggle"]')?.dataset.backend;
        return b === "cpu" || b === "webgpu" || b === "error" || b === "unavailable";
      });
    }
    await page.waitForTimeout(300); // one animation frame for the WASM draw
  };
  const shot = () => page.getByTestId("viewport").screenshot();

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "paprika-wasm-e2e-"));
    const file = join(dir, "bezier.paprika.json");
    await copyFile(join(root, "examples/bezier.paprika.json"), file);
    if (goBin) {
      external = await startServer({ seed: file, webRoot });
      url = external.url;
    } else {
      store = await DocumentStore.open(file);
      http = await startHttpServer(store, { host: "127.0.0.1", port: 0, webRoot });
      url = http.url;
    }
    browser = await chromium.launch(process.env.PAPRIKA_CHROMIUM ? { executablePath: process.env.PAPRIKA_CHROMIUM } : {});
    page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on("pageerror", (e) => errors.push(e.message));
    agent = new Client({ name: "e2e-wasm", version: "0" });
    await agent.connect(new StreamableHTTPClientTransport(new URL(`${url}/mcp`)));
  }, 60_000);

  afterAll(async () => {
    await agent?.close();
    await browser?.close();
    await http?.close();
    await closeBrowser();
    await store?.close();
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
    await expect.poll(() => page.locator('[data-paprika-id="board"]').getAttribute("style")).toContain("transparent");
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

  it("o botão alterna o renderizador e a escolha fica salva", async () => {
    await open("dom");
    await page.getByTestId("renderer-toggle").click();
    await expect.poll(() => page.getByTestId("renderer-toggle").getAttribute("data-backend")).toMatch(/^(cpu|webgpu)$/);
    await page.goto(url); // no ?renderer: the saved choice applies
    await page.waitForSelector('[data-testid="wasm-layer"]');
    await page.getByTestId("renderer-toggle").click();
    await expect.poll(() => page.getByTestId("renderer-toggle").getAttribute("data-backend")).toBe("dom");
    expect(await page.getByTestId("wasm-layer").count()).toBe(0);
  });
});
