import type { Node } from "@paprika/core";

export type TokenUse = { field: string; value: string };

export function tokenUses(node: Node): TokenUse[] {
  const out: TokenUse[] = [];
  const push = (field: string, value: unknown) => {
    if (typeof value === "string" && value.startsWith("$")) out.push({ field, value });
  };
  const rec = node as unknown as Record<string, unknown>;
  for (const key of ["fill", "color", "fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing"]) push(key, rec[key]);
  if (Array.isArray(rec.radius)) (rec.radius as unknown[]).forEach((item) => push("radius", item));
  else push("radius", rec.radius);
  const stroke = rec.stroke as { color?: unknown; width?: unknown } | undefined;
  if (stroke) {
    push("stroke.color", stroke.color);
    push("stroke.width", stroke.width);
  }
  const shadows = Array.isArray(rec.shadow) ? rec.shadow : rec.shadow ? [rec.shadow] : [];
  for (const shadow of shadows as Record<string, unknown>[]) {
    for (const key of ["x", "y", "blur", "spread", "color"]) push(`shadow.${key}`, shadow[key]);
  }
  const outline = rec.outline as Record<string, unknown> | undefined;
  if (outline) for (const key of ["color", "width", "offset"]) push(`outline.${key}`, outline[key]);
  push("filter.blur", (rec.filter as { blur?: unknown } | undefined)?.blur);
  push("backdropFilter.blur", (rec.backdropFilter as { blur?: unknown } | undefined)?.blur);
  const layout = rec.layout as { gap?: unknown; padding?: unknown } | undefined;
  if (layout) {
    push("layout.gap", layout.gap);
    if (Array.isArray(layout.padding)) (layout.padding as unknown[]).forEach((item) => push("layout.padding", item));
    else push("layout.padding", layout.padding);
  }
  return out;
}
