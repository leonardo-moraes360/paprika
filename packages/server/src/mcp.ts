import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  NodeInputSchema,
  copyId,
  importHTML,
  importSVG,
  type ImportResult,
  isContainer,
  type NodeInput,
  NodeType,
  newId,
  ungroupOps,
  parsePath,
  pathBounds,
  serializePath,
  Op,
  OpError,
  exportReact,
  lintDocument,
  outline,
  queryNodes,
  renderHTML,
  type Op as OpT,
} from "@paprika/core";
import type { DocumentStore } from "./store.js";
import { screenshot, svgExport } from "./screenshot.js";

export const VERSION = "0.1.0";

export const DESIGN_GUIDE = `# Paprika: guia para agentes

Documento = mapa plano de nós + rootIds (telas/frames de topo, em coordenadas do canvas).
Tipos: frame (contêiner com estilo e layout), group (agrupa sem pintar), page (canvas separado), rect, ellipse,
text, image, path (vetor com curvas bezier). Só frame, group e page têm filhos.

Campos comuns: name, x, y, width, height (número | "hug" | "fill"), rotation, opacity (0..1),
visible, locked, fill (cor), stroke {color,width}, radius, shadow {x,y,blur,spread,color}, notes.
frame: clip (bool), layout {mode: none|row|column, gap, padding (n | [t,r,b,l]), align: start|center|end|stretch,
  justify: start|center|end|between, wrap}. Com layout row/column, x/y dos filhos são ignorados.
text: text, color, fontFamily, fontSize (n | "$token"), fontWeight (100..900), lineHeight, letterSpacing, textAlign.
image: src (https:// ou data:image/), fit (cover|contain|fill), alt.
group: name, x, y, opacity, visible, locked, notes, children. A caixa (x, y, width, height) é calculada a partir
  dos filhos ao fim de cada escrita; coordenadas dos filhos são relativas ao grupo. Use group_nodes/ungroup_nodes.
page: name, fill (fundo do canvas), notes, children. Só no topo; com páginas, todo nó de topo é página e os
  frames vão em parentId = id da página (coordenadas do canvas). create_page cria a primeira já levando o
  conteúdo atual para "Página 1". Telas de outra página: get_document_outline {rootId: id da página}.
Componentes: um frame com component: true é um componente (create_component). Uma instância é um frame com
  instanceOf = id do componente e scale opcional (create_instance): os filhos são cópias geradas, com ids
  derivados e sourceId = id do nó de origem; mudar o componente muda todas as instâncias. Numa cópia, update só
  troca fill, color, text, src, alt, visible e opacity (vira override da instância; null volta ao componente);
  na raiz, fill vira override e width/height/layout/stroke/radius/shadow/clip vêm do componente (use scale).
  Cópias não podem ser movidas, apagadas nem receber filhos: edite o componente ou detach_instance.
path: d (dados de caminho SVG: M L H V C S Q T A Z, absolutos ou relativos), fill (preenchimento; sem fill = vazado),
  stroke {color,width} (traço), fillRule (nonzero|evenodd), strokeCap (butt|round|square), strokeJoin (miter|round|bevel),
  viewBox [x,y,w,h] opcional. Sem viewBox, as coordenadas de d são px a partir do canto (x,y) do nó; com viewBox,
  o desenho é escalado para caber em width×height (bom para ícones num grid 24×24). Sem width/height, o nó
  ganha a caixa do desenho. Curvas: "C c1x c1y c2x c2y x y" (cúbica), "Q cx cy x y" (quadrática), S/T espelham
  o controle anterior (curvas suaves). Use path_info para conferir bounds antes de posicionar.

Cores: #hex, rgb(), rgba() ou "$token" (ver set_tokens). Prefira tokens para cores e tamanhos recorrentes.
Modos de tema: set_tokens com mode ("dark", "compact"…) grava só os tokens que mudam; "mode" num frame ou página aplica o modo ao subtree (dá para pôr a mesma tela clara e escura lado a lado). export_code com cssVariables: true sai com var(--token) e uma regra por modo.
"fill" em width/height ocupa o espaço restante no eixo principal do pai com layout, ou estica no eixo cruzado.

Fluxo recomendado:
1. get_document_outline para se orientar (barato).
2. set_tokens com a paleta e a escala tipográfica.
3. create_nodes com árvores aninhadas (children) numa só chamada; prefira frames com layout a posicionamento absoluto.
4. lint_design e corrija o que vier como error/warning.
5. render_screenshot para conferir visualmente; export_code para levar ao código.
Para trazer um ícone ou um trecho de página pronto, use import_svg ou import_html (viram nós editáveis); export_code com format "svg" devolve SVG vetorial.
Toda escrita é atômica (tudo ou nada) e pode ser desfeita com undo. O humano vê suas edições ao vivo no canvas.
Campos desconhecidos são rejeitados com erro: leia a mensagem e ajuste.`;

