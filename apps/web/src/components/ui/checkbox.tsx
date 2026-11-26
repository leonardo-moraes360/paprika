import { Checkbox as CheckboxPrimitive, CheckboxIndicator } from "@ui-sdk/react/checkbox";
import { Check, Minus } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { FormField, hasFieldChrome, type ChoiceChromeProps } from "./form-field";
import { cn, focusRing, slot } from "@/lib/utils";

export type CheckboxProps = ComponentProps<typeof CheckboxPrimitive> &
  ChoiceChromeProps & {
    label?: ReactNode;
    labelClassName?: string;
  };

export function Checkbox({ label, labelClassName, className, description, error, invalid, validationMessages, fieldClassName, ...props }: CheckboxProps) {
  const control = (
    <label className={cn("inline-flex min-h-5 cursor-pointer items-center gap-2.5 text-base leading-5 text-fg has-[[data-disabled]]:cursor-not-allowed has-[[data-disabled]]:text-muted", labelClassName)}>
      <CheckboxPrimitive
        className={slot(
          `relative inline-flex size-4.5 shrink-0 items-center justify-center rounded-sm border-[1.5px] border-field bg-panel text-on-action transition-colors motion-reduce:transition-none data-checked:border-action data-checked:bg-action data-indeterminate:border-action data-indeterminate:bg-action data-disabled:cursor-not-allowed data-disabled:border-line data-disabled:bg-surface data-disabled:data-checked:border-field data-disabled:data-checked:bg-field data-disabled:data-indeterminate:border-field data-disabled:data-indeterminate:bg-field forced-colors:data-checked:border-[Highlight] forced-colors:data-checked:bg-[Highlight] forced-colors:data-checked:text-[HighlightText] forced-colors:data-indeterminate:border-[Highlight] forced-colors:data-indeterminate:bg-[Highlight] forced-colors:data-indeterminate:text-[HighlightText] forced-colors:data-disabled:border-[GrayText] ${focusRing}`,
          className,
        )}
        {...props}
      >
        <CheckboxIndicator keepMounted className="flex items-center justify-center data-unchecked:hidden">
          {(state) => (state.indeterminate ? <Minus aria-hidden="true" className="size-3.5 stroke-3" /> : <Check aria-hidden="true" className="size-3.5 stroke-3" />)}
        </CheckboxIndicator>
      </CheckboxPrimitive>
      {label}
    </label>
  );
  if (!hasFieldChrome({ description, error, invalid, validationMessages })) return control;
  return (
    <FormField description={description} error={error} invalid={invalid} validationMessages={validationMessages} disabled={props.disabled} name={props.name} className={fieldClassName}>
      {control}
    </FormField>
  );
}
