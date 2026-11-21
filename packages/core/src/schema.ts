import { z } from "zod";
import { pathError } from "./path.js";

/** Formato do arquivo `.paprika.json`. Mudanças incompatíveis incrementam a versão. */
export const FORMAT = "paprika/1" as const;

/**
 * Uma cor CSS (`#rrggbb`, `#rrggbbaa`, `rgb()`, `rgba()`, `transparent`) ou uma referência
 * a token no formato `$nome` (resolvida contra `document.tokens`).
 */
export const ColorValue = z
  .string()
  .min(1)
  .max(200)
  .refine((v) => !/[;{}<>]/.test(v), "a color cannot contain ; { } < >");

export const Size = z.union([z.number().min(0).max(100_000), z.enum(["hug", "fill"])]);

export const Stroke = z.object({
  color: ColorValue,
  width: z.number().min(0).max(1000),
});

export const Shadow = z.object({
  x: z.number(),
  y: z.number(),
  blur: z.number().min(0),
  spread: z.number().default(0),
  color: ColorValue,
});

export const Layout = z.object({
  mode: z.enum(["none", "row", "column"]).default("none"),
  gap: z.number().min(0).default(0),
  padding: z
    .union([z.number().min(0), z.tuple([z.number().min(0), z.number().min(0), z.number().min(0), z.number().min(0)])])
    .default(0),
  align: z.enum(["start", "center", "end", "stretch"]).default("start"),
  justify: z.enum(["start", "center", "end", "between"]).default("start"),
  wrap: z.boolean().default(false),
});

const Base = {
  id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, "id must be [A-Za-z0-9_-]{1,64}"),
  name: z.string().max(200).default(""),
  parentId: z.string().nullable().default(null),
  x: z.number().default(0),
  y: z.number().default(0),
  width: Size.default(100),
  height: Size.default(100),
  rotation: z.number().default(0),
  opacity: z.number().min(0).max(1).default(1),
  visible: z.boolean().default(true),
  locked: z.boolean().default(false),
  fill: ColorValue.optional(),
  stroke: Stroke.optional(),
  radius: z.number().min(0).default(0),
  shadow: Shadow.optional(),
  /** Notas livres para humanos e agentes (intenção, restrições, links). */
  notes: z.string().max(4000).optional(),
  /** Só em cópias dentro de uma instância: id do nó do componente de onde a cópia vem (gerado). */
  sourceId: z.string().optional(),
};

/** Overrides de uma instância: por id de nó do componente, os campos trocados (ver component.ts). */
// Chaves no formato de id e de nome de campo (o zod já descarta "__proto__" em records).
/** Nome de um modo de tema (`dark`, `compact`…): conjunto de valores que substituem tokens. */
export const ModeName = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,40}$/, "mode name must be [A-Za-z0-9_-]{1,40}")
  .refine((v) => v !== "__proto__", "mode name cannot be __proto__");

const OverrideSource = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, "id must be [A-Za-z0-9_-]{1,64}");
const OverrideField = z.string().regex(/^[A-Za-z]{1,32}$/, "field must be [A-Za-z]{1,32}");
export const Overrides = z.record(OverrideSource, z.record(OverrideField, z.unknown()));

export const FrameNode = z.object({
  ...Base,
  type: z.literal("frame"),
  children: z.array(z.string()).default([]),
  clip: z.boolean().default(true),
  layout: Layout.optional(),
  /** Este frame é um componente: as instâncias copiam o desenho dele. */
  component: z.boolean().optional(),
  /**
   * Este frame é uma instância do componente `instanceOf`: os filhos são cópias geradas ao fim de
   * cada transação (escaladas por `scale`), e só `overrides` muda o que vem do componente.
   */
  instanceOf: z.string().optional(),
  scale: z.number().min(0.01).max(100).optional(),
  overrides: Overrides.optional(),
  /** Modo de tema deste frame e dos descendentes (tokens de `document.modes[mode]`). */
  mode: ModeName.optional(),
});

export const RectNode = z.object({ ...Base, type: z.literal("rect") });
export const EllipseNode = z.object({ ...Base, type: z.literal("ellipse") });

const TextFontFamily = z
  .string()
  .max(200)
  .refine((v) => !/[;{}<>()]/.test(v), "fontFamily cannot contain ; { } < > ( )")
  .default("Inter, system-ui, sans-serif");

export const TextNode = z.object({
  ...Base,
  type: z.literal("text"),
  text: z.string().max(20_000).default(""),
  color: ColorValue.default("#111111"),
  fontFamily: TextFontFamily,
  fontSize: z.union([z.number().min(1).max(1000), z.string().regex(/^\$[\w.-]+$/)]).default(16),
  fontWeight: z.number().int().min(100).max(900).default(400),
  lineHeight: z.number().min(0).max(10).default(1.4),
  letterSpacing: z.number().default(0),
  textAlign: z.enum(["left", "center", "right"]).default("left"),
});

