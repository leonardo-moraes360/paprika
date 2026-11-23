import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { startServer, type ExternalServer } from "../harness.js";
import { pinLocale } from "./locale.js";

const root = resolve(import.meta.dirname, "../../../..");
const webRoot = join(root, "apps/web/dist");

describe.skipIf(!existsSync(webRoot))("E2E: i18n en + pt-BR", () => {
  let dir: string;
  let external: ExternalServer | undefined;
  let browser: Browser;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "paprika-i18n-"));
    external = await startServer({ webRoot });
    browser = await chromium.launch(process.env.PAPRIKA_CHROMIUM ? { executablePath: process.env.PAPRIKA_CHROMIUM } : {});
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    await external?.stop();
    await rm(dir, { recursive: true, force: true });
  });

  async function openOverview(locale: "en" | "pt-BR"): Promise<Page> {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await pinLocale(page, locale);
    await page.goto(external!.url);
    await page.getByTestId("language-switcher").waitFor();
    return page;
  }

  it("pt-BR: overview and page placeholder follow Portuguese", async () => {
    const page = await openOverview("pt-BR");
    await expect.poll(() => page.locator("#paprika-locale").inputValue()).toBe("pt-BR");
    await expect.poll(() => page.getByRole("button", { name: /Novo workspace/ }).count()).toBe(1);
    await page.getByRole("button", { name: /Novo workspace/ }).click();
    await page.getByRole("textbox", { name: "Nome do workspace" }).fill("i18n-pt");
    await page.getByRole("button", { name: "Criar" }).click();
    await page.waitForSelector('[aria-label="Páginas e camadas"]');
    await expect.poll(() => page.getByRole("button", { name: "Página 1" }).count()).toBe(1);
    await expect.poll(() => page.getByRole("button", { name: "Retângulo" }).count()).toBe(1);
    await page.close();
  }, 60_000);

  it("en: overview and page placeholder follow English", async () => {
    const page = await openOverview("en");
    await expect.poll(() => page.locator("#paprika-locale").inputValue()).toBe("en");
    await expect.poll(() => page.getByRole("button", { name: /New workspace/ }).count()).toBe(1);
    await page.getByRole("button", { name: /New workspace/ }).click();
    await page.getByRole("textbox", { name: "Workspace name" }).fill("i18n-en");
    await page.getByRole("button", { name: "Create" }).click();
    await page.waitForSelector('[aria-label="Pages and layers"]');
    await expect.poll(() => page.getByRole("button", { name: "Page 1" }).count()).toBe(1);
    await expect.poll(() => page.getByRole("button", { name: "Rectangle" }).count()).toBe(1);
    await page.locator("#paprika-locale").selectOption("pt-BR");
    await expect.poll(() => page.getByRole("button", { name: "Retângulo" }).count()).toBe(1);
    await page.close();
  }, 60_000);
});
