import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startServer, type ExternalServer } from "../harness.js";

const root = resolve(import.meta.dirname, "../../../..");
const webRoot = join(root, "apps/web/dist");

/** Keyboard and ARIA checks of the editor (WCAG 2.1: 2.1.1 keyboard, 2.4.3 focus order, 4.1.2 name/role/value). */
describe.skipIf(!existsSync(webRoot))("E2E: acessibilidade do editor pelo teclado", () => {
  let dir: string;
  let external: ExternalServer | undefined;
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "paprika-a11y-"));
    const file = join(dir, "demo.paprika.json");
    await copyFile(join(root, "examples/demo.paprika.json"), file);
    external = await startServer({ seed: file, webRoot });
    browser = await chromium.launch(process.env.PAPRIKA_CHROMIUM ? { executablePath: process.env.PAPRIKA_CHROMIUM } : {});
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(external.url);
    await page.locator(".workspace-card.is-active").click();
    await page.waitForSelector('[data-paprika-id="login"]');
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    await external?.stop();
    await rm(dir, { recursive: true, force: true });
  });

  /** Presses Tab until `match` has focus (at most `max` times). */
  const tabTo = async (match: (el: Element) => boolean, max = 80) => {
    for (let i = 0; i < max; i++) {
      await page.keyboard.press("Tab");
      const hit = await page.evaluate((src) => new Function("el", `return (${src})(el)`)(document.activeElement), match.toString());
      if (hit) return;
    }
    throw new Error("element not reached with Tab");
  };

  it("Enter e Espaço ativam um botão focado pelo teclado (o pan do canvas não os engole)", async () => {
    await page.locator("body").focus();
    await tabTo((el) => el.getAttribute("aria-label") === "Retângulo");
    await page.keyboard.press("Enter");
    await expect.poll(() => page.getByRole("button", { name: "Retângulo" }).getAttribute("aria-pressed")).toBe("true");
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press(" ");
    await expect.poll(() => page.getByRole("button", { name: "Frame" }).getAttribute("aria-pressed")).toBe("true");
    await page.keyboard.press("Escape");
  });

  it("o botão de ocultar camada fica visível quando a linha tem o foco", async () => {
    const row = page.locator('[data-layer-id="login"]');
    await row.focus();
    await page.keyboard.press("Tab"); // expand/collapse
    await page.keyboard.press("Tab"); // hide
    const eye = row.getByRole("button", { name: /^Ocultar / });
    await expect.poll(() => eye.evaluate((el) => el === document.activeElement)).toBe(true);
    await expect.poll(() => eye.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
    // The row is named by the layer name alone, not by its buttons' labels.
    await expect(page.getByRole("treeitem", { name: "Login · mobile", exact: true }).count()).resolves.toBe(1);
  });

  it("F2 renomeia a camada focada", async () => {
    const row = page.locator('[data-layer-id="login"]');
    await row.focus();
    await page.keyboard.press("F2");
    const field = page.getByRole("textbox", { name: "Nome da camada" });
    await expect.poll(() => field.count()).toBe(1);
    await page.keyboard.press("Escape");
    await expect.poll(() => field.count()).toBe(0);
  });

  it("páginas abrem pelo teclado e a ativa é anunciada", async () => {
    await page.getByTestId("add-page").click();
    await expect.poll(() => page.locator(".page").count()).toBe(2);
    const first = page.locator(".page").first().getByRole("button").first();
    await first.focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => page.locator(".page.is-active").first().evaluate((el) => el === document.querySelector(".page"))).toBe(true);
    await expect(first.getAttribute("aria-current")).resolves.toBe("page");
    // The delete button is reachable (it was `invisible`, which also took it out of the Tab order).
    await page.keyboard.press("Tab");
    const del = await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? "");
    expect(del).toMatch(/^Apagar página /);
    await expect(page.evaluate(() => getComputedStyle(document.activeElement!).opacity)).resolves.toBe("1");
    await page.keyboard.press("Control+z");
  });

  it("asides têm nomes e a página tem um h1 com o nome do workspace", async () => {
    await expect(page.getByRole("complementary", { name: "Páginas e camadas" }).count()).resolves.toBe(1);
    await expect(page.getByRole("complementary", { name: "Propriedades" }).count()).resolves.toBe(1);
    await expect(page.getByRole("heading", { level: 1 }).textContent()).resolves.toBe(await page.locator(".doc-name").textContent());
    await expect(page.getByRole("status").textContent()).resolves.toBe("Conectado ao servidor");
  });

  it("texto sobre o acento e sobre as cores de agente passa de 4,5:1 (1.4.3)", async () => {
    // Several agents, so the check covers more than the first color.
    const agents: Client[] = [];
    for (let i = 0; i < 8; i++) {
      const c = new Client({ name: `a11y-agent-${i}`, version: "0" });
      await c.connect(new StreamableHTTPClientTransport(new URL(`${external!.url}/mcp`)));
      await c.callTool({ name: "get_nodes", arguments: { ids: ["login"] } });
      agents.push(c);
    }
    await expect.poll(() => page.locator(".agent-cursor").count(), { timeout: 10_000 }).toBe(8);
    const ratios = await page.evaluate(() => {
      const rgb = (s: string) => (s.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number);
      const lum = (c: number[]) => {
        const [r, g, b] = c.map((v) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4));
        return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
      };
      const ratio = (el: Element) => {
        const cs = getComputedStyle(el);
        const [a, b] = [lum(rgb(cs.color)), lum(rgb(cs.backgroundColor))].sort((x, y) => y - x);
        return (a! + 0.05) / (b! + 0.05);
      };
      const tags = [...document.querySelectorAll(".agent-cursor span")].filter((el) => el.parentElement?.classList.contains("agent-cursor"));
      return { tags: tags.map(ratio), tool: ratio(document.querySelector("nav[aria-label=Ferramentas] .is-active")!) };
    });
    for (const c of agents) await c.close();
    expect(ratios.tags).toHaveLength(8);
    for (const r of ratios.tags) expect(r).toBeGreaterThanOrEqual(4.5);
    expect(ratios.tool).toBeGreaterThanOrEqual(4.5);
  });

  /**
   * The shadcn primitives of PAP-B-030, checked on the internal gallery (`/ui`): keyboard behavior, name
   * and role, contrast in both theme scopes, and the isolation rule of ADR 0003 — the app's base rules
   * still stop at the edge of `.world`.
   */
  describe("galeria de primitivas (/ui)", () => {
    let gal: Page;

    beforeAll(async () => {
      gal = await browser.newPage({ viewport: { width: 1620, height: 1000 } });
      await gal.goto(`${external!.url}/ui`);
      await gal.waitForSelector("[data-slot=gallery]");
    }, 30_000);

    afterAll(async () => {
      await gal?.close();
    });

    /** Contrast of a primitive's text over its own background, as the browser paints it. */
    const contrastIn = (panel: "dark" | "light", slot: string) =>
      gal.evaluate(
        ({ panel, slot }) => {
          const el = document.querySelector(`[data-panel=${panel}] [data-slot=${slot}]`);
          if (!el) throw new Error(`no [data-slot=${slot}] in [data-panel=${panel}]`);
          const cs = getComputedStyle(el);
          const channel = (v: number) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
          const lum = (s: string) => {
            const [r, g, b] = (s.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
            return 0.2126 * channel(r!) + 0.7152 * channel(g!) + 0.0722 * channel(b!);
          };
          const pair = [lum(cs.color), lum(cs.backgroundColor)].sort((x, y) => y - x);
          return ((pair[0] ?? 0) + 0.05) / ((pair[1] ?? 0) + 0.05);
        },
        { panel, slot },
      );

    const triggerIn = (panel: "dark" | "light", text: string) =>
      gal.locator(`[data-panel=${panel}] button`).filter({ hasText: text }).first();

    it("o botão primário passa de 4,5:1 nos dois temas (1.4.3)", async () => {
      expect(await contrastIn("dark", "button")).toBeGreaterThanOrEqual(4.5);
      expect(await contrastIn("light", "button")).toBeGreaterThanOrEqual(4.5);
    });

    it("o diálogo prende o foco, o Tab não escapa e o Esc devolve ao gatilho (2.1.2)", async () => {
      const trigger = triggerIn("dark", "Abrir diálogo");
      await trigger.click();
      await gal.waitForSelector("[data-slot=dialog-content]");
      const inside = () => gal.evaluate(() => document.activeElement?.closest("[data-slot=dialog-content]") !== null);
      await expect(inside()).resolves.toBe(true);
      for (let i = 0; i < 8; i++) {
        await gal.keyboard.press("Tab");
        await expect(inside()).resolves.toBe(true);
      }
      await gal.keyboard.press("Escape");
      await expect.poll(() => gal.locator("[data-slot=dialog-content]").count()).toBe(0);
      await expect(gal.evaluate(() => document.activeElement?.textContent?.trim())).resolves.toBe("Abrir diálogo");
    });

    it("o alert-dialog abre focado em um dos botões e o escuro/claro do painel vai com o portal", async () => {
      const trigger = triggerIn("light", "Excluir workspace");
      await trigger.click();
      await gal.waitForSelector("[data-slot=alert-dialog-content]");
      // The portal is a child of <body>, so the panel's theme scope has to travel on the content itself.
      await expect(gal.locator("[data-slot=alert-dialog-content].ui-light").count()).resolves.toBe(1);
      await expect(
        gal.evaluate(() => {
          const el = document.activeElement;
          return el?.getAttribute("data-slot") ?? "";
        }),
      ).resolves.toBeTruthy();
      await gal.keyboard.press("Escape");
      await expect.poll(() => gal.locator("[data-slot=alert-dialog-content]").count()).toBe(0);
    });

    it("a tooltip abre pelo foco do teclado, não só pelo mouse (2.1.1)", async () => {
      await triggerIn("dark", "Exportar").focus();
      await gal.waitForSelector("[data-slot=tooltip-content]", { timeout: 3_000 });
      await expect(gal.locator("[data-slot=tooltip-content]").first().textContent()).resolves.toBe("Exportar como SVG");
    });

    it("o menu abre pelo teclado, nomeia os itens e fecha no Esc (4.1.2)", async () => {
      await triggerIn("dark", "Ações").focus();
      await gal.keyboard.press("Enter");
      await gal.waitForSelector("[data-slot=menu-content]");
      await expect(gal.getByRole("menuitem", { name: /^Excluir/ }).count()).resolves.toBe(1);
      await gal.keyboard.press("ArrowDown");
      // Which item Radix focuses first depends on whether the open already focused one, so what is
      // asserted is the kind of thing: the arrow keeps the focus on an item inside the menu.
      const nav = await gal.evaluate(() => {
        const el = document.activeElement;
        return { slot: el?.getAttribute("data-slot") ?? "", inMenu: el?.closest("[data-slot=menu-content]") !== null };
      });
      expect(nav.inMenu).toBe(true);
      expect(nav.slot).toMatch(/^menu-(item|checkbox-item|radio-item)$/);
      await gal.keyboard.press("Escape");
      await expect.poll(() => gal.locator("[data-slot=menu-content]").count()).toBe(0);
    });

    it("a regra de movimento reduzido vale para o chrome e não entra no documento (ADR 0003)", async () => {
      const rm = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
      await rm.goto(external!.url);
      await rm.locator(".workspace-card.is-active").click();
      await rm.waitForSelector('[data-paprika-id="login"]');
      const probe = await rm.evaluate(() => {
        const chrome = document.querySelector("nav[aria-label=Ferramentas] button");
        const world = document.querySelector(".world [data-paprika-id]");
        if (!chrome || !world) return null;
        return {
          chrome: getComputedStyle(chrome).transitionDuration,
          world: getComputedStyle(world).transitionDuration,
          worldLineHeight: getComputedStyle(document.querySelector(".world")!).lineHeight,
        };
      });
      await rm.close();
      expect(probe).not.toBeNull();
      // The guard neutralizes the primitives' animations in the app chrome…
      expect(probe!.chrome).not.toBe("0s");
      // …but the document under .world keeps the browser defaults the export and the screenshot use.
      expect(probe!.world).toBe("0s");
      expect(probe!.worldLineHeight).toBe("normal");
    });
  });
});
