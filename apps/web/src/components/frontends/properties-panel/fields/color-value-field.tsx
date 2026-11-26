import { resolveValue, type Document } from "@paprika/core";
import { X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ColorField } from "@/components/ui/color-field";
import { ColorPicker } from "@/components/ui/color-picker";
import { TokenChip } from "@/components/ui/token-chip";
import { CommitTextField } from "./commit-text-field";
import { colorPickerLabels } from "./color-labels";

export type ColorValueFieldProps = {
  doc: Document;
  mode?: string;
  label: string;
  value: string | undefined;
  clearable?: boolean;
  onCommit: (value: string | null) => void;
  className?: string;
};

const FALLBACK = "rgb(0, 0, 0)";

function resolvedColor(doc: Document, value: string | undefined, mode?: string): string | null {
  if (!value) return null;
  const resolved = resolveValue(doc, value, mode);
  return typeof resolved === "string" && !resolved.startsWith("$") ? resolved : null;
}

const normalize = (color: string) => color.trim().toLowerCase().replace(/\s+/g, "");

export function sameColor(next: string, current: string | null): boolean {
  return current !== null && normalize(next) === normalize(current);
}

export function ColorValueField({ doc, mode, label, value, clearable = true, onCommit, className }: ColorValueFieldProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const preview = resolvedColor(doc, value, mode);
  const isToken = typeof value === "string" && value.startsWith("$");
  const pickerValue = preview ?? FALLBACK;

  return (
    <div className={className}>
      <ColorField
        value={preview ?? value ?? null}
        label={label}
        emptyLabel={t("frontends.propertiesPanel.color.none")}
        popoverLabel={t("frontends.propertiesPanel.color.popover", { field: label })}
        open={open}
        onOpenChange={setOpen}
      >
        <div className="flex flex-col gap-3">
          <ColorPicker
            labels={colorPickerLabels(t)}
            defaultValue={pickerValue}
            onValueCommit={(next) => {
              if (!sameColor(next, preview)) onCommit(next);
            }}
          />
          <CommitTextField
            label={t("frontends.propertiesPanel.color.value")}
            placeholder={t("frontends.propertiesPanel.color.placeholder")}
            value={value ?? ""}
            onCommit={(next) => onCommit(next.trim() || null)}
          />
          {clearable && value ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                onCommit(null);
                setOpen(false);
              }}
            >
              <X aria-hidden="true" />
              {t("frontends.propertiesPanel.color.remove")}
            </Button>
          ) : null}
        </div>
      </ColorField>
      {isToken ? <TokenChip className="mt-1.5" label={value as string} swatch={preview} /> : null}
    </div>
  );
}
