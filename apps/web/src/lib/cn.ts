import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

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
