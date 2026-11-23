import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent, type RefObject } from "react";
import { Check, Crosshair, MessageSquareText, RotateCcw, Trash2, X } from "lucide-react";
import type { Document } from "@paprika/core";
import { Button } from "./components/ui/button";
import { Hint } from "./components/ui/tooltip";
import { useT } from "./i18n";
import { useLive } from "./useDocument";
import { AGENT_COLORS, agentInk } from "./agents";
import { actorLabel, onPage, setPinsPanel, usePinActions, usePins, usePinsPanel, type Pin, type PinRegion } from "./pins";
import { errorText } from "./api";
import { cx } from "./ui";
import type { Box } from "./AgentCursors";

interface View {
  x: number;
  y: number;
  zoom: number;
}

interface Props {
  doc: Document;
  view: View;
  viewportRef: RefObject<HTMLDivElement | null>;
  pageId: string | null;
  /** The pin tool is active: the layer captures clicks and drags. */
  active: boolean;
  onToolDone(): void;
  /** Changes when the layout changes without the document changing (a drag in progress). */
  layoutKey?: unknown;
  onFocus?(box: Box): void;
  onOpenPage?(id: string): void;
  onError?(msg: string): void;
}

/** The node a click lands on: the outermost group or instance stays whole, like a selection click. */
function nodeUnder(doc: Document, clientX: number, clientY: number): string | null {
  for (const el of document.elementsFromPoint(clientX, clientY)) {
    if (el.closest("[data-pin-layer]")) continue;
    const hit = el.closest<HTMLElement>("[data-paprika-id]");
    if (!hit) continue;
    let id = hit.dataset.paprikaId!;
    for (let p = doc.nodes[id]?.parentId; p; p = doc.nodes[p]?.parentId ?? null) {
      const t = doc.nodes[p]?.type;
      if (t === "group" || (doc.nodes[p] as { instanceOf?: string } | undefined)?.instanceOf) id = p;
    }
    return doc.nodes[id]?.type === "page" ? null : id;
  }
  return null;
}

interface Draft {
  nodeId: string | null;
  region: PinRegion;
}

const PIN_RED = "var(--color-accent)";
const NO_PINS: Pin[] = [];

const sameBoxes = (a: Record<string, PinRegion>, b: Record<string, PinRegion>) => {
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => {
    const x = a[k]!;
    const y = b[k];
    return !!y && x.x === y.x && x.y === y.y && x.width === y.width && x.height === y.height;
  });
};

/** Agent color for a claim: the presence color when the agent is on the canvas, else a stable one. */
function useClaimColor() {
  const agents = useLive((s) => s.agents);
  return (actor: string | undefined) => {
    const live = agents.find((a) => a.actor === actor);
    if (live) return live.color;
    let h = 0;
    for (const c of actor ?? "") h = (h * 31 + c.charCodeAt(0)) | 0;
    return AGENT_COLORS[Math.abs(h) % AGENT_COLORS.length]!;
  };
}

/**
 * "Apontar para a IA": with the pin tool, a click on an element pins it and a drag marks an area; a
 * composer opens next to the pin. Open and claimed pins of the page show on the canvas (outline + numbered
 * pin); the Pins panel lists every pin of the workspace.
 */
