import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
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
});
