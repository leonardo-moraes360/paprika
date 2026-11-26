import {
  ColorPicker as ColorPickerPrimitive,
  ColorPickerArea,
  ColorPickerAreaThumb,
  ColorPickerChannelInput,
  ColorPickerEyeDropper,
  ColorPickerInput,
  ColorPickerSlider,
  ColorPickerSliderThumb,
  ColorPickerSwatch,
  ColorPickerSwatches,
  ColorPickerSwatchItem,
} from "@ui-sdk/react/color-picker";
import { Pipette, Plus } from "lucide-react";
import { useState, type ComponentProps } from "react";
import { SegmentedControl, SegmentedControlItem } from "./segmented-control";
import { cn, focusRing } from "@/lib/utils";

export type ColorFormat = "hex" | "rgb" | "rgba" | "hsl" | "oklch";

type ChannelKey = "red" | "green" | "blue" | "alpha" | "hue" | "saturation" | "lightness" | "chroma";

export type ColorPickerLabels = {
  formats: string;
  format: Record<ColorFormat, string>;
  area: string;
  hue: string;
  alpha: string;
  eyeDropper: string;
  hex: string;
  channels: Record<ChannelKey, { short: string; name: string }>;
  savedTitle: string;
  addSaved: string;
  brandTitle: string;
};

export type ColorSwatchOption = { value: string; label: string };

export type ColorPickerProps = Omit<ComponentProps<typeof ColorPickerPrimitive>, "children" | "space" | "format" | "name" | "className"> & {
  name?: string;
  className?: string;
  labels: ColorPickerLabels;
  format?: ColorFormat;
  defaultFormat?: ColorFormat;
  onFormatChange?: (format: ColorFormat) => void;
  saved?: ColorSwatchOption[];
  brand?: ColorSwatchOption[];
  onSaveColor?: () => void;
};

const formats: ColorFormat[] = ["hex", "rgb", "rgba", "hsl", "oklch"];

const channelsByFormat: Record<Exclude<ColorFormat, "hex">, ChannelKey[]> = {
  rgb: ["red", "green", "blue"],
  rgba: ["red", "green", "blue", "alpha"],
  hsl: ["hue", "saturation", "lightness"],
  oklch: ["lightness", "chroma", "hue"],
};

const fieldBox =
  "flex h-8 items-center rounded-md border border-field bg-field-bg px-2.5 text-sm text-fg has-[input:focus-visible]:border-[1.5px] has-[input:focus-visible]:border-select has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-select forced-colors:has-[input:focus-visible]:border-2 forced-colors:has-[input:focus-visible]:border-[Highlight]";

const bareInput = "min-w-0 flex-1 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none border-0 bg-transparent p-0 text-sm text-inherit tabular-nums outline-none";

const sliderTrack = `relative mx-2 h-3 w-[calc(100%-1rem)] rounded-md bg-size-[100%_100%,12px_12px] ${focusRing}`;

const thumb = "size-4 rounded-full border-[1.5px] border-field bg-white outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-select forced-colors:border-[ButtonText]";

const swatchItem =
  "size-6 shrink-0 cursor-pointer rounded-[5px] border border-line outline-none data-selected:rounded-md data-selected:border-2 data-selected:border-fg data-selected:p-0.5 data-selected:bg-clip-content focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-select forced-colors:data-selected:border-[Highlight]";

const spaces = { hex: "hsv", rgb: "srgb", rgba: "srgb", hsl: "hsl", oklch: "oklch" } as const;

