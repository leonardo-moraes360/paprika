import { textPieces, type TextRun } from "@paprika/core";

/**
 * A link inside a text has the browser's own link colour, as it has in the export and the screenshot (`nodeStyle` gives it an underline
 * and no colour). The app's Preflight resets an anchor to `color: inherit`; `revert` takes the user agent's rule back (visited and active included).
 * A colour the run sets itself is inline and wins.
 */
export const LINK_CLASS = "[color:revert]";

/** A run carries a mark (weight, colour, size, italic or link): one that has none is no run at all. */
export function runStyled(run: TextRun): boolean {
  return run.fontWeight !== undefined || run.color !== undefined || run.fontSize !== undefined || run.italic === true || !!run.href;
}

/**
 * Applies `change` to the characters `[from, to)` of the text and returns the runs that result (`null` when none is left):
 * a run that straddles the range is cut at its ends, and a piece left with no mark disappears.
 */
export function editRange(text: string, runs: readonly TextRun[] | undefined, from: number, to: number, change: (run: TextRun | undefined) => TextRun | null): TextRun[] | null {
  const next: TextRun[] = [];
  let at = 0;
  const emit = (start: number, end: number, run: TextRun | undefined | null) => {
    if (!run || end <= start) return;
    const copy: TextRun = { ...run, start, end };
    if (runStyled(copy)) next.push(copy);
  };
  for (const piece of textPieces(text, runs)) {
    const ps = at;
    const pe = at + piece.text.length;
    at = pe;
    const lo = Math.max(ps, from);
    const hi = Math.min(pe, to);
    if (hi <= lo) {
      emit(ps, pe, piece.run);
      continue;
    }
    emit(ps, lo, piece.run);
    emit(lo, hi, change(piece.run ? { ...piece.run } : undefined));
    emit(hi, pe, piece.run);
  }
  return next.length ? next : null;
}

/** The marks an element of the editor carries: its `data-*` (what `paintEditable` writes) or the tag a paste brought. */
function markOf(el: HTMLElement): Partial<TextRun> {
  const mark: Partial<TextRun> = {};
  const weight = el.dataset.weight || (el.tagName === "B" || el.tagName === "STRONG" ? "700" : "");
  if (weight) mark.fontWeight = Number(weight);
  const color = el.dataset.color || (el.tagName === "FONT" ? (el.getAttribute("color") ?? "") : "");
  if (color) mark.color = color;
  if (el.dataset.size) mark.fontSize = el.dataset.size.startsWith("$") ? el.dataset.size : Number(el.dataset.size);
  if (el.dataset.italic === "1" || el.tagName === "I" || el.tagName === "EM") mark.italic = true;
  const href = el.getAttribute("href");
  if (href) mark.href = href;
  return mark;
}

