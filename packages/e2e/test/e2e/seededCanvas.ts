import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { pinLocale } from "./locale.js";
import { startServer, type ExternalServer } from "../harness.js";

export const repoRoot = resolve(import.meta.dirname, "../../../..");
export const webDist = join(repoRoot, "apps/web/dist");

export type CanvasSession = {
  dir: string;
  external: ExternalServer;
  url: string;
  browser: Browser;
  page: Page;
};

export async function openSeededCanvas(prefix: string): Promise<CanvasSession> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  const file = join(dir, "demo.paprika.json");
  await copyFile(join(repoRoot, "examples/demo.paprika.json"), file);
  const external = await startServer({ seed: file, webRoot: webDist });
  const browser = await chromium.launch(process.env.PAPRIKA_CHROMIUM ? { executablePath: process.env.PAPRIKA_CHROMIUM } : {});
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await pinLocale(page, "pt-BR");
  await page.goto(external.url);
  await page.locator(".workspace-card.is-active").click();
  await page.waitForSelector('[data-paprika-id="login"]');
  return { dir, external, url: external.url, browser, page };
}

export async function closeSeededCanvas(session: CanvasSession | undefined, clients: Client[]) {
  await Promise.all(clients.map((client) => client.close().catch(() => undefined)));
  await session?.browser.close();
  await session?.external.stop();
  if (session) await rm(session.dir, { recursive: true, force: true });
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
