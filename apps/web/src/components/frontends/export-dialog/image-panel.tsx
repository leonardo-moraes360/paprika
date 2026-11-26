import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Checkbox } from "@/components/ui/checkbox";
import { ExportImage } from "@/components/ui/export-image";
import { NumberField } from "@/components/ui/number-field";
import { Select } from "@/components/ui/select";
import { imageFileName, scaledSize } from "./download";
import type { ExportImageFormat, ExportOption, ExportSize } from "./types";

export type ImageState = {
  format: string;
  scale: number;
  custom: ExportSize | null;
  keepRatio: boolean;
  transparent: boolean;
  scope: string | null;
};

export type ImagePanelProps = {
  state: ImageState;
  formats: readonly ExportImageFormat[];
  scales: readonly number[];
  scopes: readonly ExportOption[];
  size?: ExportSize;
  fileName: string;
  onChange: (patch: Partial<ImageState>) => void;
  onExport: () => unknown;
};

export function currentSize(state: ImageState, size: ExportSize | undefined): ExportSize | null {
  if (!size) return null;
  return state.custom ?? scaledSize(size, state.scale);
}

export function ImagePanel({ state, formats, scales, scopes, size, fileName, onChange, onExport }: ImagePanelProps) {
  const { t } = useTranslation();
  const format = formats.find((option) => option.value === state.format);
  const vector = format?.vector === true;
  const shown = vector ? null : currentSize(state, size);
  const [draft, setDraft] = useState<{ width?: number | null; height?: number | null }>({});

  const setWidth = (value: number | null) => {
    setDraft((current) => ({ ...current, width: undefined }));
    if (value === null || value < 1 || !size || !shown) return;
    const width = Math.round(value);
    const height = state.keepRatio ? Math.max(1, Math.round((width * size.height) / size.width)) : shown.height;
    onChange({ custom: { width, height } });
  };
  const setHeight = (value: number | null) => {
    setDraft((current) => ({ ...current, height: undefined }));
    if (value === null || value < 1 || !size || !shown) return;
    const height = Math.round(value);
    const width = state.keepRatio ? Math.max(1, Math.round((height * size.width) / size.height)) : shown.width;
    onChange({ custom: { width, height } });
  };

  return (
    <div className="flex flex-col gap-3">
      {scopes.length > 0 ? (
        <Select
          label={t("frontends.exportDialog.image.scope")}
          options={[...scopes]}
          value={state.scope ?? scopes[0]?.value}
          onValueChange={(next) => next && onChange({ scope: next })}
        />
      ) : null}
      {shown && size ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs leading-[1.4] font-semibold text-muted">{t("frontends.exportDialog.image.size")}</span>
          <div className="flex items-start gap-2">
            <NumberField
              aria-label={t("frontends.exportDialog.image.width")}
              prefix={t("frontends.exportDialog.image.width")}
              incrementLabel={t("frontends.exportDialog.image.widthIncrement")}
              decrementLabel={t("frontends.exportDialog.image.widthDecrement")}
              min={1}
              step={1}
              value={draft.width !== undefined ? draft.width : shown.width}
              onValueChange={(value) => setDraft((current) => ({ ...current, width: value }))}
              onValueCommit={setWidth}
              fieldClassName="flex-1"
            />
            <NumberField
              aria-label={t("frontends.exportDialog.image.height")}
              prefix={t("frontends.exportDialog.image.height")}
              incrementLabel={t("frontends.exportDialog.image.heightIncrement")}
              decrementLabel={t("frontends.exportDialog.image.heightDecrement")}
              min={1}
              step={1}
              value={draft.height !== undefined ? draft.height : shown.height}
              onValueChange={(value) => setDraft((current) => ({ ...current, height: value }))}
              onValueCommit={setHeight}
              fieldClassName="flex-1"
            />
          </div>
          <Checkbox label={t("frontends.exportDialog.image.keepRatio")} checked={state.keepRatio} onCheckedChange={(next) => onChange({ keepRatio: next === true })} />
        </div>
      ) : null}
      <ExportImage
        className="w-full"
        formats={formats}
        format={state.format}
        onFormatChange={(next) => onChange({ format: next })}
        vector={vector}
        scales={scales.map((scale) => ({ value: String(scale), label: `${scale}x` }))}
        scale={state.custom ? "" : String(state.scale)}
        onScaleChange={(next) => onChange({ scale: Number(next), custom: null })}
        fileName={imageFileName(fileName, state.format, state.scale, !vector && !state.custom)}
        dimensions={shown ? `${shown.width} × ${shown.height}` : undefined}
        onExport={onExport}
        labels={{
          format: t("frontends.exportDialog.image.format"),
          scale: t("frontends.exportDialog.image.scale"),
          file: t("frontends.exportDialog.image.file"),
          vectorNote: t("frontends.exportDialog.image.vectorNote"),
          exportAction: t("frontends.exportDialog.image.exportAction"),
          pendingAnnouncement: t("frontends.exportDialog.pending"),
        }}
      />
      {format?.transparent ? (
        <Checkbox label={t("frontends.exportDialog.image.transparent")} checked={state.transparent} onCheckedChange={(next) => onChange({ transparent: next === true })} />
      ) : null}
      {shown && !vector ? <p className="text-xs leading-[1.45] text-muted">{t("frontends.exportDialog.image.sizeNote")}</p> : null}
    </div>
  );
}