export const ImageNode = z.object({
  ...Base,
  type: z.literal("image"),
  src: z
    .string()
    .max(5_000_000)
    .refine((v) => /^(https?:|data:image\/)/.test(v), "src must be http(s) or data:image/"),
  fit: z.enum(["cover", "contain", "fill"]).default("cover"),
  alt: z.string().max(1000).default(""),
});

/**
 * Forma vetorial livre: dados de caminho SVG (`d`) com retas, bezier cúbicas (C/S),
 * quadráticas (Q/T) e arcos (A). Coordenadas em px relativas ao canto do nó, ou no espaço
 * de `viewBox` quando ele existe (o desenho é escalado para caber em width × height).
 */
export const PathNode = z.object({
  ...Base,
  type: z.literal("path"),
  d: z
    .string()
    .min(1)
    .max(200_000)
    .superRefine((v, ctx) => {
      const err = pathError(v);
      if (err) ctx.addIssue({ code: "custom", message: `invalid d: ${err}` });
    }),
  fillRule: z.enum(["nonzero", "evenodd"]).default("nonzero"),
  strokeCap: z.enum(["butt", "round", "square"]).default("round"),
  strokeJoin: z.enum(["miter", "round", "bevel"]).default("round"),
  viewBox: z
    .tuple([z.number(), z.number(), z.number().positive(), z.number().positive()])
    .optional(),
});

/** Formas de diagrama: o contorno desenhado por `shape`. `note` é a nota adesiva (canto dobrado). */
export const ShapeKind = z.enum(["rect", "ellipse", "diamond", "note"]);

/**
 * Forma de diagrama com texto dentro (centralizado; numa nota, no topo). O contorno segue `shape`;
 * `fill`, `stroke`, `radius` (só rect/note) e `shadow` pintam o contorno, não a caixa. Ao criar, sem
 * `fill`/`stroke` a forma ganha as cores padrão do tipo. Conectores (`connector`) se prendem nela.
 */
export const ShapeNode = z.object({
  ...Base,
  type: z.literal("shape"),
  width: z.number().min(1).max(100_000).default(160),
  height: z.number().min(1).max(100_000).default(80),
  shape: ShapeKind.default("rect"),
  text: z.string().max(20_000).default(""),
  color: ColorValue.default("#1e2336"),
  fontFamily: TextFontFamily,
  fontSize: z.union([z.number().min(1).max(1000), z.string().regex(/^\$[\w.-]+$/)]).default(16),
  fontWeight: z.number().int().min(100).max(900).default(500),
  lineHeight: z.number().min(0).max(10).default(1.3),
  textAlign: z.enum(["left", "center", "right"]).default("center"),
});

/** Lado de uma forma onde a ponta do conector encosta; `auto` escolhe pelo caminho mais curto. */
export const ConnectorSide = z.enum(["auto", "top", "right", "bottom", "left"]);

/**
 * Ponta de um conector: presa a um nó (`nodeId`, opcionalmente num lado) ou solta num ponto
 * (`x`, `y` no espaço do pai do conector).
 */
export const ConnectorEnd = z.object({
  nodeId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, "nodeId must be [A-Za-z0-9_-]{1,64}").optional(),
  side: ConnectorSide.optional(),
  x: z.number().optional(),
  y: z.number().optional(),
});

/**
 * Seta/linha entre dois nós. `x`, `y`, `width`, `height` e `d` são derivados de `from`/`to` ao fim
 * de cada transação (ver diagram.ts): mover uma forma redesenha os conectores presos a ela.
 */
export const ConnectorNode = z.object({
  id: Base.id,
  name: Base.name,
  parentId: Base.parentId,
  type: z.literal("connector"),
  x: Base.x,
  y: Base.y,
  width: z.number().min(0).default(0),
  height: z.number().min(0).default(0),
  opacity: Base.opacity,
  visible: Base.visible,
  locked: Base.locked,
  notes: Base.notes,
  sourceId: Base.sourceId,
  from: ConnectorEnd,
  to: ConnectorEnd,
  route: z.enum(["straight", "elbow"]).default("straight"),
  startArrow: z.enum(["none", "arrow"]).default("none"),
  endArrow: z.enum(["none", "arrow"]).default("arrow"),
  stroke: Stroke.default({ color: "#1e2336", width: 2 }),
  dashed: z.boolean().default(false),
  /** Gerado: o traçado (linha + pontas) em coordenadas locais. */
  d: z.string().max(10_000).default(""),
});

/**
 * Agrupa nós sem pintar nada: não tem fill/stroke/clip/layout. A caixa (x, y, width, height)
 * é calculada a partir dos filhos ao fim de cada transação (ver `fitGroups` em ops.ts), e as
 * coordenadas dos filhos são relativas ao canto do grupo, como num frame. Sem rotação própria:
 * gire os filhos.
 */
export const GroupNode = z.object({
  id: Base.id,
  name: Base.name,
  parentId: Base.parentId,
  type: z.literal("group"),
  x: Base.x,
  y: Base.y,
  width: z.number().min(0).default(0),
  height: z.number().min(0).default(0),
  opacity: Base.opacity,
  visible: Base.visible,
  locked: Base.locked,
  notes: Base.notes,
  sourceId: Base.sourceId,
  children: z.array(z.string()).default([]),
});

