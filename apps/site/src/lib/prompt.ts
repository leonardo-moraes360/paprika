// The setup prompt shown on the landing page is the one in the README, so the two never drift.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../markdown.ts";
import type { Lang } from "../docs.ts";

export function setupPrompt(lang: Lang): string {
  const md = readFileSync(join(ROOT, lang === "en" ? "README.md" : "docs/pt-BR/README.md"), "utf8");
  const block = /```text\n([\s\S]*?)```/.exec(md);
  if (!block?.[1]) throw new Error(`setup prompt (a \`\`\`text block) not found in the ${lang} README`);
  return block[1].trimEnd();
}