export function PinLayer({ doc, view, viewportRef, pageId, active, onToolDone, layoutKey, onFocus, onOpenPage, onError }: Props) {
  const m = useT();
  const pins = usePins(doc.id).data ?? NO_PINS;
  const { create } = usePinActions(doc.id);
  const shown = useMemo(() => onPage(pins, pageId), [pins, pageId]);
  const [boxes, setBoxes] = useState<Record<string, PinRegion>>({});
  const [drag, setDrag] = useState<PinRegion | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [text, setText] = useState("");
  const [openPin, setOpenPin] = useState<string | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const claimColor = useClaimColor();

  const toWorld = (clientX: number, clientY: number) => {
    const r = viewportRef.current!.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (clientX - r.left - v.x) / v.zoom, y: (clientY - r.top - v.y) / v.zoom };
  };
  const worldBox = (el: Element): PinRegion => {
    const r = el.getBoundingClientRect();
    const a = toWorld(r.left, r.top);
    const v = viewRef.current;
    return { x: Math.round(a.x), y: Math.round(a.y), width: Math.round(r.width / v.zoom), height: Math.round(r.height / v.zoom) };
  };

  // Node pins follow their node: measure the node's box in canvas coordinates from the DOM.
  useLayoutEffect(() => {
    const next: Record<string, PinRegion> = {};
    for (const p of shown) {
      if (!p.nodeId) continue;
      const el = viewportRef.current?.querySelector(`[data-paprika-id="${CSS.escape(p.nodeId)}"]`);
      if (el) next[p.id] = worldBox(el);
    }
    setBoxes((cur) => (sameBoxes(cur, next) ? cur : next));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, doc, layoutKey, view.zoom]);

  // Leaving the tool drops an unsent pin.
  useEffect(() => {
    if (!active) {
      setDraft(null);
      setDrag(null);
    }
  }, [active]);

  const onDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const p0 = toWorld(e.clientX, e.clientY);
    const sx = e.clientX;
    const sy = e.clientY;
    let moved = false;
    const box = (p: { x: number; y: number }): PinRegion => ({
      x: Math.round(Math.min(p0.x, p.x)),
      y: Math.round(Math.min(p0.y, p.y)),
      width: Math.round(Math.abs(p.x - p0.x)),
      height: Math.round(Math.abs(p.y - p0.y)),
    });
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return;
      moved = true;
      setDrag(box(toWorld(ev.clientX, ev.clientY)));
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDrag(null);
      setText("");
      if (moved) {
        setDraft({ nodeId: null, region: box(toWorld(ev.clientX, ev.clientY)) });
        return;
      }
      const id = nodeUnder(doc, ev.clientX, ev.clientY);
      const el = id ? viewportRef.current?.querySelector(`[data-paprika-id="${CSS.escape(id)}"]`) : null;
      if (id && el) setDraft({ nodeId: id, region: worldBox(el) });
      else setDraft({ nodeId: null, region: { x: Math.round(p0.x), y: Math.round(p0.y), width: 0, height: 0 } });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const submit = () => {
    const body = text.trim();
    if (!draft || !body) return;
    create.mutate(
      { workspaceId: doc.id, pageId, nodeId: draft.nodeId, region: draft.region, text: body },
      {
        onSuccess: () => {
          setDraft(null);
          setText("");
          onToolDone();
        },
        onError: (err) => onError?.(m.pinSaveFail(errorText(err))),
      },
    );
  };
  const cancel = () => {
    setDraft(null);
    setText("");
  };

  const screen = (b: PinRegion) => ({ left: view.x + b.x * view.zoom, top: view.y + b.y * view.zoom, width: b.width * view.zoom, height: b.height * view.zoom });

  return (
    <div data-pin-layer className="pointer-events-none absolute inset-0 z-5" data-testid="pin-layer">
      {active && (
        <div
          className="pointer-events-auto absolute inset-0 cursor-crosshair"
          data-testid="pin-capture"
          aria-label={m.toolPin}
          onPointerDown={onDown}
        />
      )}
      {shown.map((p) => {
        const b = screen(boxes[p.id] ?? p.region);
        const claimed = p.status === "claimed";
        const color = claimed ? claimColor(p.claimedBy) : PIN_RED;
        const area = !p.nodeId;
        const left = area ? b.left : b.left + b.width;
        return (
          <div key={p.id} data-pin={p.n} data-pin-status={p.status}>
            {(b.width > 0 || b.height > 0) && (
              <div
                className={cx("absolute rounded-md", area && "bg-accent-soft")}
                style={{ ...b, outline: `2px ${area ? "dashed" : "solid"} ${color}`, outlineOffset: 2 }}
                aria-hidden
              />
            )}
            <button
              type="button"
              className="pointer-events-auto absolute flex size-6.5 -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border-2 border-white text-xs font-bold shadow-float focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-ring"
              style={{ left, top: b.top, background: color, color: claimed ? agentInk(color) : "#fff" }}
              aria-label={m.pinBadge(p.n)}
              aria-expanded={openPin === p.id}
              data-testid="pin-badge"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => setOpenPin(openPin === p.id ? null : p.id)}
            >
              {p.n}
            </button>
            {openPin === p.id && (
              <div className="pointer-events-auto absolute w-70" style={{ left: left + 18, top: b.top - 12 }} onPointerDown={(e) => e.stopPropagation()}>
                <PinCard pin={p} color={color} onClose={() => setOpenPin(null)} onError={onError} />
              </div>
            )}
          </div>
        );
      })}
      {drag && (
        <div className="absolute rounded-md bg-accent-soft" style={{ ...screen(drag), outline: `2px dashed ${PIN_RED}`, outlineOffset: 2 }} data-testid="pin-drag" aria-hidden />
      )}
      {draft && (
        <>
          {(draft.region.width > 0 || draft.region.height > 0) && (
            <div
              className={cx("absolute rounded-md", !draft.nodeId && "bg-accent-soft")}
              style={{ ...screen(draft.region), outline: `2px ${draft.nodeId ? "solid" : "dashed"} ${PIN_RED}`, outlineOffset: 2 }}
              aria-hidden
            />
          )}
          <PinComposer
            doc={doc}
            draft={draft}
            at={{ left: screen(draft.region).left + screen(draft.region).width, top: screen(draft.region).top }}
            text={text}
            busy={create.isPending}
            onText={setText}
            onSubmit={submit}
            onCancel={cancel}
          />
        </>
      )}
      <PinsPanel doc={doc} pins={pins} pageId={pageId} claimColor={claimColor} onFocus={onFocus} onOpenPage={onOpenPage} onError={onError} />
    </div>
  );
}

