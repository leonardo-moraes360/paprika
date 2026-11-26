import { useState } from "react";
import { ColorField } from "@/components/ui/color-field";
import { ColorPicker, type ColorFormat, type ColorPickerLabels } from "@/components/ui/color-picker";
import { Cell, Grid, Specimen, type GalleryMeta } from "./_kit";

export const meta: GalleryMeta = { title: "Color", order: 120 };

export const colorLabels: ColorPickerLabels = {
  formats: "Color format",
  format: { hex: "HEX", rgb: "RGB", rgba: "RGBA", hsl: "HSL", oklch: "OKLCH" },
  area: "Saturation and brightness",
  areaValueText: (saturation, brightness) => `Saturation ${saturation}%, brightness ${brightness}%`,
  hue: "Hue",
  hueValueText: (degrees) => `${degrees} degrees`,
  alpha: "Opacity",
  eyeDropper: "Pick a color from the screen",
  hex: "Hex value",
  channels: {
    red: { short: "R", name: "Red" },
    green: { short: "G", name: "Green" },
    blue: { short: "B", name: "Blue" },
    alpha: { short: "A", name: "Opacity" },
    hue: { short: "H", name: "Hue" },
    saturation: { short: "S", name: "Saturation" },
    lightness: { short: "L", name: "Lightness" },
    chroma: { short: "C", name: "Chroma" },
  },
  savedTitle: "Saved colors",
  addSaved: "Save this color",
  brandTitle: "From the brand",
};

const initialSaved = [
  { value: "#F7AEA4", label: "Salmon" },
  { value: "#CC3A27", label: "Action red" },
  { value: "#AD872F", label: "Mustard" },
  { value: "#243B3D", label: "Deep green" },
  { value: "#358B97", label: "Teal" },
  { value: "#EEF0F7", label: "Ink" },
  { value: "#9AA3BF", label: "Muted" },
  { value: "#686E84", label: "Field" },
];

const brand = [
  { value: "#EE4A35", label: "Paprika red" },
  { value: "#FFC233", label: "Yellow" },
  { value: "#3FA75B", label: "Green" },
  { value: "#4F9A5A", label: "Stem green" },
  { value: "#4CC7D8", label: "Selection cyan" },
];

export default function FormColorSection() {
  const [value, setValue] = useState("#EE4A35");
  const [format, setFormat] = useState<ColorFormat>("hex");
  const [saved, setSaved] = useState(initialSaved);
  const save = (next: string) => setSaved((list) => (list.some((item) => item.value.toLowerCase() === next.toLowerCase()) ? list : [...list, { value: next, label: next }]));
  return (
    <Grid>
      <Specimen
        label="Color picker"
        note="280 wide column with 12 px gap: format rail, 280 × 128 area (radius 6), 12 px hue and opacity tracks with 16 px thumbs (white, 1.5 px field border), eyedropper 32 px, swatch 32 px, value fields 32 px high (hex 136 + opacity 58, or channel boxes), saved swatches 24 px radius 5 with a 24 px add button, brand swatches with a ring on the current one. The formats rail switches the fields. The plus button saves the current color."
        className="items-start"
      >
        <ColorPicker aria-label="Fill color" labels={colorLabels} value={value} onValueChange={setValue} format={format} onFormatChange={setFormat} saved={saved} brand={brand} onSaveColor={save} />
      </Specimen>
      <Specimen
        label="Color field"
        note="A 28 px swatch (radius 4, field border) beside a 36 px box (radius 6, field background, 14 px value). Empty shows the red slash and the muted text passed by prop. The box turns selection-colored while the picker is open; the picker opens in a popover."
        className="flex-col items-stretch gap-4"
      >
        <Cell label="filled (live, opens the picker)">
          <div className="w-70">
            <ColorField value={value} label="Fill color" emptyLabel="none" popoverLabel="Fill color picker">
              <ColorPicker aria-label="Fill color" labels={colorLabels} value={value} onValueChange={setValue} saved={saved} brand={brand} />
            </ColorField>
          </div>
        </Cell>
        <Cell label="empty">
          <div className="w-70">
            <ColorField value={null} label="Stroke color" emptyLabel="none" popoverLabel="Stroke color picker">
              <ColorPicker aria-label="Stroke color" labels={colorLabels} defaultValue="#4CC7D8" />
            </ColorField>
          </div>
        </Cell>
        <Cell label="focus">
          <div className="w-70">
            <ColorField value="#1A1F31" label="Frame color" emptyLabel="none" popoverLabel="Frame color picker" data-force-focus="">
              <ColorPicker aria-label="Frame color" labels={colorLabels} defaultValue="#1A1F31" />
            </ColorField>
          </div>
        </Cell>
        <Cell label="disabled">
          <div className="w-70">
            <ColorField value="#1A1F31" label="Frame color, disabled" emptyLabel="none" popoverLabel="Frame color picker" disabled>
              <ColorPicker aria-label="Frame color" labels={colorLabels} defaultValue="#1A1F31" />
            </ColorField>
          </div>
        </Cell>
      </Specimen>
    </Grid>
  );
}
