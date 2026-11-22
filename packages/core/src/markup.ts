/**
 * Leitor tolerante de marcação (HTML e SVG) para importar conteúdo colado. Não é um parser
 * HTML5 completo: lê tags, atributos, texto e entidades comuns, ignora comentários, doctype,
 * `<script>` e `<style>`, e fecha tags esquecidas. Nomes de tags e atributos ficam em minúsculas
 * (ASCII). Roda igual no servidor, no navegador e no Go (`server-go/internal/core/markup.go`).
 */

export interface MarkupElement {
  tag: string;
  /** Atributos em minúsculas; um Map, então nomes vindos da entrada nunca viram propriedades de objeto. */
  attrs: Map<string, string>;
  children: MarkupNode[];
}
export type MarkupNode = MarkupElement | string;

/** Limites que protegem o servidor de entradas gigantes. */
export const MARKUP_LIMITS = { chars: 2_000_000, elements: 5_000, depth: 200 } as const;

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const RAW = new Set(["script", "style"]);
const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function lower(s: string): string {
  return s.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));
}

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z]{2,8});/g, (m, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : m;
    }
    return NAMED[body] ?? m;
  });
}

/** indexOf que ignora maiúsculas ASCII em `src` (`needle` já em minúsculas). */
function indexOfLower(src: string, needle: string, from: number): number {
  outer: for (let k = from; k + needle.length <= src.length; k++) {
    for (let m = 0; m < needle.length; m++) {
      let c = src.charCodeAt(k + m);
      if (c >= 65 && c <= 90) c += 32;
      if (c !== needle.charCodeAt(m)) continue outer;
    }
    return k;
  }
  return -1;
}

const isSpace = (c: string | undefined) => c === " " || c === "\n" || c === "\t" || c === "\r" || c === "\f";
const isNameChar = (c: string | undefined) => !!c && /[A-Za-z0-9_:.-]/.test(c);

/** Lê a marcação e devolve um elemento raiz `#root` com o conteúdo. */
export function parseMarkup(src: string): MarkupElement {
  if (src.length > MARKUP_LIMITS.chars) throw new Error(`markup too large (max. ${MARKUP_LIMITS.chars} characters)`);
  const root: MarkupElement = { tag: "#root", attrs: new Map(), children: [] };
  const stack: MarkupElement[] = [root];
  let count = 0;
  let i = 0;
  const top = () => stack[stack.length - 1]!;
  const text = (s: string) => {
    if (!s) return;
    const kids = top().children;
    const last = kids[kids.length - 1];
    if (typeof last === "string") kids[kids.length - 1] = last + s;
    else kids.push(s);
  };
  while (i < src.length) {
    const lt = src.indexOf("<", i);
    if (lt < 0) {
      text(decodeEntities(src.slice(i)));
      break;
    }
    text(decodeEntities(src.slice(i, lt)));
    i = lt;
    if (src.startsWith("<!--", i)) {
      const end = src.indexOf("-->", i + 4);
      i = end < 0 ? src.length : end + 3;
      continue;
    }
    if (src.startsWith("<![CDATA[", i)) {
      const end = src.indexOf("]]>", i + 9);
      text(src.slice(i + 9, end < 0 ? src.length : end));
      i = end < 0 ? src.length : end + 3;
      continue;
    }
    if (src[i + 1] === "!" || src[i + 1] === "?") {
      const end = src.indexOf(">", i);
      i = end < 0 ? src.length : end + 1;
      continue;
    }
    if (src[i + 1] === "/") {
      let j = i + 2;
      while (isNameChar(src[j])) j++;
      const name = lower(src.slice(i + 2, j));
      const end = src.indexOf(">", j);
      i = end < 0 ? src.length : end + 1;
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k]!.tag === name) {
          stack.length = k;
          break;
        }
      }
      continue;
    }
    let j = i + 1;
    while (isNameChar(src[j])) j++;
    if (j === i + 1) {
      text("<");
      i++;
      continue;
    }
    const el: MarkupElement = { tag: lower(src.slice(i + 1, j)), attrs: new Map(), children: [] };
    let selfClose = false;
    while (j < src.length) {
      while (isSpace(src[j])) j++;
      if (src[j] === ">") {
        j++;
        break;
      }
      if (src[j] === "/" && src[j + 1] === ">") {
        selfClose = true;
        j += 2;
        break;
      }
      let k = j;
      while (k < src.length && !isSpace(src[k]) && src[k] !== "=" && src[k] !== ">" && !(src[k] === "/" && src[k + 1] === ">")) k++;
      if (k === j) {
        j++;
        continue;
      }
      const name = lower(src.slice(j, k));
      j = k;
      while (isSpace(src[j])) j++;
      let value = "";
      if (src[j] === "=") {
        j++;
        while (isSpace(src[j])) j++;
        const q = src[j];
        if (q === '"' || q === "'") {
          const end = src.indexOf(q, j + 1);
          value = src.slice(j + 1, end < 0 ? src.length : end);
          j = end < 0 ? src.length : end + 1;
        } else {
          let e = j;
          while (e < src.length && !isSpace(src[e]) && src[e] !== ">") e++;
          value = src.slice(j, e);
          j = e;
        }
      }
      if (!el.attrs.has(name)) el.attrs.set(name, decodeEntities(value));
    }
    i = j;
    if (++count > MARKUP_LIMITS.elements) throw new Error(`markup with more than ${MARKUP_LIMITS.elements} elements`);
    top().children.push(el);
    if (RAW.has(el.tag)) {
      const close = indexOfLower(src, `</${el.tag}`, i);
      el.children.push(src.slice(i, close < 0 ? src.length : close));
      const end = close < 0 ? -1 : src.indexOf(">", close);
      i = end < 0 ? src.length : end + 1;
      continue;
    }
    if (selfClose || VOID.has(el.tag)) continue;
    if (stack.length > MARKUP_LIMITS.depth) throw new Error(`markup with more than ${MARKUP_LIMITS.depth} levels`);
    stack.push(el);
  }
  return root;
}

/** Elementos filhos (sem texto). */
export function elements(el: MarkupElement): MarkupElement[] {
  return el.children.filter((c): c is MarkupElement => typeof c !== "string");
}

/** Primeiro descendente (busca em profundidade) com a tag dada. */
export function findElement(el: MarkupElement, tag: string): MarkupElement | undefined {
  for (const c of elements(el)) {
    if (c.tag === tag) return c;
    const hit = findElement(c, tag);
    if (hit) return hit;
  }
  return undefined;
}

/** Texto de um elemento (concatena descendentes; `<br>` vira quebra de linha). */
export function textContent(el: MarkupElement): string {
  let out = "";
  for (const c of el.children) {
    if (typeof c === "string") out += c;
    else if (c.tag === "br") out += "\n";
    else if (!RAW.has(c.tag)) out += textContent(c);
  }
  return out;
}

/** `a: b; c: d` → `Map { a → "b", c → "d" }` (nomes em minúsculas, valores sem espaços nas pontas; a última declaração vence). */
export function parseStyle(s: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (!s) return out;
  for (const part of s.split(";")) {
    const at = part.indexOf(":");
    if (at < 0) continue;
    const k = lower(part.slice(0, at).trim());
    const v = part.slice(at + 1).trim();
    if (k && v) out.set(k, v);
  }
  return out;
}
