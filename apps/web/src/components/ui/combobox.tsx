import {
  Combobox as ComboboxPrimitive,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxItemIndicator,
  ComboboxList,
  ComboboxTrigger,
  type ComboboxProps as ComboboxPrimitiveProps,
} from "@ui-sdk/react/combobox";
import { Check, ChevronsUpDown } from "lucide-react";
import type { ReactNode } from "react";
import { bareInput, fieldBoxWrapper, type BoxDataProps, type DistributiveOmit } from "./field-box";
import { popupItem, popupSurface } from "./overlay-surface";
import { FormField, type FieldChromeProps } from "./form-field";
import { cn, focusRing } from "@/lib/utils";

export type ComboboxOption = { value: string; label: string; disabled?: boolean };

export type ComboboxProps = DistributiveOmit<Extract<ComboboxPrimitiveProps<string, false>, { multiple?: false }>, "children" | "multiple" | "className" | "announcement"> &
  FieldChromeProps & {
    options: ComboboxOption[];
    announcement: NonNullable<ComboboxPrimitiveProps<string, false>["announcement"]>;
    emptyLabel: ReactNode;
    toggleLabel: string;
    placeholder?: string;
    "aria-label"?: string;
    className?: string;
    inputClassName?: string;
    boxProps?: BoxDataProps;
  };

export function Combobox({
  options,
  emptyLabel,
  toggleLabel,
  placeholder,
  label,
  description,
  error,
  invalid,
  validationMessages,
  "aria-label": ariaLabel,
  className,
  inputClassName,
  boxProps,
  fieldClassName,
  disabled,
  name,
  ...props
}: ComboboxProps) {
  return (
    <FormField label={label} description={description} error={error} invalid={invalid} validationMessages={validationMessages} disabled={disabled} name={name} className={fieldClassName}>
      <ComboboxPrimitive multiple={false} disabled={disabled} {...props}>
        <div className={cn("flex h-9 w-full items-center gap-px pr-2.5 pl-3", fieldBoxWrapper, className)} {...boxProps}>
          <ComboboxInput
            aria-label={ariaLabel}
            placeholder={placeholder}
            className={cn(bareInput, inputClassName)}
          />
          <ComboboxTrigger
            aria-label={toggleLabel}
            className={`-mr-1 flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-xs text-fg data-disabled:cursor-not-allowed ${focusRing} focus-visible:outline-offset-0`}
          >
            <ChevronsUpDown aria-hidden="true" className="size-4" />
          </ComboboxTrigger>
        </div>
        <ComboboxContent className={cn(popupSurface, "max-h-(--available-height) overflow-y-auto")}>
          <ComboboxEmpty className="hidden px-2 py-1.5 text-base text-muted data-empty:block">{emptyLabel}</ComboboxEmpty>
          <ComboboxList className="flex flex-col gap-0.5">
            {options.map((option) => (
              <ComboboxItem key={option.value} value={option.value} label={option.label} disabled={option.disabled} className={cn(popupItem, "justify-between")}>
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                <ComboboxItemIndicator>
                  <Check aria-hidden="true" className="size-4 shrink-0" />
                </ComboboxItemIndicator>
              </ComboboxItem>
            ))}
          </ComboboxList>
        </ComboboxContent>
      </ComboboxPrimitive>
    </FormField>
  );
}
