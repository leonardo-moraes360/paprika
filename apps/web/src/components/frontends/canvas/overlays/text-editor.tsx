import { nodeStyle, type Node, type TextRun } from "@paprika/core";
import { Bold, Italic, Link2 } from "lucide-react";
import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { TextField } from "@/components/ui/text-field";
import { Toolbar, ToolbarGroup, ToolbarSeparator } from "@/components/ui/toolbar-group";
import { ToolbarButton } from "@/components/ui/toolbar-button";
import { editRange, linkOk, marks, paintEditable, readEditable, sameText, selectOffsets, selectionOffsets } from "../rich-text";
import { useCanvasState } from "../region";
import { useCanvasRuntime } from "../runtime";
import { confirmKey, editorOutline, editorOutlineStyle } from "./editor-chrome";
import { useNode } from "./use-node";

type TextNode = Extract<Node, { type: "text" }>;

/**
 * The editor of a text node, drawn over it while `editingId` is its id: a content-editable with the node's own typography and a
 * floating bar (bold, italic, size, colour, link) over the selection. Enter breaks the line; Escape, Ctrl or Cmd with Enter,
 * or leaving it, confirms; one `apply` goes out, and only when the text or its runs changed.
 */
export function TextEditor() {
  const id = useCanvasState((s) => s.editingId);
  return id ? <TextEditorFor key={id} id={id} /> : null;
}

function TextEditorFor({ id }: { id: string }) {
  const node = useNode(id);
  return node?.type === "text" ? <TextSurface node={node} /> : null;
}

const BAR_GAP = 8;
const BAR_MARGIN = 8;

const hexOf = (value: unknown) => (typeof value === "string" && value.startsWith("#") ? value : "");

