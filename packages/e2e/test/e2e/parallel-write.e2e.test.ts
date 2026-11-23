import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser, type ConsoleMessage, type Page } from "playwright";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { pinLocale } from "./locale.js";
import { startServer, type ExternalServer } from "../harness.js";

const root = resolve(import.meta.dirname, "../../../..");
const webRoot = join(root, "apps/web/dist");
const sessions = 6;
const writesEach = 8;

describe.skipIf(!existsSync(webRoot))("E2E: muitos agentes escrevendo ao mesmo tempo", () => {
  let dir: string;
  let external: ExternalServer | undefined;
  let browser: Browser;
  let page: Page;
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "paprika-parallel-"));
    external = await startServer({ webRoot });
    browser = await chromium.launch(process.env.PAPRIKA_CHROMIUM ? { executablePath: process.env.PAPRIKA_CHROMIUM } : {});
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on("pageerror", (err) => pageErrors.push(err.message));
    page.on("console", (msg: ConsoleMessage) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    await pinLocale(page, "pt-BR");
    await page.goto(external.url);
    await page.locator(".workspace-card").first().click();
    await page.getByRole("navigation", { name: "Ferramentas" }).waitFor();
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    await external?.stop();
    await rm(dir, { recursive: true, force: true });
  });

  it("mantém a casca com N sessões MCP escrevendo no mesmo workspace", async () => {
    const workspaceId = (await external!.doc()).id;
    const clients: Client[] = [];
    try {
      for (let i = 0; i < sessions; i++) {
        const client = new Client({ name: `parallel-${i}`, version: "0" });
        await client.connect(new StreamableHTTPClientTransport(new URL(`${external!.url}/mcp`)));
        clients.push(client);
      }
      await Promise.all(
        clients.map(async (client, i) => {
          for (let k = 0; k < writesEach; k++) {
            const result = (await client.callTool({
              name: "create_nodes",
              arguments: {
                workspaceId,
                nodes: [{ type: "rect", id: `p${i}n${k}`, x: i * 28, y: k * 22, width: 20, height: 16, fill: "#c8401f" }],
              },
            })) as { isError?: boolean; content: { text?: string }[] };
            if (result.isError) throw new Error(result.content.map((part) => part.text ?? "").join("\n"));
          }
        }),
      );
      await expect.poll(() => page.locator('[data-paprika-id="p0n0"]').count()).toBe(1);
      expect(await page.getByRole("navigation", { name: "Ferramentas" }).isVisible()).toBe(true);
      expect(await page.getByRole("complementary", { name: "Páginas e camadas" }).isVisible()).toBe(true);
      expect(await page.getByRole("complementary", { name: "Propriedades" }).isVisible()).toBe(true);
      expect(await page.getByTestId("canvas-error").count()).toBe(0);
      expect(await page.locator("#root").evaluate((el) => el.childElementCount)).toBeGreaterThan(0);
      expect(pageErrors, pageErrors.join("\n")).toEqual([]);
      expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
    } finally {
      await Promise.all(clients.map((client) => client.close()));
    }
  }, 90_000);
});
