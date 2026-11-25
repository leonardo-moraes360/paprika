import { z } from "zod";
import { pathError } from "./path.js";

export const FORMAT = "paprika/1" as const;

export const GRADIENT_COLOR_MSG =
  'a color cannot be a CSS gradient or url(); use the structured gradient field, e.g. gradient: {type: "linear", angle: 90, stops: [{color: "#fff", offset: 0}, {color: "#000", offset: 1}]}';

export const ColorValue = z
  .string()
  .min(1)
  .max(200)
  .refine((v) => !/[;{}<>]/.test(v), "a color cannot contain ; { } < >");

export const GradientStop = z.object({
  color: ColorValue,
  offset: z.number().min(0).max(1),
});

export const Gradient = z.object({
  type: z.enum(["linear", "radial", "conic"]),
  angle: z.number().min(-3600).max(3600).default(180),
  cx: z.number().min(0).max(1).default(0.5),
  cy: z.number().min(0).max(1).default(0.5),
  radius: z.number().min(0).max(2).default(0.5),
  stops: z.array(GradientStop).min(2).max(12),
});

const HREF_MSG = "href must be a relative URL, #hash, http(s), mailto: or tel:";

export function safeHref(v: string): boolean {
  if (!v || /[\s<>"']/.test(v)) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return /^(https?:|mailto:|tel:)/i.test(v);
  return true;
}

const Href = z.string().min(1).max(2000).refine(safeHref, HREF_MSG);

function forward(ctx: { issues: unknown[] }, issues: unknown[]): void {
  ctx.issues.push(...issues);
}

const SIZE_MSG =
  'width and height take a number (0..100000), "hug" or "fill"; "$token" values are not accepted here (tokens work for padding, gap, radius, stroke width...)';
const sizeNumber = z.number().min(0).max(100_000);

export const Size = z.unknown().transform((v, ctx): number | "hug" | "fill" => {
  if (v === "hug" || v === "fill") return v;
  if (typeof v === "number") {
    const parsed = sizeNumber.safeParse(v);
    if (parsed.success) return parsed.data;
    forward(ctx, parsed.error.issues);
    return z.NEVER;
  }
  ctx.issues.push({ code: "custom", message: SIZE_MSG, input: v });
  return z.NEVER;
});

const lengthToken = z.string().regex(/^\$[\w.-]+$/);
const fontWeightValue = z.union([z.number().int().min(100).max(900), lengthToken]);

function lengthNumber(min?: number, max?: number) {
  let n = z.number();
  if (min !== undefined) n = n.min(min);
  if (max !== undefined) n = n.max(max);
  return n;
}

function lengthValue(min?: number, max?: number, rangeMsg?: string) {
  const num = lengthNumber(min, max);
  return z.unknown().check((ctx) => {
    const v = ctx.value;
    if (typeof v === "string" && /^\$[\w.-]+$/.test(v)) return;
    const parsed = num.safeParse(v);
    if (!parsed.success) {
      const issues = rangeMsg
        ? parsed.error.issues.map((i) => (i.code === "too_big" || i.code === "too_small" ? { ...i, message: rangeMsg } : i))
        : parsed.error.issues;
      (ctx.issues as typeof parsed.error.issues).push(...issues);
    }
  }).transform((v): number | string => v as number | string);
}

const LINE_HEIGHT_MSG =
  "lineHeight is a unitless multiplier of fontSize between 0 and 10 (e.g. 1.4), not pixels; for a 22px line on 16px text use 1.375";

const padLength = lengthValue(0);

const PADDING_MSG =
  'layout.padding takes one value (all sides), [vertical, horizontal] or [top, right, bottom, left]; each a number or "$token"';

type Pad = number | string;

const paddingValue = z.unknown().transform((v, ctx): Pad | [Pad, Pad, Pad, Pad] => {
  const fail = (): never => {
    ctx.issues.push({ code: "custom", message: PADDING_MSG, input: v });
    return z.NEVER;
  };
  if (Array.isArray(v)) {
    if (v.length !== 2 && v.length !== 4) return fail();
    const parsed = z.tuple(v.map(() => padLength) as [typeof padLength, typeof padLength]).safeParse(v);
    if (!parsed.success) {
      forward(ctx, parsed.error.issues);
      return z.NEVER;
    }
    const d = parsed.data as [Pad, Pad, Pad, Pad] | [Pad, Pad];
    return d.length === 2 ? [d[0], d[1], d[0], d[1]] : d;
  }
  if (typeof v !== "number" && !(typeof v === "string" && /^\$[\w.-]+$/.test(v))) return fail();
  const parsed = padLength.safeParse(v);
  if (!parsed.success) {
    forward(ctx, parsed.error.issues);
    return z.NEVER;
  }
  return parsed.data;
});
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

export const PropName = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_]{0,31}$/, "prop name must be [A-Za-z][A-Za-z0-9_]{0,31}");

