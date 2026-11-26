export const COMMON_FAMILIES = [
  "Inter, system-ui, sans-serif",
  "system-ui, sans-serif",
  "sans-serif",
  "serif",
  "monospace",
  "Georgia, serif",
  "Times New Roman, Times, serif",
  "Arial, Helvetica, sans-serif",
  "Helvetica, Arial, sans-serif",
  "Courier New, Courier, monospace",
  "ui-sans-serif, system-ui, sans-serif",
  "ui-serif, Georgia, serif",
  "ui-monospace, monospace",
  "Segoe UI, system-ui, sans-serif",
  "Roboto, system-ui, sans-serif",
  "Verdana, Geneva, sans-serif",
  "Tahoma, Geneva, sans-serif",
] as const;

export type FontGroups = {
  document: string[];
  common: string[];
  system: string[];
};

export function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set([...values].map((value) => value.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

export function familyLabel(stack: string): string {
  return stack.split(",")[0]?.trim().replace(/^["']|["']$/g, "") || stack;
}

export function groupFonts(input: {
  value: string;
  documentFonts: readonly string[];
  commonFonts: readonly string[];
  systemFonts: readonly string[];
}): FontGroups {
  const common = uniqueSorted(input.commonFonts);
  const taken = new Set(common);
  const document = uniqueSorted(input.documentFonts).filter((family) => !taken.has(family));
  document.forEach((family) => taken.add(family));
  const current = input.value.trim();
  if (current && !taken.has(current)) {
    document.unshift(current);
    taken.add(current);
  }
  const system = uniqueSorted(input.systemFonts).filter((family) => !taken.has(family));
  return { document, common, system };
}
