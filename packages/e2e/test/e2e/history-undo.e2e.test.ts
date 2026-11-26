import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Document } from "@paprika/core";
import { startServer, type ExternalServer } from "../harness.js";
import { pinLocale } from "./locale.js";

const root = resolve(import.meta.dirname, "../../../..");
const webRoot = join(root, "web-legacy/dist");
const shotsDir = process.env.PAPRIKA_HISTORY_SHOTS;

describe.skipIf(!existsSync(webRoot))("E2E: Ctrl+Z por autor e histórico", () => {
  let dir: string;
  let external: ExternalServer | undefined;
  let browser: Browser;
  let page: Page;
  let agent: Client;
  const doc = (): Promise<Document> => external!.doc();
  const node = async (id: string) => (await doc()).nodes[id] as unknown as { x: number; y: number; fill?: string; name?: string };
  const toast = () => page.getByTestId("toast");

  const agentUpdate = (id: string, props: Record<string, unknown>) => agent.callTool({ name: "update_nodes", arguments: { updates: [{ id, props }] } });
  const humanMove = async (id: string) => {
    await page.locator('[data-layer-id="login"]').click();
    await page.locator('[data-testid="viewport"]').click({ position: { x: 5, y: 5 } });
    await page.locator(`[data-layer-id="${id}"]`).click();
    await page.keyboard.press("ArrowRight");
  };
  const clearToast = async () => {
    for (let i = 0; i < 3; i++) {
      await page.waitForTimeout(300);
      if (await toast().count()) await toast().getByRole("button", { name: "Dispensar" }).click();
    }
    await expect.poll(() => toast().count()).toBe(0);
  };
  const shot = async (name: string, theme: "escuro" | "claro", target?: ReturnType<Page["locator"]>) => {
    if (!shotsDir) return;
    await page.evaluate((light) => document.documentElement.classList.toggle("ui-light", light), theme === "claro");
    await page.waitForTimeout(150);
    const path = join(shotsDir, `${name}-${theme}.png`);
    if (target) await target.screenshot({ path });
    else await page.screenshot({ path });
    await page.evaluate(() => document.documentElement.classList.remove("ui-light"));
  };

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "paprika-history-"));
    const file = join(dir, "demo.paprika.json");
    await copyFile(join(root, "packages/e2e/fixtures/demo.paprika.json"), file);
    external = await startServer({ seed: file, webRoot });
    browser = await chromium.launch(process.env.PAPRIKA_CHROMIUM ? { executablePath: process.env.PAPRIKA_CHROMIUM } : {});
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    page = await ctx.newPage();
    await pinLocale(page, "pt-BR");
    await page.goto(external.url);
    await page.locator(".workspace-card.is-active").click();
    await page.waitForSelector('[data-paprika-id="login"]');
    agent = new Client({ name: "claude", version: "0" });
    await agent.connect(new StreamableHTTPClientTransport(new URL(`${external.url}/mcp`)));
  }, 60_000);

  afterAll(async () => {
    await agent?.close();
    await browser?.close();
    await external?.stop();
    await rm(dir, { recursive: true, force: true });
  });

  it("B3: só há passos de agente, Ctrl+Z não desfaz nada e o toast leva ao histórico", async () => {
    await agentUpdate("plano", { name: "Plano agente 1" });
    await agentUpdate("plano", { fill: "#223344" });
    await page.locator('[data-testid="viewport"]').click({ position: { x: 5, y: 5 } });
    const before = await external!.version();
    await page.keyboard.press("Control+z");
    await expect.poll(() => toast().innerText()).toMatch(/Nada seu para desfazer\. Os últimos passos são de \S+\./);
    expect(await external!.version()).toBe(before);
    expect((await node("plano")).name).toBe("Plano agente 1");
    await expect.poll(() => page.getByRole("status").filter({ has: toast() }).count()).toBe(1);
    await shot("b3", "escuro");
    await shot("b3", "claro");
    await toast().getByRole("button", { name: "Ver histórico" }).click();
    await expect.poll(() => page.getByRole("region", { name: "Histórico" }).isVisible()).toBe(true);
    await page.keyboard.press("Escape");
    await expect.poll(() => page.getByRole("region", { name: "Histórico" }).count()).toBe(0);
  });

  it("B1: o último passo é seu, Ctrl+Z o desfaz e o toast oferece Refazer com Ctrl Y", async () => {
    await clearToast();
    const x0 = (await node("plano")).x;
    await humanMove("plano");
    await expect.poll(async () => (await node("plano")).x).toBe(x0 + 1);
    await page.locator('[data-testid="viewport"]').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("Control+z");
    await expect.poll(() => toast().innerText()).toContain("Desfeito: mover");
    await expect.poll(async () => (await node("plano")).x).toBe(x0);
    await expect.poll(() => toast().getByRole("button", { name: "Refazer" }).isVisible()).toBe(true);
    await expect.poll(() => toast().locator("kbd").allInnerTexts()).toEqual(["Ctrl", "Y"]);
    await shot("b1", "escuro");
    await shot("b1", "claro");
    await toast().getByRole("button", { name: "Refazer" }).click();
    await expect.poll(async () => (await node("plano")).x).toBe(x0 + 1);
    await expect.poll(() => toast().innerText()).toContain("Refeito: mover");
    await page.keyboard.press("Control+z");
    await expect.poll(async () => (await node("plano")).x).toBe(x0);
    await page.keyboard.press("Control+y");
    await expect.poll(async () => (await node("plano")).x).toBe(x0 + 1);
    await page.keyboard.press("Control+z");
    await expect.poll(async () => (await node("plano")).x).toBe(x0);
  });

  it("B2: agentes escreveram depois de você, Ctrl+Z desfaz o seu passo e mantém os deles", async () => {
    await clearToast();
    const x0 = (await node("login")).x;
    await humanMove("login");
    await expect.poll(async () => (await node("login")).x).toBe(x0 + 1);
    await agentUpdate("plano", { fill: "#445566" });
    await agentUpdate("plano", { name: "Plano agente 2" });
    await page.locator('[data-testid="viewport"]').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("Control+z");
    await expect.poll(() => toast().innerText()).toContain("Desfeito o seu passo: mover. 2 passos de agentes mais recentes foram mantidos.");
    await expect.poll(async () => (await node("login")).x).toBe(x0);
    const plano = await node("plano");
    expect(plano.fill).toBe("#445566");
    expect(plano.name).toBe("Plano agente 2");
    await shot("b2", "escuro");
    await shot("b2", "claro");
    await toast().getByRole("button", { name: "Refazer" }).click();
    await expect.poll(async () => (await node("login")).x).toBe(x0 + 1);
    expect((await node("plano")).name).toBe("Plano agente 2");
    await page.keyboard.press("Control+z");
    await expect.poll(async () => (await node("login")).x).toBe(x0);
  });

  it("conflito: passos mais recentes mexeram nos mesmos elementos, nada é desfeito", async () => {
    await clearToast();
    await humanMove("login");
    const moved = (await node("login")).x;
    await agentUpdate("login", { x: moved + 50 });
    await page.locator('[data-testid="viewport"]').click({ position: { x: 5, y: 5 } });
    const before = await external!.version();
    await page.keyboard.press("Control+z");
    await expect.poll(() => toast().innerText()).toContain("Não dá para desfazer só este passo: passos mais recentes mexeram nos mesmos elementos.");
    await expect.poll(() => toast().getByRole("button", { name: "Ver histórico" }).isVisible()).toBe(true);
    expect(await external!.version()).toBe(before);
    expect((await node("login")).x).toBe(moved + 50);
    await shot("conflito", "escuro");
    await shot("conflito", "claro");
    await agent.callTool({ name: "undo", arguments: {} });
    await clearToast();
  });

  it("B4: painel com filtro, grupos por autor, desfeito, seleção e passo de agente com confirmação destrutiva", async () => {
    await clearToast();
    await page.locator('[data-testid="viewport"]').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("Control+h");
    await expect.poll(() => page.getByRole("region", { name: "Histórico" }).isVisible()).toBe(true);
    const panel = page.getByTestId("history-panel");
    await expect.poll(() => panel.getByRole("radiogroup", { name: "Mostrar passos de" }).getByRole("radio", { name: "Todos" }).getAttribute("aria-checked")).toBe("true");
    const steps = panel.getByTestId("history-step");
    await expect.poll(() => steps.count()).toBeGreaterThanOrEqual(4);
    await expect.poll(() => panel.locator('[data-author="human"]').first().innerText()).toBe("você");
    await expect.poll(() => panel.locator('[data-author="agent"]').first().innerText()).toBe("claude");
    await expect.poll(() => panel.locator('[data-undone="true"]').first().innerText()).toContain("desfeito");
    await expect.poll(() => panel.locator('[data-actor="user"]').count()).toBeGreaterThan(0);
    await panel.getByRole("radio", { name: "Só meus" }).click();
    await expect.poll(() => panel.locator('[data-actor^="agent"]').count()).toBe(0);
    await expect.poll(() => panel.locator('[data-actor="user"]').first().isVisible()).toBe(true);
    await panel.getByRole("radio", { name: "Todos" }).click();

    const agentStep = panel.locator('[data-actor^="agent"][data-undone="false"]').filter({ hasText: /Plano agente 2|mexer|atualizar|update/i }).first();
    const target = (await agentStep.count()) ? agentStep : panel.locator('[data-actor^="agent"][data-undone="false"]').first();
    const label = (await target.getByRole("button").first().getAttribute("aria-label")) ?? "";
    expect(label).toMatch(/claude/);
    await target.getByRole("button").first().click();
    await expect.poll(() => page.locator('[data-layer-id="plano"].is-selected').count()).toBe(1);
    await shot("b4-painel", "escuro", panel);
    await shot("b4-painel", "claro", panel);

    await target.hover();
    await target.getByRole("button", { name: /^Ações do passo / }).click();
    await expect.poll(() => page.getByRole("menuitem").allInnerTexts()).toEqual(["Desfazer este passo", "Selecionar nós do passo", "Copiar rótulo"]);
    await shot("b4-menu", "escuro");
    await shot("b4-menu", "claro");
    await page.getByRole("menuitem", { name: "Desfazer este passo" }).click();
    const dialog = page.getByRole("alertdialog");
    await expect.poll(() => dialog.isVisible()).toBe(true);
    await expect.poll(() => dialog.getByRole("heading").innerText()).toBe("Desfazer um passo do claude?");
    await expect.poll(() => dialog.innerText()).toContain("foi feito pelo agente claude");
    const confirmButton = dialog.getByRole("button", { name: "Desfazer passo" });
    const colours = await confirmButton.evaluate((el) => {
      const probe = document.createElement("div");
      probe.style.background = "var(--color-ui-destructive)";
      document.body.append(probe);
      const expected = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return { actual: getComputedStyle(el).backgroundColor, expected };
    });
    expect(colours.actual).toBe(colours.expected);
    await expect.poll(() => dialog.getByTestId("history-confirm-icon").locator("svg").getAttribute("class")).toMatch(/lucide-octagon-alert/);
    await shot("b4-confirmacao", "escuro");
    await shot("b4-confirmacao", "claro");
    const planoBefore = await node("plano");
    const stepId = await target.getAttribute("data-step-id");
    const same = panel.locator(`[data-step-id="${stepId}"]`);
    await dialog.getByRole("button", { name: "Cancelar" }).click();
    await expect.poll(() => dialog.count()).toBe(0);
    expect(await node("plano")).toEqual(planoBefore);

    await target.hover();
    await target.getByRole("button", { name: /^Ações do passo / }).click();
    await page.getByRole("menuitem", { name: "Desfazer este passo" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Desfazer passo" }).click();
    await expect.poll(() => page.getByRole("alertdialog").count()).toBe(0);
    await expect.poll(() => toast().innerText()).toMatch(/^Desfeito o passo do claude:/);
    await expect.poll(async () => JSON.stringify(await node("plano"))).not.toBe(JSON.stringify(planoBefore));
    await expect.poll(() => same.getAttribute("data-undone")).toBe("true");
    await toast().getByRole("button", { name: "Refazer" }).click();
    await expect.poll(async () => JSON.stringify(await node("plano"))).toBe(JSON.stringify(planoBefore));
    await expect.poll(() => same.getAttribute("data-undone")).toBe("false");

    const own = panel.locator('[data-actor="user"][data-undone="false"]').first();
    const ownX = (await node("login")).x;
    await own.hover();
    await own.getByRole("button", { name: /^Ações do passo / }).click();
    await page.getByRole("menuitem", { name: "Desfazer este passo" }).click();
    await expect.poll(() => page.getByRole("alertdialog").count()).toBe(0);
    await expect.poll(() => toast().innerText()).toMatch(/^Desfeito: /);
    expect(typeof ownX).toBe("number");
    await expect.poll(() => page.getByRole("menu").count()).toBe(0);
    await page.keyboard.press("Escape");
    await expect.poll(() => panel.count()).toBe(0);
  }, 40_000);

  it("o toast some sozinho em cerca de 6 s e pausa com o mouse em cima", async () => {
    await clearToast();
    await page.locator('[data-testid="viewport"]').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("Control+z");
    await expect.poll(() => toast().isVisible()).toBe(true);
    const box = (await toast().boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(7_000);
    await expect.poll(() => toast().isVisible()).toBe(true);
    await page.mouse.move(5, 5);
    await expect.poll(() => toast().count(), { timeout: 9_000 }).toBe(0);
  }, 40_000);

  it("a ação do toast é alcançável pelo teclado", async () => {
    await clearToast();
    await humanMove("plano");
    await page.locator('[data-testid="viewport"]').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("Control+z");
    await expect.poll(() => toast().isVisible()).toBe(true);
    const refazer = toast().getByRole("button", { name: "Refazer" });
    await page.locator("body").focus();
    for (let i = 0; i < 300; i++) {
      await page.keyboard.press("Tab");
      if (await refazer.evaluate((el) => el === document.activeElement)) break;
    }
    await expect.poll(() => refazer.evaluate((el) => el === document.activeElement)).toBe(true);
    await page.keyboard.press("Enter");
    await expect.poll(() => toast().innerText()).toContain("Refeito: mover");
  });
});