function Kbd({ children }: { children: string }) {
  return <kbd className="rounded-sm border border-line bg-night px-1 text-2xs font-semibold text-muted">{children}</kbd>;
}

function PinComposer(props: {
  doc: Document;
  draft: Draft;
  at: { left: number; top: number };
  text: string;
  busy: boolean;
  onText(t: string): void;
  onSubmit(): void;
  onCancel(): void;
}) {
  const m = useT();
  const { draft } = props;
  const target = draft.nodeId ? (props.doc.nodes[draft.nodeId]?.name ?? draft.nodeId) : m.pinArea(draft.region.width, draft.region.height);
  return (
    <div
      role="dialog"
      aria-label={m.pinComposer}
      className="pointer-events-auto absolute flex w-90 flex-col gap-2.5 rounded-xl border border-line bg-panel p-3 text-fg shadow-float"
      style={{ left: props.at.left + 18, top: props.at.top }}
      data-testid="pin-composer"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-1.5 text-xs">
        <span className="text-muted">{m.pinTarget}</span>
        <span className="truncate rounded-full bg-panel-2 px-2 py-0.5 font-semibold">{target}</span>
      </div>
      <textarea
        autoFocus
        rows={3}
        maxLength={2000}
        value={props.text}
        placeholder={m.pinPlaceholder}
        aria-label={m.pinPlaceholder}
        className="min-h-20 resize-y rounded-lg border border-select bg-night p-2 text-sm text-fg outline-none"
        onChange={(e) => props.onText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            props.onSubmit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            props.onCancel();
          }
        }}
      />
      <div className="flex items-center gap-1.5 text-xs">
        <span className="text-muted">{m.pinTo}</span>
        <span className="shrink-0 rounded-full bg-panel-2 px-2 py-0.5 font-semibold whitespace-nowrap">{m.pinAnyAgent}</span>
        <span className="flex-1" />
        <Button variant="secondary" size="sm" onClick={props.onCancel}>
          {m.cancel}
        </Button>
        <Button size="sm" disabled={!props.text.trim() || props.busy} onClick={props.onSubmit} data-testid="pin-send">
          {m.pinSend}
        </Button>
      </div>
      <div className="flex items-center gap-1 text-2xs text-muted">
        <Kbd>Ctrl</Kbd>
        <Kbd>Enter</Kbd>
        <span>{m.pinSendKeys}</span>
        <Kbd>Esc</Kbd>
        <span>{m.pinCancelKeys}</span>
      </div>
    </div>
  );
}

function relative(at: number, now: number, nowLabel: string) {
  const s = Math.max(0, Math.floor((now - at) / 1000));
  if (s < 30) return nowLabel;
  const min = Math.floor(s / 60);
  if (min < 60) return `${Math.max(1, min)} min`;
  const h = Math.floor(min / 60);
  return h < 24 ? `${h} h` : `${Math.floor(h / 24)} d`;
}

