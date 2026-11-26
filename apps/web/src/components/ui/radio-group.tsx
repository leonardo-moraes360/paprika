import { Radio as RadioPrimitive, RadioGroup as RadioGroupPrimitive, RadioIndicator } from "@ui-sdk/react/radio";
import type { ComponentProps, ReactNode } from "react";
import { FormField, hasFieldChrome, type ChoiceChromeProps } from "./form-field";
import { cn, focusRing, slot } from "@/lib/utils";

export type RadioGroupProps = ComponentProps<typeof RadioGroupPrimitive> & ChoiceChromeProps;

export function RadioGroup({ className, description, error, invalid, validationMessages, fieldClassName, ...props }: RadioGroupProps) {
  const group = <RadioGroupPrimitive className={slot("flex flex-col gap-2", className)} {...props} />;
  if (!hasFieldChrome({ description, error, invalid, validationMessages })) return group;
  return (
    <FormField description={description} error={error} invalid={invalid} validationMessages={validationMessages} disabled={props.disabled} name={props.name} className={fieldClassName}>
      {group}
    </FormField>
  );
}

export type RadioProps = ComponentProps<typeof RadioPrimitive> & {
  label?: ReactNode;
  labelClassName?: string;
};

export function Radio({ label, labelClassName, className, ...props }: RadioProps) {
  return (
    <label className={cn("inline-flex min-h-5 cursor-pointer items-center gap-2.5 text-base leading-5 text-fg has-[[data-disabled]]:cursor-not-allowed has-[[data-disabled]]:text-muted", labelClassName)}>
      <RadioPrimitive
        className={slot(
          `relative inline-flex size-4.5 shrink-0 items-center justify-center rounded-full border-[1.5px] border-field bg-panel transition-colors motion-reduce:transition-none data-checked:border-action data-disabled:cursor-not-allowed data-disabled:border-line data-disabled:bg-surface data-disabled:data-checked:border-field forced-colors:data-checked:border-[Highlight] forced-colors:data-disabled:border-[GrayText] ${focusRing}`,
          className,
        )}
        {...props}
      >
        <RadioIndicator className="size-2 rounded-full bg-action data-disabled:bg-field forced-colors:bg-[Highlight]" />
      </RadioPrimitive>
      {label}
    </label>
  );
}
