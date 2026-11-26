import { useEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Ellipsis, OctagonAlert, Undo2, X } from "lucide-react";
import { agentInk } from "./agents";
import { api } from "./api";
import { redoStep, setHistoryOpen, undoStep } from "./historyActions";
import {
  actorColor,
  actorName,
  filterSteps,
  flattenGroups,
  groupSteps,
  isHuman,
  relativeTime,
  type HistoryRow,
  type PanelStep,
  type PanelView,
} from "./historyModel";
import { useT } from "./i18n";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "./components/ui/alert-dialog";
import { Button, buttonVariants } from "./components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./components/ui/dropdown-menu";
import { KeyHint } from "./components/ui/toast";
import { ToggleGroup, ToggleGroupItem } from "./components/ui/toggle-group";
import { cn } from "./lib/cn";
import { useLive } from "./useDocument";

const HEADER_H = 34;
const STEP_H = 34;
const REFRESH_MS = 300;
const NOW_MS = 15_000;

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), NOW_MS);
    return () => clearInterval(id);
  }, []);
  return now;
}

function AuthorChip({ actor, name, agents }: { actor: string; name: string; agents: { actor: string; color: string }[] }) {
  const color = actorColor(actor, agents);
  return (
    <span
      className={cn("history-chip inline-flex h-5 items-center rounded-full px-2.5 text-xs font-bold", !color && "bg-human text-human-ink")}
      style={color ? { background: color, color: agentInk(color) } : undefined}
      data-author={isHuman(actor) ? "human" : "agent"}
    >
      {name}
    </span>
  );
}

