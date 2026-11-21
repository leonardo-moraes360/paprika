#!/usr/bin/env node
// Dumps the MCP contract of the TypeScript server (tools/list, instructions, server info) so the
// Go server serves exactly the same tool definitions, plus the SVG export's measure script.
// Usage (repo root, after `pnpm build`):
//   node server-go/scripts/gen-contract.mjs
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const serverDir = join(root, "packages/server");
const req = createRequire(join(serverDir, "package.json"));
const sdk = (p) => import(pathToFileURL(req.resolve(`@modelcontextprotocol/sdk/${p}`)).href);
const { Client } = await sdk("client/index.js");
const { InMemoryTransport } = await sdk("inMemory.js");
const { DocumentStore, createMcpServer } = await import(pathToFileURL(join(serverDir, "dist/index.js")).href);

const dir = mkdtempSync(join(tmpdir(), "paprika-contract-"));
const store = await DocumentStore.open(join(dir, "c.paprika.json"), { watch: false });
const [a, b] = InMemoryTransport.createLinkedPair();
await createMcpServer(store, {}).connect(a);
const client = new Client({ name: "contract", version: "0" });
await client.connect(b);
const { tools } = await client.listTools();
const contract = { serverInfo: client.getServerVersion(), capabilities: client.getServerCapabilities(), instructions: client.getInstructions(), tools };
writeFileSync(join(here, "../contract/mcp.json"), JSON.stringify(contract, null, 2) + "\n");
const { MEASURE_SCRIPT } = await import(pathToFileURL(join(root, "packages/core/dist/index.js")).href);
writeFileSync(join(here, "../contract/measure.js"), MEASURE_SCRIPT + "\n");
console.log(`contract: ${tools.length} tools → server-go/contract/mcp.json (+ measure.js)`);
await client.close();
await store.close();
rmSync(dir, { recursive: true, force: true });
