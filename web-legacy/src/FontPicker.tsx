import { useEffect, useMemo, useState } from "react";
import type { Document, Node } from "@paprika/core";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "./components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "./components/ui/command";
import { Label } from "./components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "./components/ui/popover";
import { fieldShell } from "./inspector/fields";
import { cn } from "./lib/cn";

const COMMON_FAMILIES = [
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

type LocalFontAccess = {
  queryLocalFonts?: () => Promise<ReadonlyArray<{ family: string }>>;
};

function collectDocFonts(doc: Document): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const node of Object.values(doc.nodes) as Node[]) {
    const family = "fontFamily" in node ? node.fontFamily : undefined;
    if (typeof family !== "string" || !family.trim() || seen.has(family)) continue;
    seen.add(family);
    out.push(family);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set([...values].map((v) => v.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function previewFamily(stack: string): string {
  return stack.split(",")[0]?.trim() || stack;
}

export function FontPicker({
  doc,
  value,
  onCommit,
}: {
  doc: Document;
  value: string;
  onCommit(v: string): void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [systemFonts, setSystemFonts] = useState<string[] | null>(null);
  const [systemError, setSystemError] = useState<string | null>(null);
  const [systemLoading, setSystemLoading] = useState(false);

  const docFonts = useMemo(() => collectDocFonts(doc), [doc]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setSystemError(null);
    }
  }, [open]);

  const common = useMemo(() => uniqueSorted(COMMON_FAMILIES), []);
  const inDocument = useMemo(
    () => uniqueSorted(docFonts.filter((f) => !common.includes(f))),
    [docFonts, common],
  );
  const fromSystem = useMemo(() => {
    if (!systemFonts) return [];
    const blocked = new Set([...common, ...inDocument]);
    return uniqueSorted(systemFonts.filter((f) => !blocked.has(f)));
  }, [systemFonts, common, inDocument]);

  const q = query.trim();
  const known = useMemo(() => new Set([...common, ...inDocument, ...fromSystem]), [common, inDocument, fromSystem]);
  const canUseCustom = q.length > 0 && !known.has(q);

  const loadSystemFonts = async () => {
    const api = window as Window & LocalFontAccess;
    if (typeof api.queryLocalFonts !== "function") {
      setSystemError("Este navegador não expõe as fontes locais.");
      return;
    }
    setSystemLoading(true);
    setSystemError(null);
    try {
      const fonts = await api.queryLocalFonts();
      setSystemFonts(uniqueSorted(fonts.map((f) => f.family)));
    } catch (e) {
      setSystemFonts(null);
      setSystemError(e instanceof Error ? e.message : "Não foi possível ler as fontes do sistema.");
    } finally {
      setSystemLoading(false);
    }
  };

  const pick = (family: string) => {
    const next = family.trim();
    if (!next) return;
    setOpen(false);
    if (next !== value) onCommit(next);
  };

  return (
    <div className={fieldShell()}>
      <Label>Fonte</Label>
      <Popover open={open} onOpenChange={setOpen} modal={false}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            role="combobox"
            aria-expanded={open}
            aria-label="Fonte"
            data-testid="font-picker"
            className={cn(
              "h-7 min-w-0 justify-between gap-1 border-0 bg-transparent px-0 font-normal shadow-none hover:bg-transparent",
              "focus-visible:border-0 focus-visible:outline-none focus-visible:outline-offset-0",
            )}
            style={{ fontFamily: value || undefined }}
          >
            <span className="truncate">{value || "escolher…"}</span>
            <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" aria-hidden />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-72 p-0"
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Buscar fonte…"
              value={query}
              onValueChange={setQuery}
              onKeyDown={(e) => {
                if (e.key === "Enter" && canUseCustom) {
                  e.preventDefault();
                  pick(q);
                }
              }}
            />
            <CommandList data-testid="font-picker-list">
              <CommandEmpty>
                {canUseCustom ? (
                  <button type="button" className="w-full cursor-pointer border-0 bg-transparent px-2 py-1 text-left text-sm text-ui-foreground" onClick={() => pick(q)}>
                    Usar “{q}”
                  </button>
                ) : (
                  "Nenhuma fonte."
                )}
              </CommandEmpty>
              {canUseCustom && (
                <CommandGroup heading="Personalizada">
                  <CommandItem value={`custom:${q}`} onSelect={() => pick(q)} data-testid="font-picker-custom">
                    <span className="truncate" style={{ fontFamily: q }}>
                      Usar “{q}”
                    </span>
                  </CommandItem>
                </CommandGroup>
              )}
              {inDocument.length > 0 && (
                <CommandGroup heading="No documento">
                  {inDocument
                    .filter((f) => !q || f.toLowerCase().includes(q.toLowerCase()))
                    .map((f) => (
                      <FontOption key={`doc:${f}`} family={f} selected={f === value} onSelect={pick} />
                    ))}
                </CommandGroup>
              )}
              <CommandGroup heading="Comuns">
                {common
                  .filter((f) => !q || f.toLowerCase().includes(q.toLowerCase()))
                  .map((f) => (
                    <FontOption key={`common:${f}`} family={f} selected={f === value} onSelect={pick} />
                  ))}
              </CommandGroup>
              {fromSystem.length > 0 && (
                <CommandGroup heading="Sistema">
                  {fromSystem
                    .filter((f) => !q || f.toLowerCase().includes(q.toLowerCase()))
                    .map((f) => (
                      <FontOption key={`sys:${f}`} family={f} selected={f === value} onSelect={pick} />
                    ))}
                </CommandGroup>
              )}
            </CommandList>
            <CommandSeparator />
            <div className="p-1.5">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 w-full justify-start px-2 text-ui-link"
                data-testid="font-picker-system"
                disabled={systemLoading}
                onClick={() => void loadSystemFonts()}
              >
                {systemLoading ? "Lendo fontes…" : systemFonts ? "Atualizar fontes do sistema" : "Usar fontes do sistema…"}
              </Button>
              {systemError && (
                <p role="status" className="m-0 px-2 pb-1 text-2xs text-ui-destructive-text">
                  {systemError}
                </p>
              )}
            </div>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function FontOption({ family, selected, onSelect }: { family: string; selected: boolean; onSelect(v: string): void }) {
  return (
    <CommandItem value={family} onSelect={() => onSelect(family)} data-testid={`font-option-${previewFamily(family)}`}>
      <Check className={cn("size-3.5 shrink-0", selected ? "opacity-100" : "opacity-0")} aria-hidden />
      <span className="truncate" style={{ fontFamily: family }}>
        {family}
      </span>
    </CommandItem>
  );
}
