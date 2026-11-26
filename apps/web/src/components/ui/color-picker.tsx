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
  createColorPickerController,
} from "@ui-sdk/react/color-picker";
import { Pipette, Plus } from "lucide-react";
import { useState, type ComponentProps } from "react";
import { bareInput, fieldBoxWrapper } from "./field-box";
import { SegmentedControl, SegmentedControlItem } from "./segmented-control";
import { cn, focusRing } from "@/lib/utils";

export type ColorFormat = "hex" | "rgb" | "rgba" | "hsl" | "oklch";

type ChannelKey = "red" | "green" | "blue" | "alpha" | "hue" | "saturation" | "lightness" | "chroma";

export type ColorPickerLabels = {
  formats: string;
  format: Record<ColorFormat, string>;
  area: string;
  areaValueText: (saturation: number, brightness: number) => string;
  hue: string;
  hueValueText: (degrees: number) => string;
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
  onSaveColor?: (value: string) => void;
};

const formats: ColorFormat[] = ["hex", "rgb", "rgba", "hsl", "oklch"];

const channelsByFormat: Record<Exclude<ColorFormat, "hex">, ChannelKey[]> = {
  rgb: ["red", "green", "blue"],
  rgba: ["red", "green", "blue", "alpha"],
  hsl: ["hue", "saturation", "lightness"],
  oklch: ["lightness", "chroma", "hue"],
};

const channelBox = cn(fieldBoxWrapper, "flex h-8 items-center px-2.5 text-sm");

const channelInput = cn(bareInput, "text-sm tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none");

const sliderTrack = `relative mx-2 h-3 w-[calc(100%-1rem)] rounded-md bg-size-[100%_100%,12px_12px] ${focusRing}`;

const thumb = "top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-[1.5px] border-field bg-white outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-select forced-colors:border-[ButtonText]";

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
  defaultValue,
  onValueChange,
  onValueCommit,
  controller: controllerProp,
  name,
  ...props
}: ColorPickerProps) {
  const [localFormat, setLocalFormat] = useState<ColorFormat>(defaultFormat);
  const [mirror, setMirror] = useState(value ?? defaultValue ?? "#000000");
  const [ownController] = useState(createColorPickerController);
  const controller = controllerProp ?? ownController;
  const current = format ?? localFormat;
  const color = value ?? mirror;
  const setFormat = (next: string | null) => {
    const match = formats.find((item) => item === next);
    if (!match) return;
    setLocalFormat(match);
    onFormatChange?.(match);
  };
  const channels = current === "hex" ? null : channelsByFormat[current];
  return (
    <ColorPickerPrimitive
      space="hsv"
      format="hex"
      name={name}
      value={value}
      defaultValue={defaultValue}
      controller={controller}
      onValueChange={(next, details) => {
        setMirror(next);
        onValueChange?.(next, details);
      }}
      onValueCommit={onValueCommit}
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
      <ColorPickerArea className={`relative h-32 w-full cursor-crosshair rounded-md bg-(image:--color-area-background) ${focusRing}`}>
        <ColorPickerAreaThumb
          aria-label={labels.area}
          render={(thumbProps, state) => (
            <div {...thumbProps} aria-valuetext={labels.areaValueText(Math.round(state.color.coords[1] ?? 0), Math.round(state.color.coords[2] ?? 0))} />
          )}
          className="-translate-x-1/2 -translate-y-1/2 size-3.5 rounded-full border-2 border-white shadow-[0_0_0_1px_color-mix(in_srgb,black_50%,transparent)] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-select" />
      </ColorPickerArea>
      <ColorPickerSlider channel="hue" className={cn(sliderTrack, "bg-(image:--color-slider-background)")}>
        <ColorPickerSliderThumb
          aria-label={labels.hue}
          render={(thumbProps, state) => <div {...thumbProps} aria-valuetext={labels.hueValueText(Math.round(state.channelValue))} />}
          className={thumb}
        />
      </ColorPickerSlider>
      <ColorPickerSlider
        channel="alpha"
        className={cn(sliderTrack, "bg-[image:var(--color-slider-background),repeating-conic-gradient(var(--color-gray-300)_0_25%,white_0_50%)]")}
      >
        <ColorPickerSliderThumb aria-label={labels.alpha} className={thumb} />
      </ColorPickerSlider>
      <div className="flex items-center gap-2">
        <ColorPickerEyeDropper
          aria-label={labels.eyeDropper}
          className={`flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md border border-field bg-field-bg text-fg hover:bg-surface data-unsupported:hidden [&_svg]:size-4 ${focusRing}`}
        >
          <Pipette aria-hidden="true" />
        </ColorPickerEyeDropper>
        <ColorPickerSwatch aria-hidden="true" className="size-8 shrink-0 rounded-md border border-line bg-(--color-picker-color)" />
        {channels ? (
          <ColorPickerPrimitive
            aria-label={labels.format[current]}
            space={spaces[current]}
            format="hex"
            value={color}
            onValueChange={(next, details) => {
              controller.setValue(next, { reason: details.reason, event: details.event });
            }}
            onValueCommit={onValueCommit}
            disabled={props.disabled}
            readOnly={props.readOnly}
            className="flex min-w-0 flex-1 items-center gap-1.5"
          >
            {channels.map((channel) => (
              <label key={channel} className={cn(channelBox, "min-w-0 flex-1 gap-[3px] px-[5px]")}>
                <span aria-hidden="true" className="text-xs font-semibold text-muted">
                  {labels.channels[channel].short}
                </span>
                <ColorPickerChannelInput channel={channel} aria-label={labels.channels[channel].name} className={channelInput} />
              </label>
            ))}
          </ColorPickerPrimitive>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <div className={cn(channelBox, "min-w-0 flex-1")}>
              <ColorPickerInput aria-label={labels.hex} className={channelInput} />
            </div>
            <div className={cn(channelBox, "w-14.5 shrink-0")}>
              <ColorPickerChannelInput channel="alpha" aria-label={labels.channels.alpha.name} className={channelInput} />
            </div>
          </div>
        )}
      </div>
      {saved ? (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold text-muted">{labels.savedTitle}</span>
          <div className="flex flex-wrap items-center gap-2">
            <ColorPickerSwatches aria-label={labels.savedTitle} className="flex flex-wrap items-center gap-2">
              {saved.map((item) => (
                <ColorPickerSwatchItem key={item.value} value={item.value} aria-label={item.label} style={{ backgroundColor: item.value }} className={swatchItem} />
              ))}
            </ColorPickerSwatches>
            {onSaveColor ? (
              <button
                type="button"
                aria-label={labels.addSaved}
                onClick={() => onSaveColor(color)}
                className={`flex size-6 cursor-pointer items-center justify-center rounded-[5px] border-[1.5px] border-field text-fg hover:bg-surface [&_svg]:size-3.5 ${focusRing}`}
              >
                <Plus aria-hidden="true" />
              </button>
            ) : null}
          </div>
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
