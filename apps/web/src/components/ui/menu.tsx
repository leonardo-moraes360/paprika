import {
  Menu as MenuPrimitive,
  MenuCheckboxItem as MenuCheckboxItemPrimitive,
  MenuContent as MenuContentPrimitive,
  MenuGroup as MenuGroupPrimitive,
  MenuGroupLabel as MenuGroupLabelPrimitive,
  MenuItem as MenuItemPrimitive,
  MenuItemIcon,
  MenuItemIndicator,
  MenuRadioGroup as MenuRadioGroupPrimitive,
  MenuRadioItem as MenuRadioItemPrimitive,
  MenuSeparator as MenuSeparatorPrimitive,
  MenuTrigger as MenuTriggerPrimitive,
} from "@ui-sdk/react/menu";
import { Check } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { popupItem, popupSurface } from "./field-box";
import { Kbd } from "./kbd";
import { cn, slot } from "@/lib/utils";

export type MenuProps = Omit<ComponentProps<typeof MenuPrimitive>, "pendingAnnouncement"> & {
  pendingAnnouncement: string;
};

export function Menu({ pendingAnnouncement, ...props }: MenuProps) {
  return <MenuPrimitive pendingAnnouncement={pendingAnnouncement} {...props} />;
}

export const MenuTrigger = MenuTriggerPrimitive;

export type MenuContentProps = ComponentProps<typeof MenuContentPrimitive>;

export function MenuContent({ className, ...props }: MenuContentProps) {
  return <MenuContentPrimitive className={slot(cn(popupSurface, "min-w-50 max-h-(--available-height) overflow-y-auto"), className)} {...props} />;
}

const destructiveItem =
  "data-destructive:font-semibold data-destructive:text-red-ink data-destructive:data-highlighted:bg-red-soft data-destructive:data-highlighted:text-red-soft-ink";

function Keys({ keys }: { keys: string[] }) {
  return (
    <span aria-hidden="true" className="flex shrink-0 items-center gap-1">
      {keys.map((key, index) => (
        <Kbd key={`${key}-${index}`}>{key}</Kbd>
      ))}
    </span>
  );
}

export type MenuItemProps = Omit<ComponentProps<typeof MenuItemPrimitive>, "shortcut"> & {
  icon?: ReactNode;
  keys?: string[];
};

export function MenuItem({ className, children, icon, keys, ...props }: MenuItemProps) {
  return (
    <MenuItemPrimitive className={slot(cn(popupItem, "gap-3", destructiveItem), className)} {...props}>
      {(state) => (
        <>
          {icon ? (
            <MenuItemIcon className="inline-flex size-4 shrink-0 items-center justify-center [&_svg]:size-4">{icon}</MenuItemIcon>
          ) : null}
          <span className="min-w-0 flex-1 truncate">{typeof children === "function" ? children(state) : children}</span>
          {keys?.length ? <Keys keys={keys} /> : null}
        </>
      )}
    </MenuItemPrimitive>
  );
}

export type MenuCheckboxItemProps = ComponentProps<typeof MenuCheckboxItemPrimitive>;

export function MenuCheckboxItem({ className, children, ...props }: MenuCheckboxItemProps) {
  return (
    <MenuCheckboxItemPrimitive className={slot(cn(popupItem, "justify-between"), className)} {...props}>
      {(state) => (
        <>
          <span className="min-w-0 flex-1 truncate">{typeof children === "function" ? children(state) : children}</span>
          <MenuItemIndicator>
            <Check aria-hidden="true" className="size-4 shrink-0" />
          </MenuItemIndicator>
        </>
      )}
    </MenuCheckboxItemPrimitive>
  );
}

export const MenuRadioGroup = MenuRadioGroupPrimitive;

export type MenuRadioItemProps = ComponentProps<typeof MenuRadioItemPrimitive>;

export function MenuRadioItem({ className, children, ...props }: MenuRadioItemProps) {
  return (
    <MenuRadioItemPrimitive className={slot(cn(popupItem, "justify-between"), className)} {...props}>
      {(state) => (
        <>
          <span className="min-w-0 flex-1 truncate">{typeof children === "function" ? children(state) : children}</span>
          <MenuItemIndicator>
            <Check aria-hidden="true" className="size-4 shrink-0" />
          </MenuItemIndicator>
        </>
      )}
    </MenuRadioItemPrimitive>
  );
}

export function MenuSeparator({ className, ...props }: ComponentProps<typeof MenuSeparatorPrimitive>) {
  return <MenuSeparatorPrimitive className={slot("my-1 h-px shrink-0 bg-line forced-colors:bg-[CanvasText]", className)} {...props} />;
}

export function MenuGroup({ className, ...props }: ComponentProps<typeof MenuGroupPrimitive>) {
  return <MenuGroupPrimitive className={slot("flex flex-col gap-0.5", className)} {...props} />;
}

export function MenuGroupLabel({ className, ...props }: ComponentProps<typeof MenuGroupLabelPrimitive>) {
  return <MenuGroupLabelPrimitive className={slot("flex h-6 items-center px-2 text-xs font-semibold tracking-wide text-label uppercase", className)} {...props} />;
}
