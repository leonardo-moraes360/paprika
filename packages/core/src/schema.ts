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

const lengthToken = z.string().regex(/^\$[\w.-]+$/);

function lengthNumber(min?: number, max?: number) {
  let n = z.number();
  if (min !== undefined) n = n.min(min);
  if (max !== undefined) n = n.max(max);
  return n;
}

function lengthValue(min?: number, max?: number) {
  const num = lengthNumber(min, max);
  return z.unknown().check((ctx) => {
    const v = ctx.value;
    if (typeof v === "string" && /^\$[\w.-]+$/.test(v)) return;
    const parsed = num.safeParse(v);
    if (!parsed.success) (ctx.issues as typeof parsed.error.issues).push(...parsed.error.issues);
  }).transform((v): number | string => v as number | string);
}

const padLength = lengthValue(0);
const cornerLength = lengthValue(0);
const cornerRadius = z.union([cornerLength, z.tuple([cornerLength, cornerLength, cornerLength, cornerLength])]).default(0);

export const StrokeStyle = z.enum(["solid", "dashed", "dotted"]);
export const StrokePosition = z.enum(["inside", "center", "outside"]);

export const Stroke = z.object({
  color: ColorValue,
  width: lengthValue(0, 1000),
  style: StrokeStyle.optional(),
  position: StrokePosition.optional(),
});

export const Shadow = z.object({
  x: lengthValue(),
  y: lengthValue(),
  blur: lengthValue(0),
  spread: lengthValue().default(0),
  color: ColorValue,
  inner: z.boolean().optional(),
});

export const ShadowValue = z.union([Shadow, z.array(Shadow).min(1).max(8)]);

export const Outline = z.object({
  color: ColorValue,
  width: lengthValue(0, 1000),
  style: StrokeStyle.optional(),
  offset: lengthValue(-1000, 1000).optional(),
});

const FILTER_KEYS = ["blur", "saturate", "grayscale", "brightness", "sepia", "invert", "hueRotate"] as const;

export const FilterEffects = z
  .object({
    blur: lengthValue(0, 1000).optional(),
    saturate: z.number().min(0).max(10).optional(),
    grayscale: z.number().min(0).max(1).optional(),
    brightness: z.number().min(0).max(10).optional(),
    sepia: z.number().min(0).max(1).optional(),
    invert: z.number().min(0).max(1).optional(),
    hueRotate: z.number().min(-360).max(360).optional(),
  })
  .check((ctx) => {
    const v = ctx.value as Record<string, unknown> | undefined;
    if (!v || FILTER_KEYS.every((k) => v[k] === undefined)) {
      ctx.issues.push({
        code: "custom",
        message: "filter needs at least one of blur, saturate, grayscale, brightness, sepia, invert, hueRotate",
        input: ctx.value,
      });
    }
  });

export type ShadowSpec = z.infer<typeof Shadow>;

export function listShadows(shadow: ShadowSpec | readonly ShadowSpec[] | undefined | null): ShadowSpec[] {
  if (shadow == null) return [];
  if (Array.isArray(shadow)) return shadow.slice();
  return [shadow as ShadowSpec];
}

export const Layout = z.object({
  mode: z.enum(["none", "row", "column"]).default("none"),
  gap: lengthValue(0).default(0),
  padding: z.union([padLength, z.tuple([padLength, padLength, padLength, padLength])]).default(0),
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
  layoutPositioning: z.enum(["auto", "absolute"]).optional(),
  constraints: z
    .object({
      horizontal: z.enum(["left", "right", "center", "scale"]).default("left"),
      vertical: z.enum(["top", "bottom", "center", "scale"]).default("top"),
    })
    .optional(),
  fill: ColorValue.optional(),
  stroke: Stroke.optional(),
  radius: lengthValue(0).default(0),
  shadow: ShadowValue.optional(),
  outline: Outline.optional(),
  filter: FilterEffects.optional(),
  backdropFilter: FilterEffects.optional(),
  /** Notas livres para humanos e agentes (intenção, restrições, links). */
  notes: z.string().max(4000).optional(),
  /** Só em cópias dentro de uma instância: id do nó do componente de onde a cópia vem (gerado). */
  sourceId: z.string().optional(),
  lintIgnore: z.array(z.string().regex(/^[a-z0-9-]{1,40}$/, "lint rule must be [a-z0-9-]{1,40}")).max(20).optional(),
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
  radius: cornerRadius,
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
  scaledMock: z.boolean().optional(),
});

export const RectNode = z.object({ ...Base, radius: cornerRadius, type: z.literal("rect") });
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
  fontSize: z.union([z.number().min(1).max(1000), lengthToken]).default(16),
  fontWeight: z.number().int().min(100).max(900).default(400),
  lineHeight: lengthValue(0, 10).default(1.4),
  letterSpacing: lengthValue().default(0),
  textAlign: z.enum(["left", "center", "right"]).default("left"),
});

export const ImageNode = z.object({
  ...Base,
  radius: cornerRadius,
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
export const ShapeKind = z.enum(["rect", "ellipse", "diamond", "triangle", "note"]);

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
  fontSize: z.union([z.number().min(1).max(1000), lengthToken]).default(16),
  fontWeight: z.number().int().min(100).max(900).default(500),
  lineHeight: lengthValue(0, 10).default(1.3),
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
  lintIgnore: Base.lintIgnore,
  layoutPositioning: Base.layoutPositioning,
  from: ConnectorEnd,
  to: ConnectorEnd,
  route: z.enum(["straight", "elbow", "rounded", "curve"]).default("straight"),
  /** Raio dos cantos quando `route` é `rounded` (ignorado nas outras rotas). */
  radius: z.number().min(0).max(1000).default(0),
  /**
   * Alça da curva livre (`route: "curve"`) nas coordenadas do pai. Sem ela, a rota usa um
   * deslocamento perpendicular derivado das pontas (recalculado a cada roteamento).
   */
  control: z.object({ x: z.number(), y: z.number() }).optional(),
  startArrow: z.enum(["none", "arrow"]).default("none"),
  endArrow: z.enum(["none", "arrow"]).default("arrow"),
  stroke: Stroke.default({ color: "#1e2336", width: 2 }),
  dashed: z.boolean().default(false),
  /** Rótulo no meio da rota ("sim", "não"), na cor do traço. */
  label: z.string().max(200).optional(),
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
  lintIgnore: Base.lintIgnore,
  layoutPositioning: Base.layoutPositioning,
  constraints: Base.constraints,
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
  lintIgnore: Base.lintIgnore,
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
  name: z.string().default("Untitled"),
  tokens: z.record(TokenName, TokenValue).default({}),
  /** Modos de tema: por modo, os tokens que mudam (os demais vêm de `tokens`). */
  modes: z.record(ModeName, z.record(TokenName, TokenValue)).optional(),
  /** Ids dos nós de nível superior (normalmente frames/telas), na ordem do canvas. */
  rootIds: z.array(z.string()).default([]),
  nodes: z.record(z.string(), Node).default({}),
});

export type ColorValue = z.infer<typeof ColorValue>;
export type Size = z.infer<typeof Size>;
export type Stroke = z.infer<typeof Stroke>;
export type StrokeStyle = z.infer<typeof StrokeStyle>;
export type StrokePosition = z.infer<typeof StrokePosition>;
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

export function ignoresLayout(n: Node): boolean {
  return "layoutPositioning" in n && n.layoutPositioning === "absolute";
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
