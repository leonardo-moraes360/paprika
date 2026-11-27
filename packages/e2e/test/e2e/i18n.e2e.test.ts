import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { chromium, type Browser, type Page } from "playwright";
import { startServer, type ExternalServer } from "../harness.js";
import { pinLocale } from "./locale.js";
import { webDist } from "./seededCanvas.js";

describe.skipIf(!existsSync(webDist))("E2E: i18n en + pt-BR", () => {
  let external: ExternalServer | undefined;
  let browser: Browser;

  beforeAll(async () => {
    external = await startServer({ webRoot: webDist });
    browser = await chromium.launch(process.env.PAPRIKA_CHROMIUM ? { executablePath: process.env.PAPRIKA_CHROMIUM } : {});
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    await external?.stop();
  });

  async function openOverview(locale: "en" | "pt-BR"): Promise<Page> {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await pinLocale(page, locale);
    await page.goto(external!.url);
    await page.getByRole("button", { name: /^(Idioma|Language):/ }).waitFor();
    return page;
  }

  // The new editor opens an empty workspace with empty states (no "Página 1" / "Retângulo" placeholder of the old app): they follow the language.
  it("pt-BR: overview and empty editor follow Portuguese", async () => {
    const page = await openOverview("pt-BR");
    await expect.poll(() => page.getByRole("button", { name: /^Idioma:/ }).innerText()).toBe("PT");
    await expect.poll(() => page.getByRole("button", { name: /Novo workspace/ }).count()).toBe(1);
    await page.getByRole("button", { name: /Novo workspace/ }).click();
    await page.getByRole("textbox", { name: "Nome do workspace" }).fill("i18n-pt");
    await page.getByRole("button", { name: "Criar" }).click();
    await page.getByRole("complementary", { name: "Painel de camadas" }).waitFor();
    await expect.poll(() => page.getByText("Nenhuma página ainda.").count()).toBe(1);
    await expect.poll(() => page.getByText(/^Vazio\. Desenhe um frame/).count()).toBe(1);
    await expect.poll(() => page.getByRole("button", { name: "Retângulo" }).count()).toBe(1);
    await page.close();
  }, 60_000);

  it("en: overview and empty editor follow English", async () => {
    const page = await openOverview("en");
    await expect.poll(() => page.getByRole("button", { name: /^Language:/ }).innerText()).toBe("EN");
    await expect.poll(() => page.getByRole("button", { name: /New workspace/ }).count()).toBe(1);
    await page.getByRole("button", { name: /New workspace/ }).click();
    await page.getByRole("textbox", { name: "Workspace name" }).fill("i18n-en");
    await page.getByRole("button", { name: "Create" }).click();
    await page.getByRole("complementary", { name: "Layers panel" }).waitFor();
    await expect.poll(() => page.getByText("No pages yet.").count()).toBe(1);
    await expect.poll(() => page.getByText(/^Empty\. Draw a frame/).count()).toBe(1);
    await expect.poll(() => page.getByRole("button", { name: "Rectangle" }).count()).toBe(1);
    await page.getByRole("button", { name: /^Language:/ }).click();
    await page.getByRole("menuitemradio", { name: "Português (Brasil)" }).click();
    await expect.poll(() => page.getByText("Nenhuma página ainda.").count()).toBe(1);
    await expect.poll(() => page.getByRole("button", { name: "Retângulo" }).count()).toBe(1);
    await expect.poll(() => page.getByRole("button", { name: /^Idioma:/ }).innerText()).toBe("PT");
    await page.close();
  }, 60_000);
});