function TextSurface({ node }: { node: TextNode }) {
  const rt = useCanvasRuntime();
  const [initial] = useState(node);
  const shell = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const done = useRef(false);
  const saved = useRef<{ start: number; end: number } | null>(null);
  const [size, setSize] = useState(typeof node.fontSize === "number" ? String(node.fontSize) : "16");
  const [color, setColor] = useState(hexOf(node.color));
  const [href, setHref] = useState("https://");

  useLayoutEffect(() => {
    const el = surface.current;
    const box = rt.measure(initial.id);
    const wrap = shell.current;
    if (wrap && box) {
      wrap.style.left = `${box.x}px`;
      wrap.style.top = `${box.y}px`;
      wrap.style.width = `${box.width}px`;
      wrap.style.minHeight = `${box.height}px`;
      wrap.style.transform = box.rotation ? `rotate(${box.rotation}deg)` : "";
    }
    // The bar keeps inside the canvas: pushed in from a side it would run past, and under the text when there is no room above it.
    const strip = bar.current;
    const viewport = rt.viewport();
    if (strip && wrap && viewport) {
      const room = viewport.getBoundingClientRect();
      const r = strip.getBoundingClientRect();
      const zoom = rt.view.get().zoom;
      let dx = 0;
      if (r.right > room.right - BAR_MARGIN) dx = room.right - BAR_MARGIN - r.right;
      if (r.left + dx < room.left + BAR_MARGIN) dx = room.left + BAR_MARGIN - r.left;
      const flip = r.top < room.top + BAR_MARGIN;
      strip.style.transform = `translateX(${dx / zoom}px) scale(calc(1 / var(--view-zoom))) translateY(${flip ? `${wrap.getBoundingClientRect().height + BAR_GAP}px` : `calc(-100% - ${BAR_GAP}px)`})`;
    }
    if (!el) return;
    paintEditable(el, initial.text, initial.runs);
    el.focus();
    // The caret goes to the end, where a person who opened the editor to add something expects it.
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }, [rt, initial]);

  const finish = (refocus: boolean) => {
    if (done.current) return;
    done.current = true;
    const el = surface.current;
    const next = el ? readEditable(el) : { text: initial.text, runs: initial.runs ?? null };
    if (!sameText(next.text, next.runs, initial.text, initial.runs)) {
      void rt.apply([{ op: "update", id: initial.id, props: { text: next.text, runs: next.runs } }], rt.text("history.editText"));
    }
    rt.store.actions.setEditing(null);
    if (refocus) rt.viewport()?.focus({ preventScroll: true });
  };

  const change = (run: (run: TextRun | undefined) => TextRun | null) => {
    const el = surface.current;
    if (!el) return;
    const live = selectionOffsets(el);
    const sel = live && live.start !== live.end ? live : saved.current;
    if (!sel || sel.start === sel.end) return;
    const current = readEditable(el);
    paintEditable(el, current.text, editRange(current.text, current.runs ?? undefined, sel.start, sel.end, run));
    selectOffsets(el, sel.start, sel.end);
  };

  const number = Number(size);
  const sizeOk = Number.isFinite(number) && number >= 1 && number <= 1000;
  const colorOk = color.trim() !== "" && typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("color", color.trim());
  const css = { ...nodeStyle(rt.doc(), initial) } as CSSProperties;
  const style: CSSProperties = { ...css, position: "relative", left: 0, top: 0, width: "100%", height: "auto", minHeight: "1em", transform: "none", visibility: "visible", margin: 0, pointerEvents: "auto" };
  const text = (key: string) => rt.text(`text.${key}`);

  return (
    <div
      ref={shell}
      data-testid="text-editor"
      className="pointer-events-none absolute"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      onPaste={(e) => e.stopPropagation()}
      onBlur={(e) => {
        // Focus moving between the text and the bar keeps the editor open; leaving both confirms.
        const next = e.relatedTarget;
        if (next instanceof globalThis.Node && shell.current?.contains(next)) return;
        finish(false);
      }}
    >
      <div
        ref={bar}
        className="pointer-events-auto absolute top-0 left-0 w-max origin-top-left"
        style={{ transform: `scale(calc(1 / var(--view-zoom))) translateY(calc(-100% - ${BAR_GAP}px))` }}
        onMouseDown={(e) => {
          const el = surface.current;
          if (el) saved.current = selectionOffsets(el);
          // A button must not take the selection away from the text; a field does take the focus.
          if (!(e.target instanceof HTMLElement) || !e.target.closest("input")) e.preventDefault();
        }}
      >
        <Toolbar aria-label={text("toolbar")}>
          <ToolbarGroup>
            <ToolbarButton aria-label={text("bold")} onClick={() => change(marks.bold)}>
              <Bold aria-hidden="true" />
            </ToolbarButton>
            <ToolbarButton aria-label={text("italic")} onClick={() => change(marks.italic)}>
              <Italic aria-hidden="true" />
            </ToolbarButton>
          </ToolbarGroup>
          <ToolbarSeparator />
          <TextField
            aria-label={text("size")}
            inputMode="numeric"
            className="h-7 w-11 px-1.5 text-sm"
            value={size}
            onChange={(e) => setSize(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              if (sizeOk) change(marks.size(number));
            }}
          />
          <TextField
            aria-label={text("color")}
            className="h-7 w-20 px-1.5 text-sm"
            value={color}
            placeholder={text("color")}
            onChange={(e) => setColor(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              if (colorOk) change(marks.color(color.trim()));
            }}
          />
          <TextField
            aria-label={text("link")}
            className="h-7 w-32 px-1.5 text-sm"
            value={href}
            onChange={(e) => setHref(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              if (linkOk(href)) change(marks.link(href));
            }}
          />
          <ToolbarButton aria-label={text("applyLink")} disabled={!linkOk(href)} onClick={() => change(marks.link(href))}>
            <Link2 aria-hidden="true" />
          </ToolbarButton>
        </Toolbar>
      </div>
      <div
        ref={surface}
        role="textbox"
        aria-multiline="true"
        aria-label={text("field")}
        contentEditable
        suppressContentEditableWarning
        className={`whitespace-pre-wrap ${editorOutline}`}
        style={{ ...style, ...editorOutlineStyle }}
        onKeyDown={(e) => {
          if (confirmKey(e)) {
            e.preventDefault();
            finish(true);
            return;
          }
          if (e.key !== "Enter") return;
          e.preventDefault();
          const sel = window.getSelection();
          if (!sel || sel.rangeCount === 0) return;
          const range = sel.getRangeAt(0);
          range.deleteContents();
          const br = document.createTextNode("\n");
          range.insertNode(br);
          range.setStartAfter(br);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
        }}
        onPaste={(e) => {
          // Text only: a paste from a page would bring its own styles into the runs.
          e.preventDefault();
          document.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
        }}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("a")) e.preventDefault();
        }}
      />
    </div>
  );
}
