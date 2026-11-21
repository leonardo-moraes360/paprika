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
  .refine((v) => !/[;{}<>]/.test(v), "cor não pode conter ; { } < >");

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
  id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, "id deve ser [A-Za-z0-9_-]{1,64}"),
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
};

export const FrameNode = z.object({
  ...Base,
  type: z.literal("frame"),
  children: z.array(z.string()).default([]),
  clip: z.boolean().default(true),
  layout: Layout.optional(),
});

export const RectNode = z.object({ ...Base, type: z.literal("rect") });
export const EllipseNode = z.object({ ...Base, type: z.literal("ellipse") });

export const TextNode = z.object({
  ...Base,
  type: z.literal("text"),
  text: z.string().max(20_000).default(""),
  color: ColorValue.default("#111111"),
  fontFamily: z
    .string()
    .max(200)
    .refine((v) => !/[;{}<>()]/.test(v), "fontFamily não pode conter ; { } < > ( )")
    .default("Inter, system-ui, sans-serif"),
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
    .refine((v) => /^(https?:|data:image\/)/.test(v), "src deve ser http(s) ou data:image/"),
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
      if (err) ctx.addIssue({ code: "custom", message: `d inválido: ${err}` });
    }),
  fillRule: z.enum(["nonzero", "evenodd"]).default("nonzero"),
  strokeCap: z.enum(["butt", "round", "square"]).default("round"),
  strokeJoin: z.enum(["miter", "round", "bevel"]).default("round"),
  viewBox: z
    .tuple([z.number(), z.number(), z.number().positive(), z.number().positive()])
    .optional(),
});

export const Node = z.discriminatedUnion("type", [FrameNode, RectNode, EllipseNode, TextNode, ImageNode, PathNode]);

export const NodeType = z.enum(["frame", "rect", "ellipse", "text", "image", "path"]);

export const TokenValue = z.union([z.string().max(500), z.number()]);
export const TokenName = z.string().regex(/^[\w.-]{1,100}$/, "nome de token deve ser [\\w.-]{1,100}");

export const Document = z.object({
  format: z.literal(FORMAT),
  id: z.string(),
  name: z.string().default("Sem título"),
  tokens: z.record(TokenName, TokenValue).default({}),
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
} as const;

/** Campos aceitos por tipo de nó (para rejeitar chaves desconhecidas em vez de descartá-las em silêncio). */
export function knownKeys(type: NodeType): Set<string> {
  return new Set(Object.keys(NODE_SCHEMAS[type].shape));
}