export function ColorPicker({
  labels,
  format,
  defaultFormat = "hex",
  onFormatChange,
  saved,
  brand,
  onSaveColor,
  className,
  value,
  defaultValue = "#000000",
  onValueChange,
  name,
  ...props
}: ColorPickerProps) {
  const [localFormat, setLocalFormat] = useState<ColorFormat>(defaultFormat);
  const [localValue, setLocalValue] = useState(defaultValue);
  const current = format ?? localFormat;
  const color = value ?? localValue;
  const setFormat = (next: string | null) => {
    if (!next) return;
    setLocalFormat(next as ColorFormat);
    onFormatChange?.(next as ColorFormat);
  };
  const setColor: NonNullable<ComponentProps<typeof ColorPickerPrimitive>["onValueChange"]> = (next, details) => {
    setLocalValue(next);
    onValueChange?.(next, details);
  };
  const channels = current === "hex" ? null : channelsByFormat[current];
  return (
    <ColorPickerPrimitive
      space="hsv"
      format="hex"
      name={name}
      value={color}
      onValueChange={setColor}
      className={cn("flex w-70 max-w-full flex-col gap-3", className)}
      {...props}
    >
      <SegmentedControl aria-label={labels.formats} value={current} onValueChange={setFormat} stretch>
        {formats.map((item) => (
          <SegmentedControlItem key={item} value={item}>
            {labels.format[item]}
          </SegmentedControlItem>
        ))}
      </SegmentedControl>
      <ColorPickerArea
        aria-label={labels.area}
        className={`relative h-32 w-full cursor-crosshair rounded-md bg-(image:--color-area-background) ${focusRing}`}
      >
        <ColorPickerAreaThumb className="size-3.5 rounded-full border-2 border-white shadow-[0_0_0_1px_color-mix(in_srgb,black_50%,transparent)] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-select" />
      </ColorPickerArea>
      <ColorPickerSlider channel="hue" aria-label={labels.hue} className={cn(sliderTrack, "bg-(image:--color-slider-background)")}>
        <ColorPickerSliderThumb className={thumb} />
      </ColorPickerSlider>
      <ColorPickerSlider
        channel="alpha"
        aria-label={labels.alpha}
        className={cn(sliderTrack, "bg-[image:var(--color-slider-background),repeating-conic-gradient(var(--color-gray-300)_0_25%,white_0_50%)]")}
      >
        <ColorPickerSliderThumb className={thumb} />
      </ColorPickerSlider>
      <div className="flex items-center gap-2">
        <ColorPickerEyeDropper
          aria-label={labels.eyeDropper}
          className={`flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md border border-field bg-field-bg text-fg hover:bg-surface data-unsupported:hidden [&_svg]:size-4 ${focusRing}`}
        >
          <Pipette aria-hidden="true" />
        </ColorPickerEyeDropper>
        <ColorPickerSwatch className="size-8 shrink-0 rounded-md border border-line bg-(--color-picker-color)" />
        {channels ? (
          <ColorPickerPrimitive
            aria-label={labels.format[current]}
            space={spaces[current]}
            format="hex"
            value={color}
            onValueChange={setColor}
            disabled={props.disabled}
            readOnly={props.readOnly}
            className="flex min-w-0 flex-1 items-center gap-1.5"
          >
            {channels.map((channel) => (
              <label key={channel} className={cn(fieldBox, "min-w-0 flex-1 gap-[3px] px-[5px]")}>
                <span aria-hidden="true" className="text-xs font-semibold text-muted">
                  {labels.channels[channel].short}
                </span>
                <ColorPickerChannelInput channel={channel} aria-label={labels.channels[channel].name} className={bareInput} />
              </label>
            ))}
          </ColorPickerPrimitive>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <div className={cn(fieldBox, "min-w-0 flex-1")}>
              <ColorPickerInput aria-label={labels.hex} className={bareInput} />
            </div>
            <div className={cn(fieldBox, "w-14.5 shrink-0 px-2")}>
              <ColorPickerChannelInput channel="alpha" aria-label={labels.channels.alpha.name} className={bareInput} />
            </div>
          </div>
        )}
      </div>
      {saved ? (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold text-muted">{labels.savedTitle}</span>
          <ColorPickerSwatches aria-label={labels.savedTitle} className="flex flex-wrap items-center gap-2">
            {saved.map((item) => (
              <ColorPickerSwatchItem key={item.value} value={item.value} aria-label={item.label} style={{ backgroundColor: item.value }} className={swatchItem} />
            ))}
            {onSaveColor ? (
              <button
                type="button"
                aria-label={labels.addSaved}
                onClick={onSaveColor}
                className={`flex size-6 cursor-pointer items-center justify-center rounded-[5px] border-[1.5px] border-field text-fg hover:bg-surface [&_svg]:size-3.5 ${focusRing}`}
              >
                <Plus aria-hidden="true" />
              </button>
            ) : null}
          </ColorPickerSwatches>
        </div>
      ) : null}
      {brand ? (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold text-muted">{labels.brandTitle}</span>
          <ColorPickerSwatches aria-label={labels.brandTitle} className="flex flex-wrap items-center gap-2">
            {brand.map((item) => (
              <ColorPickerSwatchItem key={item.value} value={item.value} aria-label={item.label} style={{ backgroundColor: item.value }} className={swatchItem} />
            ))}
          </ColorPickerSwatches>
        </div>
      ) : null}
    </ColorPickerPrimitive>
  );
}
