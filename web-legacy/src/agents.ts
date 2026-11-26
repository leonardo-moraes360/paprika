import { isRootFrame, type Document, type PageNode } from "@paprika/core";

export interface PresenceMsg {
  type: "presence";
  agent: string;
  actor: string;
  tool: string;
  nodes: string[];
  idle: number;
}

export interface AgentPresence {
  agent: string;
  actor: string;
  name: string;
  color: string;
  tool: string;
  nodes: string[];
  at: number;
}

export const AGENT_IDLE_MS = 15_000;
export const AGENT_TTL_MS = 120_000;

export const AGENT_COLORS = ["#3b82f6", "#10b981", "#9645f0", "#f59e0b", "#ec4899", "#5b5ef0", "#84cc16", "#a16207"];

const NIGHT = "#141827";

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

export function agentInk(color: string): string {
  return contrast("#ffffff", color) >= contrast(NIGHT, color) ? "#ffffff" : NIGHT;
}

const baseName = (actor: string) => actor.replace(/^agent:/, "") || "agente";

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
  edit_path: "editando ponto",
  render_screenshot: "olhando",
  lint_design: "revisando",
  export_code: "exportando",
  get_history: "lendo o histórico",
  undo: "desfazendo",
  redo: "refazendo",
};

export const toolVerb = (tool: string) => VERBS[tool] ?? tool;

export const ROSTER_HIDE_IDLE_MS = 60_000;

const READ_TOOLS = new Set([
  "get_nodes",
  "find_nodes",
  "get_document_outline",
  "get_design_guide",
  "path_info",
  "render_screenshot",
  "lint_design",
  "export_code",
  "get_history",
  "list_workspaces",
  "get_selection",
  "export_image",
]);

export function toolActivity(tool: string): "writing" | "reading" {
  if (READ_TOOLS.has(tool) || /^(get_|find_|list_|lint_|export_|render_)/.test(tool)) return "reading";
  return "writing";
}

export function agentActive(agent: AgentPresence, now: number): boolean {
  return now - agent.at <= AGENT_IDLE_MS;
}

export function byBusyness(list: AgentPresence[]): AgentPresence[] {
  return [...list].sort((a, b) => {
    const rank = (agent: AgentPresence) => (toolActivity(agent.tool) === "writing" ? 0 : 1);
    const delta = rank(a) - rank(b);
    return delta || b.at - a.at;
  });
}

export function clientGroups(list: AgentPresence[]): { actor: string; label: string; agents: AgentPresence[] }[] {
  const order: string[] = [];
  const map = new Map<string, AgentPresence[]>();
  for (const agent of list) {
    const hit = map.get(agent.actor);
    if (hit) hit.push(agent);
    else {
      order.push(agent.actor);
      map.set(agent.actor, [agent]);
    }
  }
  return order.map((actor) => {
    const grouped = map.get(actor)!;
    return { actor, label: (grouped[0]?.name ?? "agente").replace(/ \d+$/, ""), agents: grouped };
  });
}

export const BUILD_STEP_MS = 120;
export const BUILD_TICK_MS = 40;
export const BUILD_WALK_CAP_MS = 2000;

export interface BuildReplay {
  actor: string;
  ids: string[];
  index: number;
  stepMs: number;
  stride: number;
  nextAt: number;
}

export function buildPace(remaining: number): { stepMs: number; stride: number } {
  if (remaining * BUILD_STEP_MS <= BUILD_WALK_CAP_MS) return { stepMs: BUILD_STEP_MS, stride: 1 };
  const slots = Math.floor(BUILD_WALK_CAP_MS / BUILD_TICK_MS);
  return { stepMs: BUILD_TICK_MS, stride: Math.ceil(remaining / slots) };
}

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function createdInOrder(prev: Document | null, next: Document): string[] {
  if (!prev || prev.id !== next.id) return [];
  const out: string[] = [];
  const walk = (id: string) => {
    const node = next.nodes[id];
    if (!node) return;
    if (!prev.nodes[id] && node.type !== "page") out.push(id);
    if ("children" in node) for (const child of node.children) walk(child);
  };
  for (const id of next.rootIds) walk(id);
  return out;
}

export function topFrameId(doc: Document, nodeId: string): string | undefined {
  let current = doc.nodes[nodeId];
  let frame: string | undefined;
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    if (current.type === "frame") {
      frame = current.id;
      if (isRootFrame(doc, current)) return current.id;
    }
    current = current.parentId ? doc.nodes[current.parentId] : undefined;
  }
  return frame;
}

export function appendBuild(list: BuildReplay[], actor: string, created: readonly string[], now: number): BuildReplay[] {
  if (!created.length) return list;
  const prev = list.find((w) => w.actor === actor);
  const have = new Set(prev?.ids);
  const fresh = created.filter((id) => !have.has(id));
  if (!fresh.length) return list;
  const ids = prev ? [...prev.ids, ...fresh] : fresh;
  const index = prev ? prev.index : 0;
  const pace = buildPace(ids.length - index);
  const walk: BuildReplay = { actor, ids, index, ...pace, nextAt: prev ? prev.nextAt : now + pace.stepMs };
  return prev ? list.map((w) => (w === prev ? walk : w)) : [...list, walk];
}

export function stepBuild(list: BuildReplay[], now: number): BuildReplay[] {
  if (!list.length) return list;
  const out: BuildReplay[] = [];
  for (const walk of list) {
    if (now < walk.nextAt) {
      out.push(walk);
      continue;
    }
    const steps = Math.floor((now - walk.nextAt) / walk.stepMs) + 1;
    const index = walk.index + steps * walk.stride;
    if (index >= walk.ids.length) continue;
    out.push({ ...walk, index, nextAt: walk.nextAt + steps * walk.stepMs });
  }
  return out;
}

export function agentPage(doc: Document, nodes: string[]): PageNode | undefined {
  for (const id of nodes) {
    let n = doc.nodes[id];
    while (n?.parentId) n = doc.nodes[n.parentId];
    if (n?.type === "page") return n;
  }
  return undefined;
}
