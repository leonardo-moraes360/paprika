/** Presença dos agentes no canvas (mensagens `presence` do servidor). Puro: testável sem DOM. */

import type { Document, PageNode } from "@paprika/core";

export interface PresenceMsg {
  type: "presence";
  agent: string;
  actor: string;
  tool: string;
  nodes: string[];
  idle: number;
}

export interface AgentPresence {
  /** Chave estável do agente (sessão MCP ou ator). */
  agent: string;
  actor: string;
  /** Nome mostrado no cursor ("claude-code", "claude-code 2" quando dois têm o mesmo nome). */
  name: string;
  color: string;
  tool: string;
  /** Últimos nós em que o agente agiu (uma chamada sem nós mantém os anteriores). */
  nodes: string[];
  /** Quando a última chamada aconteceu (relógio local). */
  at: number;
}

/** Depois disso o cursor fica esmaecido; depois do TTL some (o servidor também para de repetir). */
export const AGENT_IDLE_MS = 15_000;
export const AGENT_TTL_MS = 120_000;

/**
 * Cores distintas entre si e do acento da marca. O texto sobre cada uma é o de `agentInk` (branco ou o fundo
 * noturno), e todas passam de 4,5:1 com ele (WCAG 1.4.3 AA); roxo e índigo foram escurecidos para isso.
 */
export const AGENT_COLORS = ["#3b82f6", "#10b981", "#9645f0", "#f59e0b", "#ec4899", "#5b5ef0", "#84cc16", "#a16207"];

const NIGHT = "#141827";

/** Luminância relativa (WCAG) de uma cor #rrggbb. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/** Razão de contraste entre duas cores #rrggbb. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/** Cor do texto sobre a cor de um agente: branco ou o fundo noturno, o que contrastar mais. */
export function agentInk(color: string): string {
  return contrast("#ffffff", color) >= contrast(NIGHT, color) ? "#ffffff" : NIGHT;
}

const baseName = (actor: string) => actor.replace(/^agent:/, "") || "agente";

/** Aplica uma mensagem de presença à lista (ordem de chegada; cor e nome fixos por agente). */
export function applyPresence(list: AgentPresence[], msg: PresenceMsg, now = Date.now()): AgentPresence[] {
  const at = now - Math.max(0, msg.idle || 0);
  const live = list.filter((a) => now - a.at < AGENT_TTL_MS || a.agent === msg.agent);
  const prev = live.find((a) => a.agent === msg.agent);
  if (prev) {
    return live.map((a) => (a === prev ? { ...a, tool: msg.tool, nodes: msg.nodes.length ? msg.nodes : a.nodes, at: Math.max(a.at, at) } : a));
  }
  const base = baseName(msg.actor);
  const same = live.filter((a) => a.actor === msg.actor).length;
  const used = new Set(live.map((a) => a.color));
  const color = AGENT_COLORS.find((c) => !used.has(c)) ?? AGENT_COLORS[live.length % AGENT_COLORS.length]!;
  return [...live, { agent: msg.agent, actor: msg.actor, name: same ? `${base} ${same + 1}` : base, color, tool: msg.tool, nodes: msg.nodes, at }];
}

const VERBS: Record<string, string> = {
  create_nodes: "criando",
  update_nodes: "editando",
  apply_ops: "editando",
  delete_nodes: "apagando",
  move_nodes: "movendo",
  group_nodes: "agrupando",
  ungroup_nodes: "desagrupando",
  align_nodes: "alinhando",
  distribute_nodes: "distribuindo",
  wrap_nodes: "envolvendo",
  show_all: "mostrando",
  unlock_all: "destravando",
  create_page: "criando página",
  create_component: "criando componente",
  create_instance: "instanciando",
  detach_instance: "desanexando",
  set_tokens: "ajustando tokens",
  import_svg: "importando SVG",
  import_html: "importando HTML",
  get_nodes: "lendo",
  find_nodes: "procurando",
  get_document_outline: "lendo o documento",
  get_design_guide: "lendo o guia",
  path_info: "medindo caminho",
  render_screenshot: "olhando",
  lint_design: "revisando",
  export_code: "exportando",
  get_history: "lendo o histórico",
  undo: "desfazendo",
  redo: "refazendo",
};

/** Rótulo curto do que o agente está fazendo. */
export const toolVerb = (tool: string) => VERBS[tool] ?? tool;

/** Página dos últimos nós do agente (a do primeiro que ainda existe); undefined num documento sem páginas. */
export function agentPage(doc: Document, nodes: string[]): PageNode | undefined {
  for (const id of nodes) {
    let n = doc.nodes[id];
    while (n?.parentId) n = doc.nodes[n.parentId];
    if (n?.type === "page") return n;
  }
  return undefined;
}
