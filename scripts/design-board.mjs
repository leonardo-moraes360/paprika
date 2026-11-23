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
