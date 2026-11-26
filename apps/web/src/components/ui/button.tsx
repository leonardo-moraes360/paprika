import { Button as ButtonPrimitive } from "@ui-sdk/react/button";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const variants = {
  default: "bg-primary text-primary-foreground hover:bg-primary/90",
  ghost: "text-foreground hover:bg-muted",
};

const sizes = {
  default: "h-9 px-4",
  sm: "h-8 px-3",
};

type ButtonProps = ComponentProps<typeof ButtonPrimitive> & {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
};

export function Button({ className, variant = "default", size = "default", ...props }: ButtonProps) {
  return (
    <ButtonPrimitive
      className={(state) =>
        cn(
          "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
          variants[variant],
          sizes[size],
          typeof className === "function" ? className(state) : className,
        )
      }
      {...props}
    />
  );
}
