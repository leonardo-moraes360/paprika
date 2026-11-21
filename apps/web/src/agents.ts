/** Presença dos agentes no canvas (mensagens `presence` do servidor). Puro: testável sem DOM. */

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

/** Cores distintas entre si e do acento da marca, legíveis com texto branco. */
export const AGENT_COLORS = ["#3b82f6", "#10b981", "#a855f7", "#f59e0b", "#ec4899", "#6366f1", "#84cc16", "#a16207"];

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