export const VariantOption = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,40}$/, "variant option must be [A-Za-z0-9_-]{1,40}");

export const ComponentProp = z.object({
  name: PropName,
  type: z.enum(["text", "boolean", "variant"]),
  default: z.union([z.string().max(2000), z.boolean()]).optional(),
  options: z.array(VariantOption).min(1).max(24).optional(),
});

export const Bind = z.object({
  text: PropName.optional(),
  visible: PropName.optional(),
  variant: z.record(PropName, VariantOption).optional(),
});

export const PropValues = z.record(PropName, z.union([z.string().max(2000), z.boolean()]));

const NodeId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, "id must be [A-Za-z0-9_-]{1,64}");
export const SlotFills = z.record(PropName, z.array(NodeId).max(40));

export const Layout = z.object({
  mode: z.enum(["none", "row", "column"]).default("none"),
  gap: lengthValue(0).default(0),
  padding: paddingValue.default(0),
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
  gradient: Gradient.optional(),
  stroke: Stroke.optional(),
  radius: lengthValue(0).default(0),
  shadow: ShadowValue.optional(),
  outline: Outline.optional(),
  filter: FilterEffects.optional(),
  backdropFilter: FilterEffects.optional(),
  notes: z.string().max(4000).optional(),
  sourceId: z.string().optional(),
  lintIgnore: z.array(z.string().regex(/^[a-z0-9-]{1,40}$/, "lint rule must be [a-z0-9-]{1,40}")).max(20).optional(),
  bind: Bind.optional(),
};

export const ModeName = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,40}$/, "mode name must be [A-Za-z0-9_-]{1,40}")
  .refine((v) => v !== "__proto__", "mode name cannot be __proto__");

export const TokenTypeName = z.enum(["color", "length", "fontFamily", "fontWeight", "fontSize", "lineHeight", "letterSpacing"]);

export const CollectionName = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,40}$/, "collection name must be [A-Za-z0-9_-]{1,40}")
  .refine((v) => v !== "__proto__", "collection name cannot be __proto__");

export const TokenMeta = z
  .object({
    type: TokenTypeName.optional(),
    collection: CollectionName.optional(),
  })
  .refine((m) => m.type !== undefined || m.collection !== undefined, "token meta needs a type or a collection");

const OverrideSource = z.string().regex(
  /^[A-Za-z0-9_-]{1,64}(\/[A-Za-z0-9_-]{1,64}){0,6}$/,
  "override path must be an id or id/id (up to 7 ids)",
);
const OverrideField = z.string().regex(/^[A-Za-z]{1,32}$/, "field must be [A-Za-z]{1,32}");
export const Overrides = z.record(OverrideSource, z.record(OverrideField, z.unknown()));

export const FrameNode = z.object({
  ...Base,
  radius: cornerRadius,
  type: z.literal("frame"),
  children: z.array(z.string()).default([]),
  clip: z.boolean().default(true),
  layout: Layout.optional(),
  component: z.boolean().optional(),
  instanceOf: z.string().optional(),
  scale: z.number().min(0.01).max(100).optional(),
  overrides: Overrides.optional(),
  mode: ModeName.optional(),
  scaledMock: z.boolean().optional(),
  href: Href.optional(),
  minWidth: z.number().min(0).max(100_000).optional(),
  maxWidth: z.number().min(0).max(100_000).optional(),
  slot: PropName.optional(),
  componentProps: z.array(ComponentProp).max(24).optional(),
  propValues: PropValues.optional(),
  slots: SlotFills.optional(),
});

export const RectNode = z.object({ ...Base, radius: cornerRadius, type: z.literal("rect") });
export const EllipseNode = z.object({ ...Base, type: z.literal("ellipse") });