/** The text and the runs of what the person typed: a block or a `<br>` is a line break, a marked element is a run. */
export function readEditable(root: HTMLElement): { text: string; runs: TextRun[] | null } {
  // An emptied editor keeps a lone <br> so the line stays open: that is no text.
  if ((root.textContent ?? "") === "") return { text: "", runs: null };
  let text = "";
  const runs: TextRun[] = [];
  let open: { start: number; key: string; mark: Partial<TextRun> } | null = null;
  const close = (at: number) => {
    if (!open) return;
    if (at > open.start) {
      const run = { start: open.start, end: at, ...open.mark } as TextRun;
      if (runStyled(run)) runs.push(run);
    }
    open = null;
  };
  const ensure = (mark: Partial<TextRun>) => {
    const key = JSON.stringify(mark);
    if (open && open.key === key) return;
    close(text.length);
    if (key !== "{}") open = { start: text.length, key, mark };
  };
  const walk = (node: globalThis.Node, mark: Partial<TextRun>) => {
    if (node.nodeType === globalThis.Node.TEXT_NODE) {
      const chunk = (node.textContent ?? "").replace(/ /g, " ");
      if (!chunk) return;
      ensure(mark);
      text += chunk;
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    if (node.tagName === "BR") {
      close(text.length);
      text += "\n";
      return;
    }
    if (node !== root && (node.tagName === "DIV" || node.tagName === "P") && text.length > 0 && !text.endsWith("\n")) {
      close(text.length);
      text += "\n";
    }
    const next = { ...mark, ...markOf(node) };
    for (const child of node.childNodes) walk(child, next);
  };
  walk(root, {});
  close(text.length);
  return { text, runs: runs.length ? runs : null };
}

/** Fills the editor with the text and its runs, one element per marked piece. */
export function paintEditable(root: HTMLElement, text: string, runs: readonly TextRun[] | null | undefined) {
  root.replaceChildren();
  for (const piece of textPieces(text, runs ?? undefined)) {
    if (!piece.run) {
      root.append(document.createTextNode(piece.text));
      continue;
    }
    const el = piece.run.href ? document.createElement("a") : document.createElement("span");
    if (piece.run.fontWeight !== undefined) {
      el.dataset.weight = String(piece.run.fontWeight);
      el.style.fontWeight = String(piece.run.fontWeight);
    }
    if (piece.run.color !== undefined) {
      el.dataset.color = String(piece.run.color);
      el.style.color = String(piece.run.color);
    }
    if (piece.run.fontSize !== undefined) {
      el.dataset.size = String(piece.run.fontSize);
      if (typeof piece.run.fontSize === "number") el.style.fontSize = `${piece.run.fontSize}px`;
    }
    if (piece.run.italic) {
      el.dataset.italic = "1";
      el.style.fontStyle = "italic";
    }
    if (piece.run.href) {
      el.setAttribute("href", piece.run.href);
      el.className = LINK_CLASS;
      el.style.textDecoration = "underline";
    }
    el.textContent = piece.text;
    root.append(el);
  }
}

/** The selection inside `root` as character offsets, or `null` when it is elsewhere. */
export function selectionOffsets(root: HTMLElement): { start: number; end: number } | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const before = (node: globalThis.Node, offset: number) => {
    const probe = document.createRange();
    probe.selectNodeContents(root);
    probe.setEnd(node, offset);
    return probe.toString().replace(/ /g, " ").length;
  };
  const start = before(range.startContainer, range.startOffset);
  const end = before(range.endContainer, range.endOffset);
  return start <= end ? { start, end } : { start: end, end: start };
}

/** Selects the characters `[start, end)` of the editor (after it was painted again). */
export function selectOffsets(root: HTMLElement, start: number, end: number) {
  const range = document.createRange();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let seen = 0;
  let startNode: Text | null = null;
  let startOff = 0;
  let endNode: Text | null = null;
  let endOff = 0;
  while (walker.nextNode()) {
    const current = walker.currentNode as Text;
    const len = current.length;
    if (!startNode && seen + len >= start) {
      startNode = current;
      startOff = start - seen;
    }
    if (!endNode && seen + len >= end) {
      endNode = current;
      endOff = end - seen;
      break;
    }
    seen += len;
  }
  if (!startNode || !endNode) return;
  range.setStart(startNode, startOff);
  range.setEnd(endNode, endOff);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

/** The changes of the toolbar, each a function of the run the characters have now. */
export const marks = {
  bold: (run: TextRun | undefined): TextRun | null => {
    const next: TextRun = { start: 0, end: 0, ...(run ?? {}) };
    if (next.fontWeight === 700) delete next.fontWeight;
    else next.fontWeight = 700;
    return runStyled(next) ? next : null;
  },
  italic: (run: TextRun | undefined): TextRun | null => {
    const next: TextRun = { start: 0, end: 0, ...(run ?? {}) };
    if (next.italic) delete next.italic;
    else next.italic = true;
    return runStyled(next) ? next : null;
  },
  size: (fontSize: number) => (run: TextRun | undefined): TextRun => ({ start: 0, end: 0, ...(run ?? {}), fontSize }),
  color: (color: string) => (run: TextRun | undefined): TextRun => ({ start: 0, end: 0, ...(run ?? {}), color }),
  link: (href: string) => (run: TextRun | undefined): TextRun => ({ start: 0, end: 0, ...(run ?? {}), href }),
};

/** An address the toolbar accepts as a link (the old canvas' rule). */
export const linkOk = (href: string) => /^(https?:\/\/|mailto:|[#/])/.test(href) && !/[\s<>"']/.test(href);

/** The runs as the document keeps them, for the "did it change" test. */
export const sameText = (aText: string, aRuns: readonly TextRun[] | null | undefined, bText: string, bRuns: readonly TextRun[] | null | undefined) => aText === bText && JSON.stringify(aRuns ?? null) === JSON.stringify(bRuns ?? null);
