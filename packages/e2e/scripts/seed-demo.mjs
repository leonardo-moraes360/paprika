// Gera examples/demo.paprika.json dirigindo o Paprika como um agente faria: via MCP stdio do
// servidor Go (`pnpm go:build` antes), num banco SQLite temporário exportado no fim.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const bin = process.env.PAPRIKA_SERVER_BIN || join(root, "server-go/bin/paprika");
const file = join(root, "examples/demo.paprika.json");
const dir = mkdtempSync(join(tmpdir(), "paprika-seed-"));
const db = join(dir, "seed.db");
const client = new Client({ name: "seed-demo", version: "0" });
await client.connect(new StdioClientTransport({ command: bin, args: ["mcp", "--db", db, "--no-ui"] }));
const call = async (name, args) => {
  const r = await client.callTool({ name, arguments: args });
  if (r.isError) throw new Error(`${name}: ${r.content[0].text}`);
  return r.content[0].text;
};

await call("apply_ops", { ops: [{ op: "rename_document", name: "Demo Paprika" }] });
await call("set_tokens", {
  tokens: {
    paper: "#fbf8f4", ink: "#1d1a1f", muted: "#6b6470", brand: "#c43d27", "brand.ink": "#ffffff", line: "#e6e0da",
    "text.sm": 14, "text.md": 16, "text.lg": 28,
  },
});
const field = (label, ph) => ({
  type: "frame", name: `Campo ${label}`, width: "fill", height: "hug", fill: "transparent", clip: false,
  layout: { mode: "column", gap: 6 },
  children: [
    { type: "text", name: "Rótulo", text: label, fontSize: "$text.sm", fontWeight: 600, color: "$ink", width: "fill", height: "hug" },
    { type: "frame", name: "Input", width: "fill", height: 48, fill: "#ffffff", radius: 10, stroke: { color: "$line", width: 1 },
      layout: { mode: "row", padding: [0, 14, 0, 14], align: "center" },
      children: [{ type: "text", name: "Placeholder", text: ph, color: "$muted", fontSize: "$text.md", width: "fill", height: "hug" }] },
  ],
});
await call("create_nodes", {
  label: "tela de login",
  nodes: [{
    type: "frame", id: "login", name: "Login · mobile", x: 0, y: 0, width: 390, height: 760, fill: "$paper",
    layout: { mode: "column", gap: 20, padding: [72, 28, 32, 28] },
    notes: "Tela de entrada. Conteúdo real em pt-BR; CTA único.",
    children: [
      { type: "ellipse", name: "Marca", width: 56, height: 56, fill: "$brand" },
      { type: "text", name: "Título", text: "Bem-vindo de volta", fontSize: "$text.lg", fontWeight: 700, color: "$ink", width: "fill", height: "hug", lineHeight: 1.2 },
      { type: "text", name: "Subtítulo", text: "Entre para continuar seus projetos.", fontSize: "$text.md", color: "$muted", width: "fill", height: "hug" },
      field("E-mail", "voce@exemplo.com"),
      field("Senha", "••••••••"),
      { type: "frame", name: "Botão Entrar", width: "fill", height: 52, fill: "$brand", radius: 12,
        layout: { mode: "row", align: "center", justify: "center" },
        children: [{ type: "text", name: "Label", text: "Entrar", color: "$brand.ink", fontWeight: 600, fontSize: "$text.md", width: "hug", height: "hug" }] },
      { type: "text", name: "Link", text: "Esqueci minha senha", color: "$brand", fontSize: "$text.sm", fontWeight: 600, textAlign: "center", width: "fill", height: "hug" },
    ],
  }],
});
await call("create_nodes", {
  label: "card de plano",
  nodes: [{
    type: "frame", id: "plano", name: "Card · plano Pro", x: 460, y: 0, width: 320, height: 360, fill: "#ffffff", radius: 16,
    stroke: { color: "$line", width: 1 }, shadow: { x: 0, y: 12, blur: 32, spread: -8, color: "rgba(29,26,31,0.18)" },
    layout: { mode: "column", gap: 14, padding: 24 },
    children: [
      { type: "frame", name: "Selo", width: "hug", height: "hug", fill: "$brand", radius: 99, layout: { mode: "row", padding: [4, 10, 4, 10] },
        children: [{ type: "text", text: "Mais popular", color: "$brand.ink", fontSize: 12, fontWeight: 600, width: "hug", height: "hug" }] },
      { type: "text", name: "Plano", text: "Pro", fontSize: "$text.lg", fontWeight: 700, color: "$ink", width: "fill", height: "hug" },
      { type: "text", name: "Preço", text: "R$ 49/mês", fontSize: 20, fontWeight: 600, color: "$ink", width: "fill", height: "hug" },
      { type: "text", name: "Benefícios", text: "✓ Projetos ilimitados\n✓ MCP sem limite de chamadas\n✓ Export React e HTML", color: "$muted", lineHeight: 1.7, width: "fill", height: "hug" },
      { type: "frame", name: "CTA", width: "fill", height: 44, fill: "$ink", radius: 10, layout: { mode: "row", align: "center", justify: "center" },
        children: [{ type: "text", text: "Assinar", color: "#ffffff", fontWeight: 600, width: "hug", height: "hug" }] },
    ],
  }],
});
console.log(await call("lint_design", {}));
console.log(await call("get_document_outline", { depth: 1 }));
await client.close();
execFileSync(bin, ["export", "--db", db, "-o", file], { stdio: "inherit" });
rmSync(dir, { recursive: true, force: true });