const text = (s: string): CallToolResult => ({ content: [{ type: "text", text: s }] });
const json = (v: unknown): CallToolResult => text(JSON.stringify(v, null, 2));

function fail(e: unknown): CallToolResult {
  const msg = e instanceof OpError || e instanceof Error ? e.message : String(e);
  return { isError: true, content: [{ type: "text", text: msg }] };
}

function guard(fn: () => Promise<CallToolResult> | CallToolResult): Promise<CallToolResult> {
  return Promise.resolve()
    .then(fn)
    .catch((e: unknown) => fail(e));
}

const NodeInputArray = z.array(NodeInputSchema).min(1).max(500);

export interface McpOptions {
  /** Identifica o agente no histórico (ex.: "agent:claude"). */
  actor?: string;
}

/** Cria o servidor MCP do Paprika sobre um DocumentStore. Uma instância por conexão/sessão. */
export function createMcpServer(store: DocumentStore, opts: McpOptions = {}): McpServer {
  const actor = opts.actor ?? "agent";
  const server = new McpServer({ name: "paprika", version: VERSION }, { instructions: DESIGN_GUIDE });

  // Só responde ao agente depois que a transação está no disco.
  const write = async (ops: OpT[], label: string) => {
    const r = store.apply(ops, actor, label);
    await store.flush();
    return { created: r.created, version: store.version };
  };

  server.registerTool(
    "get_design_guide",
    { title: "Guia do formato", description: "Explica o modelo de nós, campos aceitos e o fluxo recomendado. Leia antes da primeira edição.", annotations: { readOnlyHint: true } },
    () => text(DESIGN_GUIDE),
  );

  server.registerTool(
    "get_document_outline",
    {
      title: "Estrutura do documento",
      description: "Árvore compacta (uma linha por nó: tipo#id, nome, tamanho, posição, estilo-chave), tokens e versão. Barato em tokens.",
      inputSchema: {
        rootId: z.string().optional().describe("Só a subárvore deste nó"),
        depth: z.number().int().min(0).max(50).optional().describe("Profundidade máxima (0 = só o nó)"),
      },
      annotations: { readOnlyHint: true },
    },
    ({ rootId, depth }) =>
      guard(() => {
        const d = store.doc;
        if (rootId && !d.nodes[rootId]) throw new Error(`nó "${rootId}" não existe`);
        const tokens = Object.entries(d.tokens)
          .map(([k, v]) => `$${k}=${v}`)
          .join(" ");
        const modes = Object.entries(d.modes ?? {})
          .map(([m, t]) => `${m}(${Object.entries(t).map(([k, v]) => `$${k}=${v}`).join(" ")})`)
          .join(" ");
        return text(
          `documento "${d.name}" v${store.version} · ${Object.keys(d.nodes).length} nós\n` +
            `tokens: ${tokens || "(nenhum)"}\n${modes ? `modos: ${modes}\n` : ""}\n${outline(d, { rootId, depth })}`,
        );
      }),
  );

  server.registerTool(
    "get_nodes",
    {
      title: "Ler nós",
      description: "Retorna o JSON completo dos nós pedidos (todos os campos, com defaults).",
      inputSchema: { ids: z.array(z.string()).min(1).max(200) },
      annotations: { readOnlyHint: true },
    },
    ({ ids }) =>
      guard(() => {
        const missing = ids.filter((id) => !store.doc.nodes[id]);
        if (missing.length) throw new Error(`nós inexistentes: ${missing.join(", ")}`);
        return json(ids.map((id) => store.doc.nodes[id]));
      }),
  );

  server.registerTool(
    "find_nodes",
    {
      title: "Buscar nós",
      description: "Busca por tipo, substring do nome ou do texto, opcionalmente dentro de uma subárvore.",
      inputSchema: {
        type: NodeType.optional(),
        name: z.string().optional(),
        text: z.string().optional(),
        within: z.string().optional(),
        limit: z.number().int().min(1).max(500).default(50),
      },
      annotations: { readOnlyHint: true },
    },
    (q) => guard(() => text(queryNodes(store.doc, q).map((n) => outline(store.doc, { rootId: n.id, depth: 0 }).split("\n")[0]).join("\n") || "(nada encontrado)")),
  );

  server.registerTool(
    "path_info",
    {
      title: "Geometria de um caminho",
      description:
        "Valida dados de caminho SVG (d) e devolve a caixa exata do desenho (inclui extremos das curvas bezier e arcos), o número de segmentos e o d normalizado em comandos absolutos. Passe `d` ou o `id` de um nó path.",
      inputSchema: {
        d: z.string().max(200_000).optional(),
        id: z.string().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    ({ d, id }) =>
      guard(() => {
        let src = d;
        let origin = { x: 0, y: 0 };
        if (id) {
          const n = store.doc.nodes[id];
          if (!n) throw new Error(`nó "${id}" não existe`);
          if (n.type !== "path") throw new Error(`nó "${id}" é ${n.type}, não path`);
          src = n.d;
          origin = { x: n.x, y: n.y };
        }
        if (!src) throw new Error("passe d ou id");
        const segs = parsePath(src);
        const b = pathBounds(segs);
        const round = (v: number) => Math.round(v * 100) / 100;
        return json({
          segments: segs.length,
          curves: segs.filter((s) => s.cmd === "C" || s.cmd === "Q" || s.cmd === "A").length,
          closed: segs.some((s) => s.cmd === "Z"),
          bounds: { x: round(b.x), y: round(b.y), width: round(b.width), height: round(b.height) },
          ...(id ? { canvasBounds: { x: round(origin.x + b.x), y: round(origin.y + b.y), width: round(b.width), height: round(b.height) } } : {}),
          normalized: serializePath(segs),
        });
      }),
  );

  server.registerTool(
    "create_nodes",
    {
      title: "Criar nós",
      description:
        "Cria um ou mais nós (com children aninhados em frames) sob parentId (null/omitido = canvas). Atômico. Retorna os ids criados na ordem.",
      inputSchema: {
        parentId: z.string().nullable().optional(),
        index: z.number().int().min(0).optional().describe("Posição entre os irmãos; padrão: no fim"),
        nodes: NodeInputArray,
        label: z.string().max(200).optional().describe("Descrição curta para o histórico"),
      },
    },
    ({ parentId, index, nodes, label }) =>
      guard(async () => {
        const ops: OpT[] = nodes.map((node, i) => ({
          op: "create",
          node,
          parentId: parentId ?? null,
          ...(index !== undefined ? { index: index + i } : {}),
        }));
        return json(await write(ops, label ?? `criar ${nodes.length} nó(s)`));
      }),
  );

  server.registerTool(
    "update_nodes",
    {
      title: "Alterar nós",
      description: "Altera campos de vários nós numa transação atômica. null remove o campo. Objetos (layout, stroke, shadow) são substituídos inteiros.",
      inputSchema: {
        updates: z.array(z.object({ id: z.string(), props: z.record(z.string(), z.unknown()) })).min(1).max(500),
        label: z.string().max(200).optional(),
      },
    },
    ({ updates, label }) =>
      guard(async () => json(await write(updates.map((u) => ({ op: "update", id: u.id, props: u.props })), label ?? `alterar ${updates.length} nó(s)`))),
  );

  server.registerTool(
    "delete_nodes",
    {
      title: "Apagar nós",
      description: "Apaga nós e suas subárvores. Atômico e reversível com undo.",
      inputSchema: { ids: z.array(z.string()).min(1).max(500), label: z.string().max(200).optional() },
      annotations: { destructiveHint: true },
    },
    ({ ids, label }) => guard(async () => json(await write(ids.map((id) => ({ op: "delete", id })), label ?? `apagar ${ids.length} nó(s)`))),
  );

  server.registerTool(
    "move_nodes",
    {
      title: "Mover nós",
      description: "Muda o pai e/ou a ordem de nós (parentId null = canvas). Não altera x/y.",
      inputSchema: {
        moves: z.array(z.object({ id: z.string(), parentId: z.string().nullable(), index: z.number().int().min(0).optional() })).min(1),
        label: z.string().max(200).optional(),
      },
    },
    ({ moves, label }) => guard(async () => json(await write(moves.map((m) => ({ op: "move", ...m })), label ?? `mover ${moves.length} nó(s)`))),
  );

  server.registerTool(
    "group_nodes",
    {
      title: "Agrupar nós",
      description:
        "Põe nós irmãos (mesmo pai, sem layout row/column) num group novo, no lugar do mais alto deles. O desenho não se move: a caixa do grupo segue os filhos. Retorna o id do grupo.",
      inputSchema: {
        ids: z.array(z.string()).min(1).max(500),
        name: z.string().max(200).optional(),
        id: z.string().optional().describe("Id do grupo (padrão: gerado)"),
        label: z.string().max(200).optional(),
      },
    },
    ({ ids, name, id, label }) =>
      guard(async () => {
        const gid = id ?? newId();
        const r = await write([{ op: "group", ids, id: gid, ...(name !== undefined ? { name } : {}) }], label ?? `agrupar ${ids.length} nó(s)`);
        return json({ group: gid, ...r });
      }),
  );

  server.registerTool(
    "ungroup_nodes",
    {
      title: "Desagrupar",
      description: "Desfaz groups: os filhos voltam ao pai do grupo, no lugar dele, com a mesma posição, opacidade e visibilidade.",
      inputSchema: { ids: z.array(z.string()).min(1).max(500), label: z.string().max(200).optional() },
    },
    ({ ids, label }) =>
      guard(async () => {
        const { released } = ungroupOps(store.doc, ids); // valida e diz quais filhos voltam
        const r = await write([{ op: "ungroup", ids }], label ?? `desagrupar ${ids.length} grupo(s)`);
        return json({ released, ...r });
      }),
  );

  server.registerTool(
    "create_page",
    {
      title: "Criar página",
      description:
        "Cria uma página (canvas separado no mesmo arquivo). Na primeira vez, o conteúdo atual vai antes para uma página \"Página 1\". Crie telas nela com create_nodes {parentId: id da página}.",
      inputSchema: {
        name: z.string().max(200).optional(),
        id: z.string().optional().describe("Id da página (padrão: gerado)"),
        label: z.string().max(200).optional(),
      },
    },
    ({ name, id, label }) =>
      guard(async () => {
        const pid = id ?? newId();
        const r = await write([{ op: "add_page", id: pid, ...(name !== undefined ? { name } : {}) }], label ?? "criar página");
        return json({ page: pid, ...r });
      }),
  );

  server.registerTool(
    "create_component",
    {
      title: "Criar componente",
      description:
        "Marca um frame como componente (component: true). Depois, create_instance cria cópias dele que acompanham as mudanças no componente.",
      inputSchema: { id: z.string(), label: z.string().max(200).optional() },
    },
    ({ id, label }) =>
      guard(async () => {
        const r = await write([{ op: "update", id, props: { component: true } }], label ?? "criar componente");
        return json({ component: id, ...r });
      }),
  );

  server.registerTool(
    "create_instance",
    {
      title: "Criar instância",
      description:
        "Cria uma instância de um componente (frame com instanceOf). Por padrão fica no mesmo pai do componente, 40px à direita dele. Retorna o id da instância e, em copies, o id de cada cópia por nó do componente (para overrides com update_nodes).",
      inputSchema: {
        componentId: z.string(),
        parentId: z.string().nullable().optional().describe("Pai da instância (padrão: o pai do componente)"),
        x: z.number().optional(),
        y: z.number().optional(),
        scale: z.number().min(0.01).max(100).optional(),
        name: z.string().max(200).optional(),
        overrides: z.record(z.string(), z.record(z.string(), z.unknown())).optional().describe("{ idDoNóNoComponente: { text: ..., fill: ... } }"),
        id: z.string().optional().describe("Id da instância (padrão: gerado)"),
        label: z.string().max(200).optional(),
      },
    },
    ({ componentId, parentId, x, y, scale, name, overrides, id, label }) =>
      guard(async () => {
        const comp = store.doc.nodes[componentId];
        const iid = id ?? newId();
        const node: Record<string, unknown> = { type: "frame", id: iid, instanceOf: componentId };
        const cx = comp && comp.type !== "page" ? comp.x : 0;
        const cw = comp && comp.type !== "page" && typeof comp.width === "number" ? comp.width : 0;
        node.name = name ?? comp?.name ?? "";
        node.x = x ?? (comp && comp.type !== "page" ? cx + cw + 40 : 0);
        node.y = y ?? (comp && comp.type !== "page" ? comp.y : 0);
        if (scale !== undefined) node.scale = scale;
        if (overrides !== undefined) node.overrides = overrides;
        const parent = parentId !== undefined ? parentId : (comp?.parentId ?? null);
        const r = await write([{ op: "create", parentId: parent, node: node as NodeInput }], label ?? "criar instância");
        const copies: Record<string, string> = {};
        const walk = (nid: string) => {
          const n = store.doc.nodes[nid];
          if (!isContainer(n)) return;
          for (const c of n.children) {
            copies[c] = copyId(iid, c);
            walk(c);
          }
        };
        walk(componentId);
        return json({ instance: iid, copies, ...r });
      }),
  );

  server.registerTool(
    "detach_instance",
    {
      title: "Desanexar instância",
      description: "Transforma instâncias em frames comuns: as cópias viram nós normais (mesmos ids) e param de seguir o componente.",
      inputSchema: { ids: z.array(z.string()).min(1).max(500), label: z.string().max(200).optional() },
    },
    ({ ids, label }) =>
      guard(async () => {
        const r = await write([{ op: "detach", ids }], label ?? `desanexar ${ids.length} instância(s)`);
        return json({ detached: ids, ...r });
      }),
  );

  server.registerTool(
    "apply_ops",
    {
      title: "Transação de operações",
      description:
        "Aplica uma lista mista de operações (create, update, delete, move, set_tokens, rename_document, group, ungroup, add_page, detach) numa única transação atômica.",
      inputSchema: { ops: z.array(Op).min(1).max(1000), label: z.string().max(200).optional() },
    },
    ({ ops, label }) => guard(async () => json(await write(ops as OpT[], label ?? `transação de ${ops.length} op(s)`))),
  );

  server.registerTool(
    "set_tokens",
    {
      title: "Definir tokens",
      description:
        'Cria/atualiza design tokens (cores, tamanhos). Use nos nós como "$nome". null remove. Com `mode`, grava os valores daquele modo de tema (ex.: "dark"), que valem nos frames/páginas com `mode` igual e nos descendentes; tokens que o modo não define usam o valor base.',
      inputSchema: {
        tokens: z.record(z.string(), z.union([z.string(), z.number(), z.null()])),
        mode: z.string().optional().describe("Modo de tema ([A-Za-z0-9_-]{1,40}); sem ele, os tokens base"),
        label: z.string().max(200).optional(),
      },
    },
    ({ tokens, mode, label }) =>
      guard(async () => json(await write([mode ? { op: "set_tokens", tokens, mode } : { op: "set_tokens", tokens }], label ?? "tokens"))),
  );

  server.registerTool(
    "undo",
    { title: "Desfazer", description: "Desfaz a última transação (de qualquer autor: agente ou humano)." },
    () => guard(() => json({ undone: store.undo(actor), version: store.version, canUndo: store.canUndo, canRedo: store.canRedo })),
  );

  server.registerTool(
    "redo",
    { title: "Refazer", description: "Refaz a última transação desfeita." },
    () => guard(() => json({ redone: store.redo(actor), version: store.version, canUndo: store.canUndo, canRedo: store.canRedo })),
  );

  server.registerTool(
    "get_history",
    {
      title: "Histórico",
      description: "Últimas transações (autor, rótulo, horário). Mostra o que o humano mudou no canvas.",
      inputSchema: { limit: z.number().int().min(1).max(200).default(20) },
      annotations: { readOnlyHint: true },
    },
    ({ limit }) => guard(() => json(store.recentHistory(limit))),
  );

  server.registerTool(
    "lint_design",
    {
      title: "Revisar design",
      description: "Checa contraste WCAG AA, tokens inexistentes, overflow, texto pequeno/vazio, imagens sem alt e cores fora dos tokens.",
      inputSchema: { rootId: z.string().optional() },
      annotations: { readOnlyHint: true },
    },
    ({ rootId }) =>
      guard(() => {
        const issues = lintDocument(store.doc, { rootId });
        const counts = { error: 0, warning: 0, info: 0 };
        for (const i of issues) counts[i.severity]++;
        return json({ ok: counts.error === 0, counts, issues });
      }),
  );

  server.registerTool(
    "render_screenshot",
    {
      title: "Screenshot",
      description: "PNG de um nó (uma página: o canvas dela; sem rootId: o canvas, ou a primeira página), renderizado pelo mesmo motor do canvas e do export.",
      inputSchema: { rootId: z.string().optional(), scale: z.number().min(0.1).max(4).default(1) },
      annotations: { readOnlyHint: true },
    },
    ({ rootId, scale }) =>
      guard(async () => {
        const shot = await screenshot(store.doc, { rootId, scale });
        return {
          content: [
            { type: "image", data: shot.png.toString("base64"), mimeType: "image/png" },
            { type: "text", text: `${shot.width}×${shot.height}px` },
          ],
        };
      }),
  );

  server.registerTool(
    "export_code",
    {
      title: "Exportar código",
      description:
        "Exporta um nó como HTML autocontido, componente React (TSX) com estilos inline ou SVG vetorial (svg: o layout é medido num Chromium headless, como no render_screenshot; rootId de página exporta a página).",
      inputSchema: {
        rootId: z.string(),
        format: z.enum(["html", "react", "svg"]).default("react"),
        cssVariables: z
          .boolean()
          .default(false)
          .describe("html/react: tokens como var(--nome), com uma folha de estilos por modo de tema (react exporta tokensCss)"),
      },
      annotations: { readOnlyHint: true },
    },
    ({ rootId, format, cssVariables }) =>
      guard(async () => {
        if (format === "html") return text(renderHTML(store.doc, { rootId, cssVariables }).html);
        if (format === "react") return text(exportReact(store.doc, rootId, { cssVariables }));
        const r = await svgExport(store.doc, rootId);
        const out: CallToolResult = { content: [{ type: "text", text: r.svg }] };
        if (r.warnings.length) out.content.push({ type: "text", text: `avisos: ${r.warnings.join("; ")}` });
        return out;
      }),
  );

  const importInput = {
    parentId: z.string().nullable().optional().describe("Pai dos nós (padrão: topo; num documento com páginas, passe o id da página)"),
    x: z.number().optional(),
    y: z.number().optional(),
    label: z.string().max(200).optional(),
  };
  const importWrite = async (r: ImportResult, parentId: string | null | undefined, label: string) => {
    if (!r.nodes.length) throw new Error(r.warnings.join("; ") || "nada para importar");
    const w = await write(r.nodes.map((node) => ({ op: "create", parentId: parentId ?? null, node }) as OpT), label);
    return json({ ...w, warnings: r.warnings });
  };

  server.registerTool(
    "import_svg",
    {
      title: "Importar SVG",
      description:
        "Converte SVG em nós editáveis: path/rect/circle/ellipse/line/polyline/polygon viram path (ou rect/ellipse sem rotação), <g> vira group; transforms e pintura herdada são aplicados. Texto, imagens, gradientes e CSS em <style> são ignorados e listados em warnings. x/y deslocam a origem do SVG.",
      inputSchema: { svg: z.string().min(1).max(2_000_000), name: z.string().max(200).optional(), ...importInput },
    },
    ({ svg, name, parentId, x, y, label }) =>
      guard(async () => importWrite(importSVG(svg, { x, y, name }), parentId, label ?? "importar SVG")),
  );

  server.registerTool(
    "import_html",
    {
      title: "Importar HTML",
      description:
        "Converte HTML com estilos inline em nós (o inverso do export: o HTML do próprio Paprika volta igual). De outras fontes: display:flex vira layout row/column, blocos viram column, texto vira text, <img> vira image, <svg> passa pelo import_svg. Classes e <style> não são aplicados (warnings).",
      inputSchema: { html: z.string().min(1).max(2_000_000), ...importInput },
    },
    ({ html, parentId, x, y, label }) => guard(async () => importWrite(importHTML(html, { x, y }), parentId, label ?? "importar HTML")),
  );

  return server;
}