/**
 * Página: um canvas separado dentro do arquivo. Só existe no nível superior (parentId null) e
 * não tem geometria; os filhos usam coordenadas do canvas. Quando o documento tem páginas,
 * todo nó de nível superior precisa ser uma página. `fill` é a cor de fundo do canvas da página.
 */
export const PageNode = z.object({
  id: Base.id,
  name: Base.name,
  parentId: Base.parentId,
  type: z.literal("page"),
  fill: ColorValue.optional(),
  /** Modo de tema da página inteira. */
  mode: ModeName.optional(),
  notes: Base.notes,
  children: z.array(z.string()).default([]),
});

export const Node = z.discriminatedUnion("type", [FrameNode, RectNode, EllipseNode, TextNode, ImageNode, PathNode, GroupNode, PageNode, ShapeNode, ConnectorNode]);

export const NodeType = z.enum(["frame", "rect", "ellipse", "text", "image", "path", "group", "page", "shape", "connector"]);

export const TokenValue = z.union([z.string().max(500), z.number()]);
export const TokenName = z
  .string()
  .regex(/^[\w.-]{1,100}$/, "token name must be [\\w.-]{1,100}")
  .refine((v) => v !== "__proto__", "token name cannot be __proto__");

export const Document = z.object({
  format: z.literal(FORMAT),
  id: z.string(),
  name: z.string().default("Sem título"),
  tokens: z.record(TokenName, TokenValue).default({}),
  /** Modos de tema: por modo, os tokens que mudam (os demais vêm de `tokens`). */
  modes: z.record(ModeName, z.record(TokenName, TokenValue)).optional(),
  /** Ids dos nós de nível superior (normalmente frames/telas), na ordem do canvas. */
  rootIds: z.array(z.string()).default([]),
  nodes: z.record(z.string(), Node).default({}),
});

export type ColorValue = z.infer<typeof ColorValue>;
export type Size = z.infer<typeof Size>;
export type Layout = z.infer<typeof Layout>;
export type FrameNode = z.infer<typeof FrameNode>;
export type RectNode = z.infer<typeof RectNode>;
export type EllipseNode = z.infer<typeof EllipseNode>;
export type TextNode = z.infer<typeof TextNode>;
export type ImageNode = z.infer<typeof ImageNode>;
export type PathNode = z.infer<typeof PathNode>;
export type GroupNode = z.infer<typeof GroupNode>;
export type PageNode = z.infer<typeof PageNode>;
export type ShapeNode = z.infer<typeof ShapeNode>;
export type ConnectorNode = z.infer<typeof ConnectorNode>;
export type ConnectorEnd = z.infer<typeof ConnectorEnd>;
export type ShapeKind = z.infer<typeof ShapeKind>;
/** Nós que aceitam filhos. */
export type ContainerNode = FrameNode | GroupNode | PageNode;
/** Nós desenhados no canvas (tudo menos páginas). */
export type SceneNode = Exclude<Node, PageNode>;
export type Node = z.infer<typeof Node>;
export type NodeType = z.infer<typeof NodeType>;
export type Document = z.infer<typeof Document>;
export type TokenValue = z.infer<typeof TokenValue>;

/** Campos que nenhuma operação `update` pode alterar diretamente. */
export const IMMUTABLE_KEYS = new Set(["id", "type", "parentId", "children"]);

export const NODE_SCHEMAS = {
  frame: FrameNode,
  rect: RectNode,
  ellipse: EllipseNode,
  text: TextNode,
  image: ImageNode,
  path: PathNode,
  group: GroupNode,
  page: PageNode,
  shape: ShapeNode,
  connector: ConnectorNode,
} as const;

export function isContainer(n: Node | undefined): n is ContainerNode {
  return n?.type === "frame" || n?.type === "group" || n?.type === "page";
}

export function isScene(n: Node | undefined): n is SceneNode {
  return !!n && n.type !== "page";
}

/** Primeira página do documento (o documento tem páginas quando o primeiro nó de topo é uma). */
export function firstPage(doc: Document): PageNode | undefined {
  const n = doc.nodes[doc.rootIds[0] ?? ""];
  return n?.type === "page" ? n : undefined;
}

/** Nós de topo de uma página (ou do documento sem páginas): o que o canvas mostra. */
export function pageRoots(doc: Document, pageId?: string | null): string[] {
  const page = pageId ? doc.nodes[pageId] : firstPage(doc);
  if (pageId && page?.type !== "page") throw new Error(`page "${pageId}" does not exist`);
  return page?.type === "page" ? page.children : doc.rootIds;
}

/** Campos aceitos por tipo de nó (para rejeitar chaves desconhecidas em vez de descartá-las em silêncio). */
export function knownKeys(type: NodeType): Set<string> {
  return new Set(Object.keys(NODE_SCHEMAS[type].shape));
}