const TextFontFamily = z
  .string()
  .max(200)
  .refine((v) => !/[;{}<>()]/.test(v), "fontFamily cannot contain ; { } < > ( )")
  .default("Inter, system-ui, sans-serif");

const hrefValue = z
  .string()
  .max(2000)
  .refine((v) => /^(https?:\/\/|mailto:|[#/])/.test(v) && !/[\s<>"']/.test(v), "href must be http(s), mailto, or a path starting with / or #");

export const TextRun = z.object({
  start: z.number().int().min(0),
  end: z.number().int().min(0),
  fontWeight: fontWeightValue.optional(),
  color: ColorValue.optional(),
  fontSize: z.union([z.number().min(1).max(1000), lengthToken]).optional(),
  italic: z.boolean().optional(),
  href: hrefValue.optional(),
});

function textRunIssues(text: string, runs: z.infer<typeof TextRun>[] | undefined): { path: (string | number)[]; message: string }[] {
  if (!runs?.length) return [];
  const issues: { path: (string | number)[]; message: string }[] = [];
  let prev = 0;
  let overlap = false;
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i]!;
    if (run.start >= run.end) issues.push({ path: ["runs", i], message: "run start must be before end" });
    if (run.end > text.length) issues.push({ path: ["runs", i, "end"], message: "run ends past the text" });
    const styled = run.fontWeight !== undefined || run.color !== undefined || run.fontSize !== undefined || run.italic === true || run.href !== undefined;
    if (!styled) issues.push({ path: ["runs", i], message: "run has no style" });
    if (!overlap && run.start < prev) {
      issues.push({ path: ["runs"], message: "runs overlap or are out of order" });
      overlap = true;
    }
    if (run.start >= prev && run.start < run.end) prev = run.end;
  }
  return issues;
}

export const TextNode = z
  .object({
    ...Base,
    type: z.literal("text"),
    text: z.string().max(20_000).default(""),
    color: ColorValue.default("#111111"),
    fontFamily: TextFontFamily,
    fontSize: z.union([z.number().min(1).max(1000), lengthToken]).default(16),
    fontWeight: fontWeightValue.default(400),
    lineHeight: lengthValue(0, 10, LINE_HEIGHT_MSG).default(1.4),
    letterSpacing: lengthValue().default(0),
    textAlign: z.enum(["left", "center", "right"]).default("left"),
    href: Href.optional(),
    runs: z.array(TextRun).max(200).optional(),
  })
  .superRefine((node, ctx) => {
    for (const issue of textRunIssues(node.text, node.runs)) ctx.addIssue({ code: "custom", message: issue.message, path: issue.path });
  });

export const ImageNode = z.object({
  ...Base,
  radius: cornerRadius,
  type: z.literal("image"),
  src: z
    .string()
    .max(5_000_000)
    .refine((v) => /^(https?:|data:image\/)/.test(v) || /^\$[\w.-]+$/.test(v), "src must be http(s), data:image/ or $asset"),
  fit: z.enum(["cover", "contain", "fill"]).default("cover"),
  alt: z.string().max(1000).default(""),
  decorative: z.boolean().optional(),
});

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

export const ShapeKind = z.enum(["rect", "ellipse", "diamond", "triangle", "cylinder", "parallelogram", "cloud", "note"]);

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
  fontWeight: fontWeightValue.default(500),
  lineHeight: lengthValue(0, 10, LINE_HEIGHT_MSG).default(1.3),
  textAlign: z.enum(["left", "center", "right"]).default("center"),
});

export const ConnectorSide = z.enum(["auto", "top", "right", "bottom", "left"]);

export const ConnectorEnd = z.object({
  nodeId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, "nodeId must be [A-Za-z0-9_-]{1,64}").optional(),
  side: ConnectorSide.optional(),
  x: z.number().optional(),
  y: z.number().optional(),
});

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
  radius: z.number().min(0).max(1000).default(0),
  control: z.object({ x: z.number(), y: z.number() }).optional(),
  startArrow: z.enum(["none", "arrow"]).default("none"),
  endArrow: z.enum(["none", "arrow"]).default("arrow"),
  stroke: Stroke.default({ color: "#1e2336", width: 2 }),
  dashed: z.boolean().default(false),
  label: z.string().max(200).optional(),
  d: z.string().max(10_000).default(""),
  bind: Bind.optional(),
});

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
  bind: Bind.optional(),
  slot: PropName.optional(),
});

