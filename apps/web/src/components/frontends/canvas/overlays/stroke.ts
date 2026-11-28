import type { CSSProperties } from "react";

/**
 * Strokes of the overlays that stay `width` screen pixels at any zoom. The layer is scaled by the camera, so a width is divided by
 * `var(--view-zoom)`. It is NOT a `border` or an `outline`: the browser floors a border to whole device pixels with a minimum of
 * one CSS pixel, and that minimum is multiplied by the scale (8 px on screen at 800 %). A shadow and a gradient have no such floor.
 */
const unit = (width: number) => `calc(${width}px / var(--view-zoom, 1))`;

/** A solid ring inside the element's box (it follows the element's radius). `color` is a colour value, normally a token (`var(--color-select-brand)`). */
export function ring(width: number, color: string): CSSProperties {
  return { boxShadow: `inset 0 0 0 ${unit(width)} ${color}` };
}

/** The colour of a token at an opacity, as the Tailwind `/70` form writes it. */
export const tinted = (token: string, percent: number) => `color-mix(in oklab, var(${token}) ${percent}%, transparent)`;

function dashedParts(width: number, color: string, dash: number, gap: number) {
  const w = unit(width);
  const line = (angle: number) => `repeating-linear-gradient(${angle}deg, ${color} 0 ${unit(dash)}, transparent ${unit(dash)} ${unit(dash + gap)})`;
  return {
    image: [line(90), line(90), line(0), line(0)].join(", "),
    size: `100% ${w}, 100% ${w}, ${w} 100%, ${w} 100%`,
    position: "left top, left bottom, left top, right top",
  };
}

/** A dashed ring inside the element's box: four gradients, one per side, so the dashes and the width are exact whatever the zoom. */
export function dashedRing(width: number, color: string, dash = 4, gap = 3): CSSProperties {
  const { image, size, position } = dashedParts(width, color, dash, gap);
  return { backgroundImage: image, backgroundSize: size, backgroundPosition: position, backgroundRepeat: "no-repeat" };
}

/** The same ring as three custom properties, for a component that takes classes and not a style: `bg-(image:--ring-image) bg-(size:--ring-size) bg-(position:--ring-position) bg-no-repeat`. */
export function dashedRingVars(width: number, color: string, dash = 4, gap = 3): CSSProperties {
  const { image, size, position } = dashedParts(width, color, dash, gap);
  return { "--ring-image": image, "--ring-size": size, "--ring-position": position } as CSSProperties;
}
