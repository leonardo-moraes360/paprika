#!/usr/bin/env node
// Prancha "Links no texto · proposta": desenha, via MCP, a regra de link de texto
// (cor herdada + sublinhado) em dois temas (escuro e claro) e grava PNGs e a tabela de contraste.
//
// Uso (todos os argumentos são obrigatórios, exceto --out e --contrast):
//   node docs/en-US/design/draw-links.mjs --url http://127.0.0.1:5401/mcp \
//     --workspace "Links · proposta (nov/2026)" [--out <pasta dos PNGs>] [--contrast <arquivo.md>]
//
// Escreve só no workspace nomeado (criado se não existir); nunca troca o workspace ativo.
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) throw new Error(`argumento inesperado: ${a}`);
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) throw new Error(`falta o valor de ${a}`);
    out[a.slice(2)] = v;
    i++;
  }
  return out;
}

let args;
try {
  args = parseArgs(process.argv.slice(2));
} catch (e) {
  console.error(e.message);
  args = {};
}
if (!args.url || !args.workspace) {
  console.error('uso: links.mjs --url <http://host:porta/mcp> --workspace "<nome>" [--out <pasta>] [--contrast <arquivo.md>]');
  console.error("recusado: --url e --workspace são obrigatórios (este script escreve em um workspace existente ou novo).");
  process.exit(2);
}
try {
  const u = new URL(args.url);
  if (!/^https?:$/.test(u.protocol) || !u.pathname.endsWith("/mcp")) throw new Error();
} catch {
  console.error("recusado: --url deve ser o endpoint MCP, por exemplo http://127.0.0.1:5401/mcp");
  process.exit(2);
}

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const sdkPkg = [
  join(root, "packages/e2e/node_modules/@modelcontextprotocol/sdk/package.json"),
  join(root, "../paprika/packages/e2e/node_modules/@modelcontextprotocol/sdk/package.json"),
].find((p) => existsSync(p));
if (!sdkPkg) throw new Error("MCP SDK não instalado (packages/e2e)");
const require = createRequire(sdkPkg);
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StreamableHTTPClientTransport } = require("@modelcontextprotocol/sdk/client/streamableHttp.js");

