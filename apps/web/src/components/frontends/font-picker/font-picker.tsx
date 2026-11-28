import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxGroupLabel,
  ComboboxInput,
  ComboboxItem,
  ComboboxItemIndicator,
  ComboboxList,
  ComboboxSeparator,
  ComboboxTrigger,
} from "@ui-sdk/react/combobox";
import { Check, ChevronsUpDown } from "lucide-react";
import { Fragment, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { bareInput, fieldBoxWrapper } from "@/components/ui/field-box";
import { FormField } from "@/components/ui/form-field";
import { popupItem, popupSurface } from "@/components/ui/overlay-surface";
import { cn, focusRing } from "@/lib/utils";
import { COMMON_FAMILIES, familyLabel, groupFonts } from "./groups";
import type { FontPickerProps, QueryLocalFonts } from "./types";

type SystemState = { status: "idle" } | { status: "loading" } | { status: "loaded"; fonts: string[] } | { status: "unsupported" } | { status: "failed" };

const NO_FONTS: string[] = [];

function browserQuery(): QueryLocalFonts | null {
  if (typeof window === "undefined") return null;
  const query = (window as Window & { queryLocalFonts?: QueryLocalFonts }).queryLocalFonts;
  return typeof query === "function" ? query.bind(window) : null;
}

export function FontPicker({ value, onValueChange, documentFonts = NO_FONTS, commonFonts = COMMON_FAMILIES, queryLocalFonts, disabled, className }: FontPickerProps) {
  const { t } = useTranslation();
  const [system, setSystem] = useState<SystemState>({ status: "idle" });
  const [open, setOpen] = useState(false);
  const requestId = useRef(0);
  const systemFonts = system.status === "loaded" ? system.fonts : NO_FONTS;
  const groups = useMemo(() => groupFonts({ value, documentFonts, commonFonts, systemFonts }), [value, documentFonts, commonFonts, systemFonts]);

  const loadSystem = async () => {
    const query = queryLocalFonts === undefined ? browserQuery() : queryLocalFonts;
    if (!query) {
      setSystem({ status: "unsupported" });
      return;
    }
    const id = ++requestId.current;
    setSystem({ status: "loading" });
    try {
      const records = await query();
      if (id === requestId.current) setSystem({ status: "loaded", fonts: records.map((record) => record.family) });
    } catch {
      if (id === requestId.current) setSystem({ status: "failed" });
    }
  };

  const sections = [
    { key: "document", label: t("frontends.fontPicker.groupDocument"), fonts: groups.document },
    { key: "common", label: t("frontends.fontPicker.groupCommon"), fonts: groups.common },
    { key: "system", label: t("frontends.fontPicker.groupSystem"), fonts: groups.system },
  ].filter((section) => section.fonts.length > 0);

  const systemNote =
    system.status === "loading"
      ? t("frontends.fontPicker.loadingSystem")
      : system.status === "unsupported"
        ? t("frontends.fontPicker.unsupported")
        : system.status === "failed"
          ? t("frontends.fontPicker.failed")
          : null;

  return (
    <FormField label={t("frontends.fontPicker.label")} disabled={disabled} className={className}>
      <Combobox
        value={value || null}
        onValueChange={(next) => {
          if (next && next !== value) onValueChange(next);
        }}
        open={open}
        onOpenChange={setOpen}
        allowCustomValue
        autoHighlight="selected"
        disabled={disabled}
        announcement={(change) =>
          change.type === "results" ? (change.count === 0 ? t("frontends.fontPicker.noResults") : t("frontends.fontPicker.results", { count: change.count })) : null
        }
      >
        <div className={cn("flex h-9 w-full items-center gap-px pe-2.5 ps-3", fieldBoxWrapper)}>
          <ComboboxInput aria-label={t("frontends.fontPicker.label")} placeholder={t("frontends.fontPicker.placeholder")} className={bareInput} />
          <ComboboxTrigger
            aria-label={t("frontends.fontPicker.toggle")}
            className={`-me-1 flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-xs text-fg data-disabled:cursor-not-allowed ${focusRing} focus-visible:outline-offset-0`}
          >
            <ChevronsUpDown aria-hidden="true" className="size-4" />
          </ComboboxTrigger>
        </div>
        <ComboboxContent className={cn(popupSurface, "max-h-(--available-height) overflow-y-auto")}>
          <ComboboxEmpty className="hidden px-2 py-1.5 text-base text-muted data-empty:block">{t("frontends.fontPicker.empty")}</ComboboxEmpty>
          <ComboboxList className="flex flex-col gap-0.5">
            {sections.map((section, index) => (
              <Fragment key={section.key}>
                {index > 0 ? <ComboboxSeparator className="my-1 h-px bg-line" /> : null}
                <ComboboxGroup>
                  <ComboboxGroupLabel className="px-2 py-1 text-xs font-bold tracking-[0.8px] text-muted uppercase">{section.label}</ComboboxGroupLabel>
                  {section.fonts.map((family) => (
                    <ComboboxItem key={family} value={family} label={familyLabel(family)} title={family} className={cn(popupItem, "justify-between")}>
                      <span className="min-w-0 flex-1 truncate" style={{ fontFamily: family }}>
                        {familyLabel(family)}
                      </span>
                      <ComboboxItemIndicator>
                        <Check aria-hidden="true" className="size-4 shrink-0" />
                      </ComboboxItemIndicator>
                    </ComboboxItem>
                  ))}
                </ComboboxGroup>
              </Fragment>
            ))}
          </ComboboxList>
          <div className="mt-1 flex flex-col gap-1 border-t border-line pt-1">
            <button
              type="button"
              disabled={system.status === "loading"}
              onClick={() => void loadSystem()}
              className={cn("flex h-8 cursor-pointer items-center rounded-sm px-2 text-start text-base text-fg hover:bg-surface disabled:cursor-wait disabled:text-muted", focusRing, "focus-visible:-outline-offset-2")}
            >
              {system.status === "loaded" ? t("frontends.fontPicker.refreshSystem") : t("frontends.fontPicker.useSystem")}
            </button>
            {systemNote ? (
              <p role={system.status === "failed" || system.status === "unsupported" ? "alert" : "status"} className={cn("px-2 pb-1 text-xs", system.status === "loading" ? "text-muted" : "font-medium text-red-ink")}>
                {systemNote}
              </p>
            ) : null}
          </div>
        </ComboboxContent>
      </Combobox>
    </FormField>
  );
}