function StatusChip({ pin, color }: { pin: Pin; color: string }) {
  const m = useT();
  if (pin.status === "resolved") return <span className="rounded-full bg-leaf/25 px-2 py-0.5 text-2xs font-semibold text-fg">{m.pinStatusResolved}</span>;
  if (pin.status === "claimed")
    return (
      <span className="rounded-full px-2 py-0.5 text-2xs font-semibold" style={{ background: color, color: agentInk(color) }}>
        {m.pinStatusClaimed(actorLabel(pin.claimedBy))}
      </span>
    );
  return <span className="rounded-full bg-accent-soft px-2 py-0.5 text-2xs font-semibold text-accent-ink">{m.pinStatusOpen}</span>;
}

function targetLabel(pin: Pin, m: ReturnType<typeof useT>) {
  if (pin.nodeId) return pin.nodeMissing ? m.pinNodeGone : (pin.nodeName ?? pin.nodeId);
  return m.pinArea(Math.round(pin.region.width), Math.round(pin.region.height));
}

/** The pin's text, status and actions (bubble on the canvas and row of the panel). */
function PinCard({ pin, color, onClose, onError, onShow }: { pin: Pin; color: string; onClose?(): void; onError?(msg: string): void; onShow?(): void }) {
  const m = useT();
  const { patch, remove } = usePinActions(pin.workspaceId);
  const fail = (err: unknown) => onError?.(m.pinSaveFail(errorText(err)));
  const now = Date.now();
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line bg-panel p-3 text-fg shadow-float" data-testid="pin-card">
      <div className="flex items-center gap-1.5 text-xs">
        <MessageSquareText size={14} className="shrink-0 text-accent-ink" aria-hidden />
        <strong className="truncate">{pin.author === "user" ? m.you : actorLabel(pin.author)}</strong>
        <span className="text-muted">{relative(pin.createdAt, now, m.now)}</span>
        <span className="flex-1" />
        {onClose && (
          <button type="button" className="cursor-pointer rounded-sm border-0 bg-transparent p-0.5 text-muted hover:bg-panel-2 hover:text-fg" aria-label={m.close} onClick={onClose}>
            <X size={14} aria-hidden />
          </button>
        )}
      </div>
      <p className="m-0 text-sm whitespace-pre-wrap">{pin.text}</p>
      <div className="flex flex-wrap items-center gap-1.5 text-2xs text-muted">
        <StatusChip pin={pin} color={color} />
        <span>{targetLabel(pin, m)}</span>
      </div>
      {pin.status === "claimed" && <p className="m-0 text-xs" style={{ color }}>{m.pinWorking(actorLabel(pin.claimedBy))}</p>}
      {pin.reply && (
        <div className="rounded-lg border border-line bg-night p-2 text-xs">
          <div className="mb-1 font-semibold text-muted">{m.pinReplied(actorLabel(pin.resolvedBy || pin.claimedBy))}</div>
          <p className="m-0 whitespace-pre-wrap">{pin.reply}</p>
        </div>
      )}
      <div className="flex flex-wrap gap-1.5">
        {onShow && (
          <Button variant="secondary" size="xs" onClick={onShow}>
            <Crosshair aria-hidden />
            {m.pinShow}
          </Button>
        )}
        {pin.status === "resolved" ? (
          <Button variant="secondary" size="xs" onClick={() => patch.mutate({ id: pin.id, body: { status: "open" } }, { onError: fail })}>
            <RotateCcw aria-hidden />
            {m.pinReopen}
          </Button>
        ) : (
          <Button variant="secondary" size="xs" onClick={() => patch.mutate({ id: pin.id, body: { status: "resolved" } }, { onError: fail })}>
            <Check aria-hidden />
            {m.pinResolve}
          </Button>
        )}
        <Hint label={m.pinDelete}>
          <Button variant="secondary" size="xs" aria-label={m.pinDelete} className="text-ui-destructive-text" onClick={() => remove.mutate(pin.id, { onError: fail })}>
            <Trash2 aria-hidden />
          </Button>
        </Hint>
      </div>
    </div>
  );
}

type Filter = "open" | "resolved" | "all";