const client = new Client({ name: "links-proposta", version: "0" });
await client.connect(new StreamableHTTPClientTransport(new URL(args.url)));
const textOf = (r) => (r.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
const call = async (name, a = {}, { soft = false } = {}) => {
  const r = await client.callTool({ name, arguments: a });
  if (r.isError && !soft) throw new Error(`${name}: ${textOf(r).slice(0, 600)}`);
  return r;
};

// ---------- contraste WCAG 2.x ----------
const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const rgb = (h) => {
  const s = h.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16) / 255);
};
const lum = (h) => {
  const [r, g, b] = rgb(h).map(lin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const fmt = (r) => (Math.floor(r * 100) / 100).toFixed(2).replace(".", ",");
const AA = 4.5;
const chk = (fg, bg, min, what) => {
  const r = ratio(fg, bg);
  if (r < min) throw new Error(`contraste insuficiente (${fmt(r)} < ${min}) em ${what}: ${fg} sobre ${bg}`);
};

// ---------- paletas (apps/web/src/styles.css) ----------
const THEMES = {
  escuro: {
    key: "escuro",
    bg: "#0F1220", panel: "#1E2336", line: "#2C3350", fg: "#EEF0F7", muted: "#9AA3BF", strip: "#0F1220",
    popover: "#1E2336", fieldBg: "#141827", field: "#686E84", redInk: "#EF5743", ring: "#4CC7D8",
    action: "#CC3A27", onAction: "#FFFFFF", surface: "#272D45", yellow: "#FFC233", yellowInk: "#141827",
    pass: "#1F5E33", fail: "#8A2416",
  },
  claro: {
    key: "claro",
    bg: "#F1E8D5", panel: "#FFFFFF", line: "#EADFC9", fg: "#2A1A14", muted: "#6B5A50", strip: "#F1E8D5",
    popover: "#FFFFFF", fieldBg: "#FBF4E6", field: "#978A7B", redInk: "#D62B1E", ring: "#1C91A1",
    action: "#C4321F", onAction: "#FFFFFF", surface: "#F6EEDF", yellow: "#FFC233", yellowInk: "#2A1A14",
    pass: "#1F5E33", fail: "#8A2416",
  },
};

const BLUE = "#0000EE";
const PARA = "Os prazos mudam a cada ciclo; leia a documentação completa antes de publicar.";
const LINK = "documentação completa";
const FONT = "Inter";

const contrastRows = [];

function build(T, ox) {
  const p = T.key;
  let n = 0;
  const id = (s) => `lk-${p}-${s}${++n}`;
  const nodes = [];
  const text = (x, y, w, s, color, size, o = {}) => {
    if (o.on) chk(color, o.on, o.min ?? AA, `texto "${s.slice(0, 30)}"`);
    return {
      type: "text", id: o.id ?? id("t"), x, y, width: o.hug ? "hug" : w, text: s, color, fontSize: size, fontFamily: FONT,
      fontWeight: o.weight ?? 400, lineHeight: o.lh ?? 1.4, textAlign: o.align ?? "left",
      ...(o.runs ? { runs: o.runs } : {}),
    };
  };
  const box = (x, y, w, h, fill, o = {}) => ({
    type: "frame", id: o.id ?? id("f"), name: o.name, x, y, width: w, height: h, fill, radius: o.radius ?? 0,
    ...(o.stroke ? { stroke: o.stroke } : {}), ...(o.shadow ? { shadow: o.shadow } : {}),
    ...(o.href ? { href: o.href } : {}), clip: o.clip ?? false, children: o.children ?? [],
  });
  const rect = (x, y, w, h, fill, o = {}) => ({ type: "rect", id: o.id ?? id("r"), x, y, width: w, height: h, fill, ...(o.radius ? { radius: o.radius } : {}) });
  const badge = (x, y, pass) =>
    box(x, y, 84, 22, pass ? T.pass : T.fail, {
      radius: 11, name: pass ? "selo passa AA" : "selo falha AA",
      children: [text(0, 2, 84, pass ? "passa AA" : "falha AA", "#FFFFFF", 12, { weight: 600, lh: 1.3, align: "center", on: pass ? T.pass : T.fail })],
    });
  const runsFor = (after, color) => {
    const start = PARA.indexOf(LINK);
    const run = { start, end: start + LINK.length, href: "https://paprika.dev/docs" };
    if (after) run.color = color;
    return [run];
  };
  const panel = (y, h, title, sub, name) => {
    const kids = [text(32, 26, 900, title, T.fg, 20, { weight: 600, on: T.panel }), text(32, 56, 1200, sub, T.muted, 14, { on: T.panel })];
    return { y, h, kids, name };
  };
  const finishPanel = (pn) => {
    nodes.push(box(64, pn.y, 1472, pn.h, T.panel, { radius: 14, stroke: { color: T.line, width: 1 }, name: pn.name, children: pn.kids }));
    return pn.y + pn.h;
  };
  const metaLine = (x, y, w, s, pass) => [text(x, y + 2, w - 96, s, T.muted, 13, { on: T.panel }), badge(x + w - 84, y, pass)];

  // ----- cabeçalho -----
  nodes.push(text(64, 56, 900, "PAPRIKA · LINKS NO TEXTO · PROPOSTA", T.muted, 14, { weight: 600, on: T.bg }));
  nodes.push(text(64, 84, 1300, "Link no texto herda a cor do texto e leva sublinhado", T.fg, 40, { weight: 700, lh: 1.15, on: T.bg }));
  nodes.push(
    text(
      64, 144, 1120,
      "Regra: o link de texto sem cor própria usa a cor do texto ao redor e leva sublinhado (deslocamento 0,15em, espessura max(1px, 0,06em)). Hoje ele nasce azul do navegador, #0000EE, sem relação com o tema.",
      T.fg, 18, { lh: 1.5, on: T.bg },
    ),
  );
  const cards = [
    ["Sem cor própria", "Herda a cor do texto ao redor e leva sublinhado. O contraste do link é o contraste do texto."],
    ["Com cor própria", "Usa a cor escolhida no trecho e leva sublinhado. A cor é de quem desenha; a regra não a corrige."],
    ["Sem visitado, sem hover", "Conteúdo de documento: nada muda de cor depois do clique nem ao passar o mouse."],
    ["Bloco com link", "Frame ou texto inteiro com href: sem sublinhado e sem mudança de cor."],
  ];
  cards.forEach(([t, b], i) => {
    const x = 64 + i * (356 + 16);
    nodes.push(box(x, 244, 356, 124, T.panel, {
      radius: 12, stroke: { color: T.line, width: 1 }, name: `regra · ${t}`,
      children: [text(20, 18, 316, t, T.fg, 15, { weight: 600, on: T.panel }), text(20, 46, 316, b, T.muted, 13, { lh: 1.45, on: T.panel })],
    }));
  });

  // ----- antes × depois -----
  let y = 400;
  {
    const rows = [
      { name: "Escuro do app", info: "fundo #1A1F31, texto #C9CED9", bg: "#1A1F31", fg: "#C9CED9" },
      { name: "Claro", info: "fundo #FFFFFF, texto #2A1A14", bg: "#FFFFFF", fg: "#2A1A14" },
      { name: "Fundo de marca", info: `ação ${T.action}, texto #FFFFFF`, bg: T.action, fg: "#FFFFFF" },
      { name: "Creme do canvas claro", info: "fundo #F1E8D5, texto #2A1A14", bg: "#F1E8D5", fg: "#2A1A14" },
    ];
    const pn = panel(y, 760, "Antes × depois, o mesmo parágrafo em quatro fundos", "Razão de contraste WCAG do link contra o fundo (texto normal: mínimo 4,5:1 para AA).", "antes e depois");
    const cx = [296, 880];
    pn.kids.push(text(cx[0], 100, 560, "ANTES · azul do navegador (#0000EE)", T.muted, 13, { weight: 600, on: T.panel }));
    pn.kids.push(text(cx[1], 100, 560, "DEPOIS · cor do texto + sublinhado", T.muted, 13, { weight: 600, on: T.panel }));
    rows.forEach((r, i) => {
      const ry = 130 + i * 152;
      pn.kids.push(text(32, ry + 4, 240, r.name, T.fg, 15, { weight: 600, on: T.panel }));
      pn.kids.push(text(32, ry + 28, 232, r.info, T.muted, 13, { lh: 1.45, on: T.panel }));
      const before = ratio(BLUE, r.bg);
      const after = ratio(r.fg, r.bg);
      [false, true].forEach((isAfter, k) => {
        const linkColor = isAfter ? r.fg : BLUE;
        pn.kids.push(box(cx[k], ry, 560, 96, r.bg, {
          radius: 10, clip: true, name: `${r.name} · ${isAfter ? "depois" : "antes"}`,
          stroke: { color: T.line, width: 1 },
          children: [text(24, 18, 512, PARA, r.fg, 16, { lh: 1.5, runs: runsFor(isAfter, r.fg) })],
        }));
        const v = isAfter ? after : before;
        pn.kids.push(...metaLine(cx[k], ry + 104, 560, `link ${linkColor} sobre ${r.bg} · ${fmt(v)}:1`, v >= AA));
        if (v >= AA && isAfter === false) {}
      });
      contrastRows.push({ theme: p, fundo: r.name, bg: r.bg, texto: r.fg, antes: before, depois: after });
    });
    y = finishPanel(pn) + 24;
  }

  // ----- cor própria -----
  {
    const pn = panel(y, 296, "Link com cor própria", "O sublinhado acompanha a cor escolhida no trecho. A regra não corrige a escolha: contraste ruim continua ruim.", "cor própria");
    const ex = [
      { name: "Amarelo da marca em fundo escuro", bg: "#1A1F31", fg: "#C9CED9", link: T.yellow },
      { name: "Vermelho de ação em fundo claro", bg: "#FFFFFF", fg: "#2A1A14", link: T.action },
      { name: "Amarelo da marca em fundo claro", bg: "#FFFFFF", fg: "#2A1A14", link: T.yellow },
    ];
    ex.forEach((e, i) => {
      const x = 32 + i * (452 + 26);
      const r = ratio(e.link, e.bg);
      pn.kids.push(text(x, 100, 452, e.name, T.fg, 15, { weight: 600, on: T.panel }));
      const start = PARA.indexOf(LINK);
      pn.kids.push(box(x, 128, 452, 96, e.bg, {
        radius: 10, clip: true, name: `cor própria · ${e.name}`, stroke: { color: T.line, width: 1 },
        children: [text(24, 18, 404, PARA, e.fg, 16, { lh: 1.5, runs: [{ start, end: start + LINK.length, href: "https://paprika.dev/docs", color: e.link }] })],
      }));
      pn.kids.push(...metaLine(x, 234, 452, `link ${e.link} sobre ${e.bg} · ${fmt(r)}:1`, r >= AA));
      contrastRows.push({ theme: p, fundo: `cor própria · ${e.name}`, bg: e.bg, texto: e.link, antes: null, depois: r });
    });
    y = finishPanel(pn) + 24;
  }

  // ----- bloco com link -----
  {
    const pn = panel(y, 340, "Bloco com link", "Frame ou texto inteiro com href: sem sublinhado e sem mudança de cor. O texto do bloco segue o contraste do próprio desenho.", "bloco");
    const labelY = 100;
    const stripY = 128;
    const col = (i) => 32 + i * (452 + 26);
    // 1: botão de ação sobre creme
    pn.kids.push(text(col(0), labelY, 452, "Botão de ação", T.fg, 15, { weight: 600, on: T.panel }));
    pn.kids.push(box(col(0), stripY, 452, 120, "#F1E8D5", {
      radius: 10, clip: true, name: "bloco · faixa creme", stroke: { color: T.line, width: 1 },
      children: [box(24, 38, 220, 44, T.action, { radius: 8, href: "/planos", name: "botão com href", children: [text(0, 11, 220, "Assinar plano Pro", T.onAction, 15, { weight: 600, align: "center", on: T.action })] })],
    }));
    const r1 = ratio(T.onAction, T.action);
    pn.kids.push(...metaLine(col(0), stripY + 132, 452, `texto ${T.onAction} sobre ${T.action} · ${fmt(r1)}:1`, r1 >= AA));
    contrastRows.push({ theme: p, fundo: "bloco · botão de ação", bg: T.action, texto: T.onAction, antes: null, depois: r1 });
    // 2: cartão sobre escuro
    pn.kids.push(text(col(1), labelY, 452, "Cartão inteiro", T.fg, 15, { weight: 600, on: T.panel }));
    pn.kids.push(box(col(1), stripY, 452, 120, "#1A1F31", {
      radius: 10, clip: true, name: "bloco · faixa escura", stroke: { color: T.line, width: 1 },
      children: [
        box(24, 20, 404, 80, "#272D45", {
          radius: 10, href: "/docs/links", name: "cartão com href", stroke: { color: "#313A5C", width: 1 },
          children: [text(18, 14, 368, "Guia de links no texto", "#EEF0F7", 16, { weight: 600, on: "#272D45" }), text(18, 42, 368, "Cor herdada, sublinhado e blocos clicáveis", "#C9CED9", 13, { on: "#272D45" })],
        }),
      ],
    }));
    const r2 = ratio("#C9CED9", "#272D45");
    pn.kids.push(...metaLine(col(1), stripY + 132, 452, `texto #C9CED9 sobre #272D45 · ${fmt(r2)}:1`, r2 >= AA));
    contrastRows.push({ theme: p, fundo: "bloco · cartão no escuro", bg: "#272D45", texto: "#C9CED9", antes: null, depois: r2 });
    // 3: botão amarelo sobre branco
    pn.kids.push(text(col(2), labelY, 452, "Botão amarelo da marca", T.fg, 15, { weight: 600, on: T.panel }));
    pn.kids.push(box(col(2), stripY, 452, 120, "#FFFFFF", {
      radius: 10, clip: true, name: "bloco · faixa branca", stroke: { color: T.line, width: 1 },
      children: [box(24, 38, 220, 44, T.yellow, { radius: 8, href: "https://paprika.dev", name: "botão amarelo com href", children: [text(0, 11, 220, "Abrir o Paprika", "#2A1A14", 15, { weight: 600, align: "center", on: T.yellow })] })],
    }));
    const r3 = ratio("#2A1A14", T.yellow);
    pn.kids.push(...metaLine(col(2), stripY + 132, 452, `texto #2A1A14 sobre ${T.yellow} · ${fmt(r3)}:1`, r3 >= AA));
    contrastRows.push({ theme: p, fundo: "bloco · botão amarelo", bg: T.yellow, texto: "#2A1A14", antes: null, depois: r3 });
    y = finishPanel(pn) + 24;
  }

  // ----- anatomia -----
  const anat = {};
  {
    const SZ = 240;
    const baseline = Math.round(0.864 * SZ * 10) / 10;
    const off = 0.15 * SZ;
    const th = Math.max(1, 0.06 * SZ);
    const stripH = 300;
    const pn = panel(y, 100 + stripH + 32, "Anatomia do sublinhado", "Medidas em em, relativas ao tamanho da fonte do trecho: o sublinhado escala com o texto.", "anatomia");
    const top = 24;
    const zone = [];
    zone.push(text(40, top, 700, "Link", T.fg, SZ, { weight: 400, lh: 1, hug: true, id: `lk-${p}-anat-word` }));
    const by = top + baseline;
    const uy = by + off;
    zone.push(rect(24, by, 880, 1, T.muted, { id: `lk-${p}-anat-base` }));
    zone.push(text(780, by - 22, 120, "linha de base", T.muted, 12, { lh: 1.2, on: T.strip }));
    zone.push(rect(40, uy, 560, th, T.fg, { id: `lk-${p}-anat-ul` }));
    const mx = 610;
    zone.push(rect(mx, by, 2, off, T.ring), rect(mx - 6, by, 14, 1, T.ring), rect(mx - 6, uy, 14, 1, T.ring));
    zone.push(text(mx + 18, by + off / 2 - 10, 360, `deslocamento 0,15em = ${(off).toFixed(0)} px`, T.fg, 14, { weight: 600, lh: 1.4, on: T.strip }));
    zone.push(rect(mx, uy, 2, th, T.ring), rect(mx - 6, uy + th, 14, 1, T.ring));
    zone.push(text(mx + 18, uy + th / 2 - 10, 460, `espessura max(1px, 0,06em) = ${th.toFixed(1).replace(".", ",")} px`, T.fg, 14, { weight: 600, lh: 1.4, on: T.strip }));
    pn.kids.push(box(32, 100, 940, stripH, T.strip, { radius: 10, clip: true, name: "anatomia · zona", stroke: { color: T.line, width: 1 }, children: zone }));
    // tabela de valores
    const tx = 1004;
    pn.kids.push(text(tx, 100, 380, "Valores por tamanho", T.fg, 15, { weight: 600, on: T.panel }));
    const head = ["fonte", "deslocamento", "espessura"];
    const cx = [tx, tx + 80, tx + 220];
    head.forEach((h, i) => pn.kids.push(text(cx[i], 134, 160, h, T.muted, 13, { weight: 600, on: T.panel })));
    [12, 16, 24, 32, 48, 96].forEach((s, i) => {
      const ry = 166 + i * 34;
      const t = Math.max(1, 0.06 * s);
      pn.kids.push(rect(tx, ry - 6, 404, 1, T.line));
      pn.kids.push(text(cx[0], ry, 70, `${s} px`, T.fg, 14, { on: T.panel }));
      pn.kids.push(text(cx[1], ry, 130, `${(0.15 * s).toFixed(2).replace(".", ",")} px`, T.fg, 14, { on: T.panel }));
      pn.kids.push(text(cx[2], ry, 150, `${t.toFixed(2).replace(".", ",")} px`, T.fg, 14, { on: T.panel }));
    });
    pn.kids.push(text(tx, 166 + 6 * 34 + 6, 404, "Abaixo de 17 px a espessura é o piso de 1 px; acima disso vale 0,06em.", T.muted, 13, { lh: 1.45, on: T.panel }));
    y = finishPanel(pn) + 24;
    anat.top = top;
  }

  // ----- editor: campo de link da barra de texto -----
  {
    const pn = panel(y, 410, "Campo de link da barra de texto", "Estados do campo no editor. Desenhado com os tokens de apps/web/src/styles.css: o guia da marca não traz componente de campo ou botão para instanciar.", "editor");
    const W = 337;
    const states = [
      { name: "Vazio", note: "Aplicar fica desativado até haver endereço." },
      { name: "Preenchido, com foco", note: "Anel de foco de 2 px na cor de seleção; Enter aplica." },
      { name: "Endereço inválido", note: "Borda e mensagem em vermelho; a mensagem fica ligada ao campo por aria-describedby." },
      { name: "Link aplicado", note: "O campo mostra o endereço; Abrir e Remover link ficam à mão." },
    ];
    states.forEach((s, i) => {
      const x = 32 + i * (W + 20);
      pn.kids.push(text(x, 100, W, s.name, T.fg, 15, { weight: 600, on: T.panel }));
      const kids = [];
      kids.push(text(16, 14, 265, "Endereço do link", T.muted, 12, { weight: 600, lh: 1.3, on: T.popover }));
      const val = i === 0 ? "https://… ou /caminho" : i === 2 ? "paprika ponto dev" : "https://paprika.dev/docs";
      const col = i === 0 ? T.muted : T.fg;
      if (i === 0) chk(T.muted, T.fieldBg, AA, "placeholder");
      else chk(T.fg, T.fieldBg, AA, "valor do campo");
      const strokeC = i === 1 ? T.ring : i === 2 ? T.redInk : T.field;
      const strokeW = i === 1 || i === 2 ? 2 : 1;
      if (i === 1) chk(T.ring, T.popover, 3, "anel de foco");
      if (i === 2) chk(T.redInk, T.fieldBg, AA, "erro");
      kids.push(box(16, 36, 265, 36, T.fieldBg, { radius: 6, stroke: { color: strokeC, width: strokeW }, name: "campo de link", children: [text(12, 8, 241, val, col, 14, { lh: 1.4 })] }));
      if (i === 2) kids.push(text(16, 78, 265, "Use http(s), mailto, / ou #", T.redInk, 12, { lh: 1.3, on: T.popover }));
      const by = 100;
      if (i === 3) {
        kids.push(box(16, by, 78, 32, T.popover, { radius: 6, stroke: { color: T.field, width: 1 }, name: "botão Abrir", children: [text(0, 6, 78, "Abrir", T.fg, 13, { weight: 600, align: "center", lh: 1.4, on: T.popover })] }));
        kids.push(box(102, by, 112, 32, T.popover, { radius: 6, stroke: { color: T.field, width: 1 }, name: "botão Remover link", children: [text(0, 6, 112, "Remover link", T.redInk, 13, { weight: 600, align: "center", lh: 1.4, on: T.popover })] }));
        chk(T.redInk, T.popover, AA, "Remover link");
      } else {
        const on = i !== 0;
        kids.push(box(16, by, 92, 32, on ? T.action : T.surface, { radius: 6, name: on ? "botão Aplicar" : "botão Aplicar desativado", children: [text(0, 6, 92, "Aplicar", on ? T.onAction : T.muted, 13, { weight: 600, align: "center", lh: 1.4 })] }));
        if (on) chk(T.onAction, T.action, AA, "Aplicar");
        kids.push(box(116, by, 92, 32, T.popover, { radius: 6, stroke: { color: T.field, width: 1 }, name: "botão Cancelar", children: [text(0, 6, 92, "Cancelar", T.fg, 13, { weight: 600, align: "center", lh: 1.4, on: T.popover })] }));
      }
      pn.kids.push(box(x, 128, W, 188, T.strip, {
        radius: 10, clip: true, name: `editor · ${s.name}`, stroke: { color: T.line, width: 1 },
        children: [box(20, 20, 297, 148, T.popover, { radius: 10, stroke: { color: T.line, width: 1 }, shadow: { x: 0, y: 8, blur: 24, spread: 0, color: p === "escuro" ? "#00000073" : "#2A1A1429" }, name: "popover", children: kids })],
      }));
      pn.kids.push(text(x, 326, W, s.note, T.muted, 13, { lh: 1.45, on: T.panel }));
    });
    y = finishPanel(pn) + 24;
  }

  // ----- rodapé -----
  nodes.push(
    text(
      64, y + 4, 1472,
      "Simulado até a regra entrar no renderizador: nos exemplos “depois”, o trecho leva href e cor explícita igual à do texto, e o sublinhado é o do renderizador atual (deslocamento e espessura padrão do navegador); a anatomia usa linhas desenhadas com as medidas da regra. Campos e botões do editor seguem os tokens do app, não componentes.",
      T.muted, 13, { lh: 1.5, on: T.bg },
    ),
  );
  const H = y + 4 + 60;
  return {
    type: "frame", id: `lk-${p}`, name: `Links no texto · proposta · ${p}`, x: ox, y: 0, width: 1600, height: H, fill: T.bg, clip: true,
    scaledMock: false, children: nodes,
  };
}

// ---------- execução ----------
const ws = JSON.parse(textOf(await call("list_workspaces", {})));
let wsId = (ws.workspaces ?? ws).find((w) => w.name === args.workspace)?.id;
if (!wsId) {
  wsId = JSON.parse(textOf(await call("create_workspace", { name: args.workspace }))).workspace.id;
  console.log("workspace criado", wsId);
} else console.log("workspace existente", wsId);
const pageId = JSON.parse(textOf(await call("create_page", { workspaceId: wsId, name: "Links", ensure: true }))).page;
await call("delete_nodes", { workspaceId: wsId, ids: ["lk-escuro", "lk-claro"] }, { soft: true });

const boards = [build(THEMES.escuro, 0), build(THEMES.claro, 1760)];
await call("create_nodes", { workspaceId: wsId, parentId: pageId, place: "none", label: "Links no texto · proposta", nodes: boards });

// largura real da palavra da anatomia -> sublinhado do mesmo tamanho
for (const p of ["escuro", "claro"]) {
  const b = JSON.parse(textOf(await call("get_bounds", { workspaceId: wsId, ids: [`lk-${p}-anat-word`] })));
  const w = b.boxes?.[`lk-${p}-anat-word`]?.width;
  if (w) await call("update_nodes", { workspaceId: wsId, updates: [{ id: `lk-${p}-anat-ul`, width: Math.round(w) }] }, { soft: true });
  console.log("palavra", p, w);
}

const lint = await call("lint_design", { workspaceId: wsId, rootIds: ["lk-escuro", "lk-claro"], minSeverity: "warning", maxIds: 6 });
console.log(textOf(lint).slice(0, 3000));

if (args.out) {
  await mkdir(args.out, { recursive: true });
  for (const p of ["escuro", "claro"]) {
    const r = await call("render_screenshot", { workspaceId: wsId, rootId: `lk-${p}`, scale: 2 });
    const img = (r.content ?? []).find((c) => c.type === "image");
    if (!img) throw new Error(`sem imagem para ${p}: ${textOf(r).slice(0, 300)}`);
    const file = join(args.out, `links-proposta-${p}.png`);
    await writeFile(file, Buffer.from(img.data, "base64"));
    console.log("gravado", file);
  }
}

if (args.contrast) {
  const L = [];
  L.push("# Links no texto: contraste (WCAG 2.x, texto normal, AA = 4,5:1)", "");
  L.push("Razão calculada pela fórmula de luminância relativa do WCAG 2.x (sRGB), truncada na segunda casa (nunca arredondada para cima).", "");
  for (const p of ["escuro", "claro"]) {
    const T = THEMES[p];
    L.push(`## Tema ${p} (vermelho de ação ${T.action}, texto do app ${T.fg})`, "");
    L.push("| Fundo | Cor do texto / link | Antes: #0000EE | Depois: cor do texto | Antes | Depois |", "|---|---|---|---|---|---|");
    for (const r of contrastRows.filter((x) => x.theme === p)) {
      const b = r.antes == null ? "n/a" : `${fmt(r.antes)}:1`;
      const bs = r.antes == null ? "" : r.antes >= AA ? "passa AA" : "falha AA";
      L.push(`| ${r.fundo} (${r.bg}) | ${r.texto} | ${b} | ${fmt(r.depois)}:1 | ${bs || "n/a"} | ${r.depois >= AA ? "passa AA" : "falha AA"} |`);
    }
    L.push("");
  }
  await mkdir(dirname(args.contrast), { recursive: true });
  await writeFile(args.contrast, L.join("\n"));
  console.log("gravado", args.contrast);
}
await client.close();
