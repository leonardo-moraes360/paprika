// Desenha uma páprica só com nós path (curvas bezier) pelo MCP e salva um screenshot.
// Uso: node packages/server/scripts/bezier-demo.mjs <saida.paprika.json> <saida.png>
import { DocumentStore, createMcpServer } from "../dist/index.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { writeFile, rm } from "node:fs/promises";
import { join, sep } from "node:path";

// Sonar S8707: os dois caminhos vêm da linha de comando, então são tratados como dado externo.
// Primeiro uma lista de permitidos (segmentos simples — sem `..`, sem caminho absoluto, sem `~`, sem
// coringa), depois o caminho é construído com join a partir do diretório atual, e por fim a checagem
// de contenção acontece no ponto de uso, na frente de `rm` e de `writeFile`. Assim um argumento
// errado não apaga nem sobrescreve arquivos alhures (`bezier-demo.mjs ../../.bashrc x.png`).
const SAFE_ARG_PATH = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;
const here = process.cwd();

function argPath(index, label) {
  const raw = process.argv[index];
  if (!raw) {
    console.error(`faltou o argumento ${index}: node packages/server/scripts/bezier-demo.mjs <saida.paprika.json> <saida.png>`);
    process.exit(2);
  }
  // Allow-list first: a plainly spelled, repo-relative path only. No absolute path, no `~`, no
  // `..` segment, no glob or control characters. Then the containment check below as a second net.
  if (!SAFE_ARG_PATH.test(raw) || raw === "." || raw.split("/").includes("..")) {
    console.error(`${label} precisa ser um caminho relativo simples dentro do diretório atual: ${raw}`);
    process.exit(2);
  }
  return join(here, raw);
}

/** Última rede: o valor que vai para o disco precisa estar sob o diretório atual. */
function insideHere(abs, label) {
  if (!abs.startsWith(here + sep)) {
    console.error(`${label} precisa ficar dentro do diretório atual (${here}): ${abs}`);
    process.exit(2);
  }
  return abs;
}

// Sonar S5145: o texto que o MCP devolve é dado externo; um CR/LF nele imprimiria linhas de log
// forjadas. Os caracteres de controle são escapados — texto comum sai exatamente como antes, e uma
// resposta continua ocupando uma linha.
function printable(text) {
  return String(text).replace(/[\u0000-\u001f\u007f]/g, (c) =>
    c === "\n" ? "\\n" : c === "\r" ? "\\r" : c === "\t" ? "\\t" : `\\u${c.charCodeAt(0).toString(16).padStart(2, "0")}`,
  );
}

const file = insideHere(argPath(2, "documento"), "documento");
const png = insideHere(argPath(3, "png"), "png");
await rm(file, { force: true });
const store = await DocumentStore.open(file);
const [a, b] = InMemoryTransport.createLinkedPair();
await createMcpServer(store, { actor: "agent:bezier-demo" }).connect(a);
const c = new Client({ name: "bezier-demo", version: "0" });
await c.connect(b);
const call = async (name, args) => { const r = await c.callTool({ name, arguments: args }); if (r.isError) throw new Error(r.content[0].text); return r; };
await call("set_tokens", { tokens: { night: "#141827", pod: "#e04a2b", podDark: "#a8321c", leaf: "#4f9a5a", spark: "#4cc7d8", paper: "#fbf8f4" } });
await call("create_nodes", { nodes: [{ type: "frame", id: "board", name: "Bezier · páprica", width: 480, height: 360, fill: "$night", children: [
  // corpo da pimenta: duas cúbicas fechadas
  { type: "path", name: "Vagem", x: 120, y: 90, d: "M40 30 C 120 -10 230 40 250 120 C 262 175 230 215 200 200 C 170 185 160 140 110 120 C 60 100 0 80 40 30 Z", fill: "$pod" },
  { type: "path", name: "Sombra", x: 120, y: 90, d: "M200 200 C 230 215 262 175 250 120 C 245 160 225 185 200 200 Z", fill: "$podDark" },
  { type: "path", name: "Brilho", x: 120, y: 90, d: "M70 40 C 110 25 160 35 190 60", stroke: { color: "$paper", width: 6 }, opacity: 0.55 },
  { type: "path", name: "Cálice", x: 120, y: 90, d: "M30 40 C 20 20 35 5 55 12 C 60 28 50 44 30 40 Z", fill: "$leaf" },
  { type: "path", name: "Talo", x: 120, y: 90, d: "M40 22 Q 30 -10 0 -20", stroke: { color: "$leaf", width: 8 } },
  // onda no viewBox 24×24, escalada
  { type: "path", name: "Faísca", x: 380, y: 40, width: 56, height: 56, viewBox: [0, 0, 24, 24], d: "M12 2 Q13 11 22 12 Q13 13 12 22 Q11 13 2 12 Q11 11 12 2 Z", fill: "$spark" },
  { type: "path", name: "Onda", x: 40, y: 300, d: "M0 20 C 40 -10 80 50 120 20 S 200 -10 240 20 S 320 50 400 20", stroke: { color: "$spark", width: 3 }, strokeCap: "round" },
]}]});
const lint = await call("lint_design", {});
console.log(printable(lint.content[0].text));
console.log(printable((await call("path_info", { id: Object.values(store.doc.nodes).find(n => n.name === "Vagem").id })).content[0].text));
const shot = await call("render_screenshot", { rootId: "board" });
await writeFile(png, Buffer.from(shot.content.find(x => x.type === "image").data, "base64"));
await store.flush(); await store.close(); process.exit(0);