function PinsPanel(props: {
  doc: Document;
  pins: Pin[];
  pageId: string | null;
  claimColor(actor: string | undefined): string;
  onFocus?(box: Box): void;
  onOpenPage?(id: string): void;
  onError?(msg: string): void;
}) {
  const m = useT();
  const open = usePinsPanel();
  const [filter, setFilter] = useState<Filter>("open");
  if (!open) return null;
  const openPins = props.pins.filter((p) => p.status !== "resolved");
  const resolved = props.pins.filter((p) => p.status === "resolved");
  const list = filter === "open" ? openPins : filter === "resolved" ? resolved : props.pins;
  const show = (p: Pin) => {
    if (p.pageId && p.pageId !== props.pageId) props.onOpenPage?.(p.pageId);
    const r = p.region;
    props.onFocus?.({ x: r.x, y: r.y, w: Math.max(r.width, 1), h: Math.max(r.height, 1) });
  };
  const tabs: { id: Filter; label: string }[] = [
    { id: "open", label: m.pinsFilterOpen(openPins.length) },
    { id: "resolved", label: m.pinsFilterResolved(resolved.length) },
    { id: "all", label: m.pinsFilterAll },
  ];
  return (
    <section
      aria-label={m.pinsTitle}
      className="pointer-events-auto absolute top-14 left-3 flex max-h-[calc(100%-7rem)] w-85 flex-col gap-3 rounded-xl border border-line bg-panel p-3.5 text-fg shadow-float"
      data-testid="pins-panel"
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <header className="flex items-center gap-2">
        <h2 className="m-0 text-sm font-bold">{m.pinsTitle}</h2>
        <span className="flex-1" />
        <Kbd>Shift</Kbd>
        <Kbd>I</Kbd>
        <button type="button" className="cursor-pointer rounded-sm border-0 bg-transparent p-0.5 text-muted hover:bg-panel-2 hover:text-fg" aria-label={m.close} onClick={() => setPinsPanel(false)}>
          <X size={14} aria-hidden />
        </button>
      </header>
      <div className="flex gap-1.5" role="group" aria-label={m.pinsTitle}>
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-pressed={filter === t.id}
            className={cx(
              "cursor-pointer rounded-full border-0 px-2.5 py-1 text-xs font-semibold",
              filter === t.id ? "bg-ui-primary text-white" : "bg-panel-2 text-muted hover:text-fg",
            )}
            onClick={() => setFilter(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <ol className="m-0 flex min-h-0 list-none flex-col gap-2 overflow-auto p-0">
        {list.length === 0 && <li className="text-xs text-muted">{m.pinsEmpty}</li>}
        {list.map((p) => {
          const color = p.status === "claimed" ? props.claimColor(p.claimedBy) : p.status === "resolved" ? "var(--color-leaf)" : PIN_RED;
          return (
            <li key={p.id} className="flex items-start gap-2" data-testid="pins-panel-item">
              <span
                className="mt-2 flex size-6.5 shrink-0 items-center justify-center rounded-full border-2 border-white text-xs font-bold"
                style={{ background: color, color: p.status === "claimed" ? agentInk(props.claimColor(p.claimedBy)) : "#fff" }}
                aria-hidden
              >
                {p.status === "resolved" ? <Check size={12} /> : p.n}
              </span>
              <div className="min-w-0 flex-1">
                <PinCard pin={p} color={color} onError={props.onError} onShow={() => show(p)} />
              </div>
            </li>
          );
        })}
      </ol>
      <p className="m-0 text-2xs text-muted">{m.pinsHint}</p>
    </section>
  );
}

/** Top bar chip: how many pins are open; it opens the Pins panel. Hidden when there are none. */
export function PinsChip({ workspaceId }: { workspaceId: string }) {
  const m = useT();
  const pins = usePins(workspaceId).data ?? NO_PINS;
  const open = pins.filter((p) => p.status === "open").length;
  return (
    <Hint label={m.pinsToggle} side="bottom">
      <button
        type="button"
        className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border-0 bg-accent-soft px-2.5 py-0.75 text-xs font-semibold text-accent-ink"
        data-testid="pins-chip"
        onClick={() => setPinsPanel((v) => !v)}
      >
        <span className="size-2 rounded-full bg-accent" aria-hidden />
        {open ? m.pinsOpenCount(open) : m.pinsTitle}
      </button>
    </Hint>
  );
}
