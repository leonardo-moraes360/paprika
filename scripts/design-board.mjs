import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

export function repoRoot() {
  return join(dirname(fileURLToPath(import.meta.url)), "..");
}

export function textOf(r) {
  return (r.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
}

export function unwrapTool(name, r) {
  if (r.isError) throw new Error(`${name}: ${JSON.stringify(r.content)}`);
  return r;
}

export async function openClient(require, name) {
  const mcpUrl = process.env.PAPRIKA_MCP ?? "http://127.0.0.1:4777/mcp";
  const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
  const { StreamableHTTPClientTransport } = require("@modelcontextprotocol/sdk/client/streamableHttp.js");
  const client = new Client({ name, version: "0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(mcpUrl)));
  const call = (tool, args = {}) => client.callTool({ name: tool, arguments: args }).then((r) => unwrapTool(tool, r));
  return { client, call, mcpUrl };
}

export async function connectBoard(name, sdkPath) {
  const root = repoRoot();
  const require = createRequire(sdkPath ?? join(root, "packages/e2e/package.json"));
  return { root, ...(await openClient(require, name)) };
}

export async function saveShots(call, workspaceId, outDir, shots, onMissing) {
  await mkdir(outDir, { recursive: true });
  for (const [rootId, file] of shots) {
    const r = await call("render_screenshot", { workspaceId, rootId, scale: 2 });
    const img = (r.content ?? []).find((c) => c.type === "image");
    const b64 = img?.data;
    if (!b64) {
      if (onMissing) {
        onMissing(rootId, r);
        continue;
      }
      throw new Error(`no image for ${rootId}: ${textOf(r).slice(0, 400)}`);
    }
    await writeFile(join(outDir, file), Buffer.from(b64, "base64"));
    console.log("wrote", file);
  }
}

export async function openDesignPage(name, { workspaceName = "Paprica · UI", pageName = "Interfaces", gap = 160 } = {}) {
  const root = repoRoot();
  const sdkPkg = [
    join(root, "packages/e2e/node_modules/@modelcontextprotocol/sdk/package.json"),
    join(root, "../paprika/packages/e2e/node_modules/@modelcontextprotocol/sdk/package.json"),
  ].find((p) => existsSync(p));
  if (!sdkPkg) throw new Error("MCP SDK not installed (packages/e2e)");
  const { client, call } = await openClient(createRequire(sdkPkg), name);

  const parsed = JSON.parse(textOf(await call("list_workspaces")));
  const list = parsed.workspaces ?? parsed;
  const ws = list.find((w) => w.name === workspaceName);
  if (!ws) throw new Error(`workspace ${workspaceName} not found: ${list.map((w) => w.name).join(" | ")}`);
  const workspaceId = ws.id;
  console.log("workspace", workspaceId, ws.name);

  const outline = textOf(await call("get_document_outline", { workspaceId, depth: 1 }));
  const pageBlock = outline.split(/\n(?=page#)/).find((b) => new RegExp(`^page#\\S+ "${pageName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`).test(b));
  if (!pageBlock) throw new Error(`${pageName} page not in outline:\n${outline.slice(0, 500)}`);
  const pageId = (pageBlock.match(/^page#([A-Za-z0-9]+)/) ?? [])[1];
  const ys = [...pageBlock.matchAll(/@-?\d+(?:\.\d+)?,\s*(-?\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
  const heights = [...pageBlock.matchAll(/(\d+(?:\.\d+)?)×(\d+(?:\.\d+)?)\s+@/g)].map((m) => Number(m[2]));
  const maxBottom = ys.reduce((m, y, i) => Math.max(m, y + (heights[i] ?? 0)), 0);
  const Y = Math.ceil((maxBottom + gap) / 40) * 40;
  console.log("page", pageId, "y", Y, "maxBottom", maxBottom);
  return { root, client, call, workspaceId, pageId, Y };
}
