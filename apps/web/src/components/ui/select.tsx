import { Select as SelectPrimitive, SelectContent, SelectItem, SelectItemIndicator, SelectItemText, SelectTrigger, SelectValue, type SelectProps as SelectPrimitiveProps } from "@ui-sdk/react/select";
import { Check, ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { fieldBoxSelf, popupItem, popupSurface, type BoxDataProps, type DistributiveOmit } from "./field-box";
import { FormField } from "./form-field";
import { cn } from "@/lib/utils";

export type SelectOption = { value: string; label: string; disabled?: boolean };

export type SelectProps = DistributiveOmit<Extract<SelectPrimitiveProps<string, false>, { multiple?: false }>, "children" | "multiple" | "className"> & {
  options: SelectOption[];
  label?: ReactNode;
  description?: ReactNode;
  error?: ReactNode;
  invalid?: boolean;
  "aria-label"?: string;
  className?: string;
  triggerProps?: BoxDataProps;
  fieldClassName?: string;
};

export function Select({ options, label, description, error, invalid, "aria-label": ariaLabel, className, triggerProps, fieldClassName, disabled, name, ...props }: SelectProps) {
  return (
    <FormField label={label} description={description} error={error} invalid={invalid} disabled={disabled} name={name} className={fieldClassName}>
      <SelectPrimitive multiple={false} disabled={disabled} {...props}>
        <SelectTrigger
          aria-label={ariaLabel}
          {...triggerProps}
          className={cn(
            "flex h-9 w-full cursor-pointer items-center gap-2 pr-2.5 pl-3 text-left text-base data-open:border-[1.5px] data-open:border-select forced-colors:data-open:border-2 forced-colors:data-open:border-[Highlight]",
            fieldBoxSelf,
            className,
          )}
        >
          <SelectValue className="min-w-0 flex-1 truncate data-placeholder:text-muted" />
          <ChevronDown aria-hidden="true" className="size-4 shrink-0" />
        </SelectTrigger>
        <SelectContent className={cn(popupSurface, "max-h-(--available-height) overflow-y-auto")}>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value} label={option.label} disabled={option.disabled} className={cn(popupItem, "justify-between")}>
              <SelectItemText className="min-w-0 flex-1 truncate">{option.label}</SelectItemText>
              <SelectItemIndicator>
                <Check aria-hidden="true" className="size-4 shrink-0" />
              </SelectItemIndicator>
            </SelectItem>
          ))}
        </SelectContent>
      </SelectPrimitive>
    </FormField>
  );
}