export function HistoryPanel({ docId, onSelectNodes }: { docId: string; onSelectNodes: (ids: string[]) => void }) {
  const m = useT();
  const version = useLive((s) => s.version);
  const agents = useLive((s) => s.agents);
  const [mineOnly, setMineOnly] = useState(false);
  const [confirm, setConfirm] = useState<PanelStep | null>(null);
  const settled = useDebounced(version, REFRESH_MS);
  const now = useNow();
  const section = useRef<HTMLElement>(null);
  const scroller = useRef<HTMLDivElement>(null);

  const query = useQuery({
    queryKey: ["history", docId, settled],
    queryFn: ({ signal }) => api<PanelView>(`/api/workspaces/${encodeURIComponent(docId)}/history`, { signal }),
    placeholderData: keepPreviousData,
  });

  const rows = useMemo<HistoryRow[]>(() => flattenGroups(groupSteps(filterSteps(query.data?.steps ?? [], mineOnly))), [query.data, mineOnly]);

  const virtual = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: (i) => (rows[i]?.kind === "header" ? HEADER_H : STEP_H),
    overscan: 10,
    getItemKey: (i) => {
      const row = rows[i];
      return row ? (row.kind === "header" ? `h:${row.group.key}` : `s:${row.step.id}`) : i;
    },
  });

  useEffect(() => {
    section.current?.focus();
  }, []);

  const nameOf = (actor: string) => actorName(actor, m.historyYou);
  const agoOf = (at: number) => {
    const t = relativeTime(at, now, m.now);
    return t === m.now || /^\d+ s$/.test(t) ? m.historyFewSeconds : m.historyAgo(t);
  };

  const copy = (label: string) => {
    navigator.clipboard?.writeText(label).catch(() => {});
  };

  const requestUndo = (step: PanelStep) => {
    if (isHuman(step.actor)) void undoStep(step.id);
    else setConfirm(step);
  };

  return (
    <section
      ref={section}
      tabIndex={-1}
      aria-label={m.historyTitle}
      data-testid="history-panel"
      className="absolute top-14 right-3 bottom-3 z-30 flex w-[350px] max-w-[calc(100%-1.5rem)] flex-col gap-2.5 rounded-lg border border-ui-border bg-ui-popover p-3 text-ui-popover-foreground shadow-float outline-none"
      onKeyDown={(e) => {
        if (e.key === "Escape" && e.currentTarget.contains(e.target as Node) && !e.defaultPrevented) {
          e.stopPropagation();
          setHistoryOpen(false);
        }
      }}
    >
      <header className="flex items-center gap-1.5">
        <h2 className="m-0 text-md font-bold">{m.historyTitle}</h2>
        <KeyHint>Ctrl</KeyHint>
        <KeyHint>H</KeyHint>
        <Button className="ml-auto size-6 border-0" variant="ghost" size="icon" aria-label={m.historyClose} onClick={() => setHistoryOpen(false)}>
          <X aria-hidden />
        </Button>
      </header>
      <ToggleGroup
        type="single"
        aria-label={m.historyFilter}
        value={mineOnly ? "mine" : "all"}
        onValueChange={(v) => v && setMineOnly(v === "mine")}
        className="grid grid-cols-2 gap-0 rounded-md border border-ui-input p-0.5"
      >
        <ToggleGroupItem value="all" size="xs" className="history-filter-all border-0">
          {m.historyAll}
        </ToggleGroupItem>
        <ToggleGroupItem value="mine" size="xs" className="history-filter-mine border-0">
          {m.historyMine}
        </ToggleGroupItem>
      </ToggleGroup>
      <div ref={scroller} className="min-h-0 flex-1 overflow-auto" role="group" aria-label={m.historyList} tabIndex={-1}>
        {rows.length === 0 ? (
          <p className="m-0 p-2 text-xs text-ui-muted-foreground">{query.isPending ? "" : mineOnly ? m.historyEmptyMine : m.historyEmpty}</p>
        ) : (
          <div className="relative w-full" style={{ height: virtual.getTotalSize() }}>
            {virtual.getVirtualItems().map((vi) => {
              const row = rows[vi.index]!;
              return (
                <div key={vi.key} className="absolute top-0 left-0 w-full" style={{ height: vi.size, transform: `translateY(${vi.start}px)` }}>
                  {row.kind === "header" ? (
                    <div role="heading" aria-level={3} className="flex h-full items-center gap-2 px-1 text-xs text-ui-muted-foreground">
                      <AuthorChip actor={row.group.actor} name={nameOf(row.group.actor)} agents={agents} />
                      <span>
                        {m.historySteps(row.group.steps.length)} · {relativeTime(row.group.newestAt, now, m.now)}
                      </span>
                    </div>
                  ) : (
                    <StepRow
                      step={row.step}
                      who={nameOf(row.step.actor)}
                      when={relativeTime(row.step.at, now, m.now)}
                      onSelect={() => onSelectNodes(row.step.nodeIds)}
                      onUndo={() => requestUndo(row.step)}
                      onRedo={() => void redoStep(row.step.id)}
                      onCopy={() => copy(row.step.label)}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      <p className="m-0 text-xs text-ui-muted-foreground">{m.historyFooter}</p>
      <AlertDialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent data-testid="history-confirm">
          {confirm && (
            <>
              <AlertDialogHeader>
                <div className="flex items-center gap-2.5">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-ui-destructive/20 text-ui-destructive-text" data-testid="history-confirm-icon">
                    <OctagonAlert className="size-4" aria-hidden />
                  </span>
                  <AlertDialogTitle>{m.historyConfirmTitle(nameOf(confirm.actor))}</AlertDialogTitle>
                </div>
                <AlertDialogDescription>{m.historyConfirmBody(confirm.label, nameOf(confirm.actor), agoOf(confirm.at))}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{m.cancel}</AlertDialogCancel>
                <AlertDialogAction
                  className={cn(buttonVariants({ variant: "destructive", size: "sm" }), "history-confirm-action")}
                  onClick={() => {
                    const id = confirm.id;
                    setConfirm(null);
                    void undoStep(id);
                  }}
                >
                  {m.historyConfirmAction}
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function StepRow({
  step,
  who,
  when,
  onSelect,
  onUndo,
  onRedo,
  onCopy,
}: {
  step: PanelStep;
  who: string;
  when: string;
  onSelect: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onCopy: () => void;
}) {
  const m = useT();
  const [menu, setMenu] = useState(false);
  return (
    <div
      data-testid="history-step"
      data-step-id={step.id}
      data-undone={step.undone ? "true" : "false"}
      data-actor={step.actor}
      className={cn("group flex h-full items-center rounded-md hover:bg-ui-accent focus-within:bg-ui-accent", menu && "bg-ui-accent")}
    >
      <button
        type="button"
        className="flex h-full min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent px-2 text-left text-sm text-inherit outline-none focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ui-ring"
        aria-label={m.historySelectStep(step.label, who, `${when}${step.undone ? `, ${m.historyUndone}` : ""}`)}
        onClick={onSelect}
      >
        {step.undone && <Undo2 className="size-3.5 shrink-0 text-ui-muted-foreground" aria-hidden />}
        <span className={cn("truncate", step.undone && "text-ui-muted-foreground")}>{step.label || who}</span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5 text-xs text-ui-muted-foreground">
          {step.undone && <strong className="font-bold">{m.historyUndone}</strong>}
          {when}
        </span>
      </button>
      <DropdownMenu open={menu} onOpenChange={setMenu}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="history-step-menu mr-1 size-6 border-0 shrink-0 text-ui-muted-foreground opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
            aria-label={m.historyStepActions(step.label)}
          >
            <Ellipsis aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="bottom">
          {step.undone ? (
            <DropdownMenuItem onSelect={onRedo}>{m.historyRedoStep}</DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={onUndo}>{m.historyUndoStep}</DropdownMenuItem>
          )}
          <DropdownMenuItem disabled={step.nodeIds.length === 0} onSelect={onSelect}>
            {m.historySelectNodes}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onCopy}>{m.historyCopyLabel}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
