import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { pinLocale } from "./locale.js";
import { startServer, type ExternalServer } from "../harness.js";

const root = resolve(import.meta.dirname, "../../../..");
const webRoot = join(root, "apps/web/dist/client");
const POLL = { timeout: 10_000 };

describe.skipIf(!existsSync(webRoot))("E2E: abrir /w/<id> não troca o workspace ativo", () => {
  let external: ExternalServer;
  let browser: Browser;
  let context: BrowserContext;
  let agent: Client;
  let a: string;
  let b: string;

  const structured = (r: unknown) => (r as { structuredContent: Record<string, any> }).structuredContent;
  const active = async () => ((await (await fetch(`${external.url}/api/workspaces`)).json()) as { active: string }).active;
  const outline = async (workspaceId: string) =>
    (await agent.callTool({ name: "get_document_outline", arguments: { workspaceId } })).content as { text: string }[];
  const outlineText = async (workspaceId: string) => (await outline(workspaceId)).map((c) => c.text).join("\n");
  const newPage = async (): Promise<Page> => {
    const p = await context.newPage();
    await pinLocale(p, "pt-BR");
    return p;
  };

  beforeAll(async () => {
    external = await startServer({ webRoot });
    a = (await external.doc()).id;
    browser = await chromium.launch(process.env.PAPRIKA_CHROMIUM ? { executablePath: process.env.PAPRIKA_CHROMIUM } : {});
    context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    agent = new Client({ name: "view-agent", version: "0" });
    await agent.connect(new StreamableHTTPClientTransport(new URL(`${external.url}/mcp`)));
    await agent.callTool({ name: "create_nodes", arguments: { nodes: [{ type: "frame", id: "a-frame", name: "Frame A", width: 200, height: 120, fill: "#ffffff" }] } });
    b = structured(await agent.callTool({ name: "create_workspace", arguments: { name: "Workspace B" } })).workspace.id;
    await agent.callTool({
      name: "create_nodes",
      arguments: {
        workspaceId: b,
        nodes: [
          { type: "frame", id: "b-one", name: "B um", width: 200, height: 120, fill: "#ffffff" },
          { type: "frame", id: "b-two", name: "B dois", x: 300, width: 200, height: 120, fill: "#ffffff" },
        ],
      },
    });
  }, 60_000);

  afterAll(async () => {
    await agent?.close();
    await browser?.close();
    await external?.stop();
  });

  it("carregar /w/<B> com A ativo mostra B, deixa A ativo e sai do 'Abrindo workspace…' na primeira navegação", async () => {
    expect(await active()).toBe(a);
    const pageB = await newPage();
    await pageB.goto(`${external.url}/w/${b}`);
    await pageB.waitForSelector('[data-paprika-id="b-one"]', { timeout: 5_000 });
    expect(await pageB.getByText(/Abrindo workspace/).count()).toBe(0);
    expect(await pageB.locator('[data-paprika-id="a-frame"]').count()).toBe(0);
    await expect.poll(() => pageB.getByRole("navigation", { name: "Caminho do documento" }).textContent(), POLL).toContain("Workspace B");
    expect(await active()).toBe(a);
    expect((await external.doc()).id).toBe(a);
    await pageB.close();
  });

  it("uma segunda aba em /w/<A> continua mostrando A enquanto outra aba vê B, e as edições de B caem em B", async () => {
    const pageA = await newPage();
    const pageB = await newPage();
    await pageA.goto(`${external.url}/w/${a}`);
    await pageA.waitForSelector('[data-paprika-id="a-frame"]');
    await pageB.goto(`${external.url}/w/${b}`);
    await pageB.waitForSelector('[data-paprika-id="b-two"]');
    expect(await pageA.locator('[data-paprika-id="b-one"]').count()).toBe(0);
    expect(await active()).toBe(a);

    await pageB.locator('[data-paprika-id="b-one"]').click();
    await pageB.keyboard.press("Delete");
    await expect.poll(async () => await outlineText(b), POLL).not.toContain("b-one");
    expect(await outlineText(b)).toContain("b-two");
    expect(await outlineText(a)).toContain("a-frame");
    expect(await outlineText(a)).not.toContain("b-two");
    expect(await active()).toBe(a);
    expect(await pageA.locator('[data-paprika-id="a-frame"]').count()).toBe(1);

    await pageB.locator('[data-testid="viewport"]').click({ position: { x: 5, y: 5 } });
    await pageB.keyboard.press("Control+z");
    await expect.poll(async () => await outlineText(b), POLL).toContain("b-one");
    expect(await outlineText(a)).not.toContain("b-one");

    await agent.callTool({ name: "create_nodes", arguments: { workspaceId: b, nodes: [{ type: "frame", id: "b-three", name: "B três", y: 300, width: 100, height: 80 }] } });
    await pageB.waitForSelector('[data-paprika-id="b-three"]');
    expect(await pageA.locator('[data-paprika-id="b-three"]').count()).toBe(0);

    await agent.callTool({ name: "open_workspace", arguments: { id: b } });
    await expect.poll(active, POLL).toBe(b);
    expect(new URL(pageA.url()).pathname).toBe(`/w/${a}`);
    expect(await pageA.locator('[data-paprika-id="a-frame"]').count()).toBe(1);
    await agent.callTool({ name: "open_workspace", arguments: { id: a } });
    await expect.poll(active, POLL).toBe(a);
    await pageA.close();
    await pageB.close();
  });

  it("um workspace que não existe volta para a overview com o erro", async () => {
    const p = await newPage();
    await p.goto(`${external.url}/w/nao-existe`);
    await expect.poll(() => new URL(p.url()).pathname, POLL).toBe("/");
    // o app novo não repete o id na mensagem: diz que o workspace não existe
    await expect.poll(() => p.getByRole("alert").textContent(), POLL).toMatch(/Não foi possível abrir o workspace.*não existe/);
    expect(await active()).toBe(a);
    await p.close();
  });
});
