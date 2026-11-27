import { expect } from "vitest";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { pinLocale } from "./locale.js";
import { startServer, type ExternalServer } from "../harness.js";

export const repoRoot = resolve(import.meta.dirname, "../../../..");
export const webDist = join(repoRoot, "apps/web/dist/client");

export type CanvasSession = {
  dir: string;
  external: ExternalServer;
  url: string;
  browser: Browser;
  page: Page;
  pageErrors: string[];
};

export async function openSeededCanvas(prefix: string): Promise<CanvasSession> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  const file = join(dir, "demo.paprika.json");
  await copyFile(join(repoRoot, "packages/e2e/fixtures/demo.paprika.json"), file);
  const external = await startServer({ seed: file, webRoot: webDist });
  const browser = await chromium.launch(process.env.PAPRIKA_CHROMIUM ? { executablePath: process.env.PAPRIKA_CHROMIUM } : {});
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await pinLocale(page, "pt-BR");
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const { active } = (await (await fetch(`${external.url}/api/workspaces`)).json()) as { active: string };
  await page.goto(`${external.url}/w/${encodeURIComponent(active)}`);
  await page.waitForSelector('[data-testid="viewport"] [data-paprika-id="login"]');
  expect(pageErrors).toEqual([]);
  return { dir, external, url: external.url, browser, page, pageErrors };
}

export async function closeSeededCanvas(session: CanvasSession | undefined, clients: Client[]) {
  await Promise.all(clients.map((client) => client.close().catch(() => undefined)));
  await session?.browser.close();
  await session?.external.stop();
  if (session) await rm(session.dir, { recursive: true, force: true });
  expect(session?.pageErrors ?? []).toEqual([]);
}

export async function connectAgent(url: string, name: string, clients: Client[]) {
  const client = new Client({ name, version: "0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${url}/mcp`)));
  clients.push(client);
  return client;
}

export async function callTool(client: Client, name: string, args: Record<string, unknown>) {
  const result = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { text?: string }[] };
  if (result.isError) throw new Error(result.content.map((part) => part.text ?? "").join("\n"));
  return result;
}

export async function revealLayer(page: Page, id: string) {
  const row = page.locator(`[data-layer-id="${id}"]`);
  if ((await row.count()) > 0) return;
  const handle = await page.locator('[role="tree"]').first().evaluateHandle((tree) => {
    let el: HTMLElement | null = tree.parentElement;
    while (el && !["auto", "scroll"].includes(getComputedStyle(el).overflowY)) el = el.parentElement;
    return el!;
  });
  await handle.evaluate((el) => (el.scrollTop = 0));
  for (let i = 0; i < 400; i++) {
    await page.waitForTimeout(40);
    if ((await row.count()) > 0) return;
    const more = await handle.evaluate((el) => {
      const before = el.scrollTop;
      el.scrollTop += el.clientHeight - 60;
      return el.scrollTop > before;
    });
    if (!more) break;
  }
}

export async function dismissToasts(page: Page) {
  const toasts = page.locator('[data-slot="toast"]');
  for (let i = 0; i < 10 && (await toasts.count()) > 0; i++) {
    // o botão de fechar, não o primeiro botão: a ação do toast ("Refazer", "Ver histórico") refaz um passo ou abre o painel
    await toasts.first().getByRole("button", { name: "Fechar notificação" }).click({ timeout: 2000 }).catch(() => undefined);
  }
  await expect.poll(() => toasts.count()).toBe(0);
}
