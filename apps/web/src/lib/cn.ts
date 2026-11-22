import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * `cn(...)` joins class names and lets the caller's utilities win over the defaults of a component
 * (ADR 0005). tailwind-merge ships the default Tailwind scales, and the Paprika theme is closed
 * (ADR 0003): root font 13px, `--spacing: 4px`, radii 2/4/6/8/12, text 10/11/12/14/15/22/44 and the
 * breakpoints/shadows of `styles.css`. Declared here so `text-md` is read as a size and not as a color,
 * and so `shadow-float` replaces `shadow-lg` instead of surviving next to it.
 */
const merge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": ["text-2xs", "text-xs", "text-sm", "text-md", "text-lg", "text-xl", "text-tile"],
      rounded: ["xs", "sm", "md", "lg", "xl"],
      shadow: ["float", "tag"],
    },
  },
});

export const cn = (...inputs: ClassValue[]) => merge(clsx(inputs));
