import type { ComponentProps } from "react";
import { DropdownMenu as MenuPrimitive } from "radix-ui";
import { Check, ChevronRight, Circle } from "lucide-react";
import { cn } from "../../lib/cn";

export const DropdownMenu = MenuPrimitive.Root;
export const DropdownMenuTrigger = MenuPrimitive.Trigger;
export const DropdownMenuGroup = MenuPrimitive.Group;
export const DropdownMenuRadioGroup = MenuPrimitive.RadioGroup;
export const DropdownMenuSub = MenuPrimitive.Sub;

export function DropdownMenuSubTrigger({ className, children, ...props }: ComponentProps<typeof MenuPrimitive.SubTrigger>) {
  return (
    <MenuPrimitive.SubTrigger
      data-slot="menu-sub-trigger"
      className={cn(
        "flex w-full cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1 text-sm outline-none focus:bg-ui-accent focus:text-ui-accent-foreground data-[state=open]:bg-ui-accent data-[disabled]:pointer-events-none data-[disabled]:cursor-default data-[disabled]:opacity-45 [&_svg]:size-3.5",
        className,
      )}
      {...props}
    >
      {children}
      <ChevronRight className="ml-auto" aria-hidden />
    </MenuPrimitive.SubTrigger>
  );
}

export function DropdownMenuSubContent({ className, ...props }: ComponentProps<typeof MenuPrimitive.SubContent>) {
  return (
    <MenuPrimitive.SubContent
      data-slot="menu-sub-content"
      className={cn(
        "z-50 min-w-[9rem] overflow-hidden rounded-md border border-ui-border bg-ui-popover p-1 text-ui-popover-foreground shadow-float",
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuContent({ className, sideOffset = 4, ...props }: ComponentProps<typeof MenuPrimitive.Content>) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Content
        data-slot="menu-content"
        sideOffset={sideOffset}
        className={cn(
          "z-50 min-w-[11rem] overflow-hidden rounded-md border border-ui-border bg-ui-popover p-1 text-ui-popover-foreground shadow-float",
          "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
          className,
        )}
        {...props}
      />
    </MenuPrimitive.Portal>
  );
}

export function DropdownMenuItem({
  className,
  inset,
  variant = "default",
  ...props
}: ComponentProps<typeof MenuPrimitive.Item> & { inset?: boolean; variant?: "default" | "destructive" }) {
  return (
    <MenuPrimitive.Item
      data-slot="menu-item"
      data-inset={inset ? "" : undefined}
      data-variant={variant}
      className={cn(
        "group/menu-item relative flex w-full cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1 text-sm outline-none transition-colors focus:bg-ui-accent focus:text-ui-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:cursor-default data-[disabled]:opacity-45 [&_svg]:size-3.5 [&_svg]:shrink-0",
        inset && "pl-7",
        variant === "destructive" && "text-ui-destructive-text focus:bg-ui-destructive focus:text-ui-destructive-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuCheckboxItem({
  className,
  children,
  checked,
  ...props
}: ComponentProps<typeof MenuPrimitive.CheckboxItem>) {
  return (
    <MenuPrimitive.CheckboxItem
      data-slot="menu-checkbox-item"
      className={cn(
        "relative flex w-full cursor-pointer select-none items-center gap-2 rounded-sm py-1 pr-2 pl-7 text-sm outline-none transition-colors focus:bg-ui-accent focus:text-ui-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:cursor-default data-[disabled]:opacity-45 [&_svg]:size-3.5",
        className,
      )}
      checked={checked}
      {...props}
    >
      <span className="absolute left-1.5 flex size-3.5 items-center justify-center">
        <MenuPrimitive.ItemIndicator>
          <Check aria-hidden />
        </MenuPrimitive.ItemIndicator>
      </span>
      {children}
    </MenuPrimitive.CheckboxItem>
  );
}

export function DropdownMenuRadioItem({ className, children, ...props }: ComponentProps<typeof MenuPrimitive.RadioItem>) {
  return (
    <MenuPrimitive.RadioItem
      data-slot="menu-radio-item"
      className={cn(
        "relative flex w-full cursor-pointer select-none items-center gap-2 rounded-sm py-1 pr-2 pl-7 text-sm outline-none transition-colors focus:bg-ui-accent focus:text-ui-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:cursor-default data-[disabled]:opacity-45 [&_svg]:size-3.5",
        className,
      )}
      {...props}
    >
      <span className="absolute left-1.5 flex size-3.5 items-center justify-center">
        <MenuPrimitive.ItemIndicator>
          <Circle className="size-2 fill-current" aria-hidden />
        </MenuPrimitive.ItemIndicator>
      </span>
      {children}
    </MenuPrimitive.RadioItem>
  );
}

export function DropdownMenuLabel({
  className,
  inset,
  ...props
}: ComponentProps<typeof MenuPrimitive.Label> & { inset?: boolean }) {
  return (
    <MenuPrimitive.Label
      data-slot="menu-label"
      className={cn("px-2 py-1 text-2xs font-semibold uppercase tracking-[0.06em] text-ui-muted-foreground", inset && "pl-7", className)}
      {...props}
    />
  );
}

export function DropdownMenuSeparator({ className, ...props }: ComponentProps<typeof MenuPrimitive.Separator>) {
  return <MenuPrimitive.Separator data-slot="menu-separator" className={cn("-mx-1 my-1 h-px bg-ui-border", className)} {...props} />;
}

export function DropdownMenuShortcut({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      data-slot="menu-shortcut"
      className={cn("ml-auto pl-3 text-2xs tracking-wide text-ui-muted-foreground", className)}
      {...props}
    />
  );
}

export const DropdownMenuItemIndicator = MenuPrimitive.ItemIndicator;
