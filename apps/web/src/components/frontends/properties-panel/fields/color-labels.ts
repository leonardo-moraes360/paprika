import type { AppT } from "@/i18n/resources";
import type { ColorPickerLabels } from "@/components/ui/color-picker";

type T = AppT;

export function colorPickerLabels(t: T): ColorPickerLabels {
  const k = "frontends.propertiesPanel.colorPicker";
  return {
    formats: t(`${k}.formats`),
    format: { hex: t(`${k}.hex`), rgb: "RGB", rgba: "RGBA", hsl: "HSL", oklch: "OKLCH" },
    area: t(`${k}.area`),
    areaValueText: (saturation, brightness) => t(`${k}.areaValueText`, { saturation, brightness }),
    hue: t(`${k}.hue`),
    hueValueText: (degrees) => t(`${k}.hueValueText`, { degrees }),
    alpha: t(`${k}.alpha`),
    eyeDropper: t(`${k}.eyeDropper`),
    hex: t(`${k}.hexValue`),
    channels: {
      red: { short: "R", name: t(`${k}.red`) },
      green: { short: "G", name: t(`${k}.green`) },
      blue: { short: "B", name: t(`${k}.blue`) },
      alpha: { short: "A", name: t(`${k}.alpha`) },
      hue: { short: "H", name: t(`${k}.hue`) },
      saturation: { short: "S", name: t(`${k}.saturation`) },
      lightness: { short: "L", name: t(`${k}.lightness`) },
      chroma: { short: "C", name: t(`${k}.chroma`) },
    },
    savedTitle: "",
    addSaved: "",
    brandTitle: "",
  };
}
