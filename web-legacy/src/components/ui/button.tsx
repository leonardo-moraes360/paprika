import type { ComponentProps } from "react";
import { Slot as SlotPrimitive } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/cn";

export const buttonVariants = cva(
  "inline-flex cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-sm font-semibold transition-colors outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-ring disabled:cursor-default disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-ui-primary text-ui-primary-foreground hover:bg-ui-primary-hover",
        secondary: "bg-ui-secondary text-ui-secondary-foreground hover:bg-ui-secondary-hover",
        outline: "border border-ui-input bg-transparent text-ui-foreground hover:bg-ui-accent hover:text-ui-accent-foreground",
        ghost: "bg-transparent text-ui-foreground hover:bg-ui-accent hover:text-ui-accent-foreground",
        destructive: "bg-ui-destructive text-ui-destructive-foreground hover:bg-ui-destructive-hover",
        link: "bg-transparent text-ui-link underline-offset-4 hover:underline",
      },
      size: {
        xs: "h-6 gap-1 rounded-sm px-2 text-2xs",
        sm: "h-7 px-2.5 text-xs",
        default: "h-8 px-3",
        lg: "h-9 px-4 text-md",
        icon: "h-8 w-8 p-0",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export type ButtonProps = ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean };

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const classes = cn(buttonVariants({ variant, size, className }));
  if (asChild) {
    return (
      <SlotPrimitive.Root data-slot="button" className={classes} {...(props as ComponentProps<typeof SlotPrimitive.Root>)} />
    );
  }
  return (
    <button type="button" data-slot="button" className={classes} {...props}>
      {props.children}
    </button>
  );
}