export const PageNode = z.object({
  id: Base.id,
  name: Base.name,
  parentId: Base.parentId,
  type: z.literal("page"),
  fill: ColorValue.optional(),
  gradient: Gradient.optional(),
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

export const AssetName = z
  .string()
  .regex(/^[\w.-]{1,100}$/, "asset name must be [\\w.-]{1,100}")
  .refine((v) => v !== "__proto__", "asset name cannot be __proto__");

export const AssetSrc = z
  .string()
  .max(5_000_000)
  .refine((v) => /^(https?:|data:image\/)/.test(v), "asset must be http(s) or data:image/");

export const Document = z.object({
  format: z.literal(FORMAT),
  id: z.string(),
  name: z.string().default("Untitled"),
  tokens: z.record(TokenName, TokenValue).default({}),
  modes: z.record(ModeName, z.record(TokenName, TokenValue)).optional(),
  tokenMeta: z.record(TokenName, TokenMeta).optional(),
  assets: z.record(AssetName, AssetSrc).optional(),
  rootIds: z.array(z.string()).default([]),
  nodes: z.record(z.string(), Node).default({}),
});

export type ColorValue = z.infer<typeof ColorValue>;
export type Gradient = z.infer<typeof Gradient>;
export type GradientStop = z.infer<typeof GradientStop>;
export type Size = z.infer<typeof Size>;
export type Stroke = z.infer<typeof Stroke>;
export type StrokeStyle = z.infer<typeof StrokeStyle>;
export type StrokePosition = z.infer<typeof StrokePosition>;
export type Layout = z.infer<typeof Layout>;
export type FrameNode = z.infer<typeof FrameNode>;
export type RectNode = z.infer<typeof RectNode>;
export type EllipseNode = z.infer<typeof EllipseNode>;
export type TextRun = z.infer<typeof TextRun>;
export type TextNode = z.infer<typeof TextNode>;
export type ImageNode = z.infer<typeof ImageNode>;
export type PathNode = z.infer<typeof PathNode>;
export type GroupNode = z.infer<typeof GroupNode>;
export type PageNode = z.infer<typeof PageNode>;
export type ShapeNode = z.infer<typeof ShapeNode>;
export type ConnectorNode = z.infer<typeof ConnectorNode>;
export type ConnectorEnd = z.infer<typeof ConnectorEnd>;
export type ShapeKind = z.infer<typeof ShapeKind>;
export type ContainerNode = FrameNode | GroupNode | PageNode;
export type SceneNode = Exclude<Node, PageNode>;
export type Node = z.infer<typeof Node>;
export type NodeType = z.infer<typeof NodeType>;
export type Document = z.infer<typeof Document>;
export type TokenValue = z.infer<typeof TokenValue>;
export type TokenTypeName = z.infer<typeof TokenTypeName>;
export type TokenMeta = z.infer<typeof TokenMeta>;

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

export function firstPage(doc: Document): PageNode | undefined {
  const n = doc.nodes[doc.rootIds[0] ?? ""];
  return n?.type === "page" ? n : undefined;
}

export function pageRoots(doc: Document, pageId?: string | null): string[] {
  const page = pageId ? doc.nodes[pageId] : firstPage(doc);
  if (pageId && page?.type !== "page") throw new Error(`page "${pageId}" does not exist`);
  return page?.type === "page" ? page.children : doc.rootIds;
}

export function isRootFrame(doc: Document, node: Node): boolean {
  if (node.type !== "frame") return false;
  if (node.parentId == null) return true;
  return doc.nodes[node.parentId]?.type === "page";
}

export function resolveAsset(doc: Document, src: string): string {
  if (!src.startsWith("$")) return src;
  const v = doc.assets?.[src.slice(1)];
  return typeof v === "string" ? v : src;
}

export function frameFluid(node: Node): { min: number; max: number } | null {
  if (node.type !== "frame" || (node.minWidth == null && node.maxWidth == null)) return null;
  const w = typeof node.width === "number" ? node.width : 0;
  const min = node.minWidth ?? w;
  const max = node.maxWidth ?? Math.max(w, min);
  return { min, max };
}

export function knownKeys(type: NodeType): Set<string> {
  return new Set(Object.keys(NODE_SCHEMAS[type].shape));
}
