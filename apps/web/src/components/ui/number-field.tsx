import { NumberInput, NumberInputControl, NumberInputDecrement, NumberInputGroup, NumberInputIncrement } from "@ui-sdk/react/number-input";
import { Minus, Plus } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { bareInput, fieldBoxWrapper, type BoxDataProps } from "./field-box";
import { FormField, type FieldChromeProps } from "./form-field";
import { cn, focusRing } from "@/lib/utils";

const stepClasses = `flex h-4 w-6.5 shrink-0 cursor-pointer items-center justify-center rounded-xs text-fg transition-colors motion-reduce:transition-none hover:bg-surface data-disabled:cursor-not-allowed data-disabled:text-field [&_svg]:size-3.5 [&_svg]:stroke-2 ${focusRing} focus-visible:outline-offset-0`;

export type NumberFieldProps = Omit<ComponentProps<typeof NumberInput>, "children" | "className"> &
  FieldChromeProps & {
    incrementLabel: string;
    decrementLabel: string;
    prefix?: ReactNode;
    suffix?: ReactNode;
    steppers?: boolean;
    placeholder?: string;
    "aria-label"?: string;
    className?: string;
    inputClassName?: string;
    boxProps?: BoxDataProps;
  };

export function NumberField({
  incrementLabel,
  decrementLabel,
  label,
  description,
  error,
  invalid,
  validationMessages,
  prefix,
  suffix,
  steppers = true,
  placeholder,
  "aria-label": ariaLabel,
  className,
  inputClassName,
  boxProps,
  fieldClassName,
  disabled,
  name,
  ...props
}: NumberFieldProps) {
  return (
    <FormField label={label} description={description} error={error} invalid={invalid} validationMessages={validationMessages} disabled={disabled} name={name} className={fieldClassName}>
      <NumberInput disabled={disabled} {...props}>
        <NumberInputGroup className={cn("flex h-9 w-full items-center gap-2 pr-2 pl-3", fieldBoxWrapper, className)} {...boxProps}>
          {prefix ? <span aria-hidden="true" className="text-sm font-semibold text-muted">{prefix}</span> : null}
          <NumberInputControl aria-label={ariaLabel} placeholder={placeholder} className={cn(bareInput, "tabular-nums", inputClassName)} />
          {suffix ? <span aria-hidden="true" className="text-sm text-muted">{suffix}</span> : null}
          {steppers ? (
            <div className="flex shrink-0 flex-col items-center justify-center gap-0.5">
              <NumberInputIncrement aria-label={incrementLabel} className={stepClasses}>
                <Plus aria-hidden="true" />
              </NumberInputIncrement>
              <NumberInputDecrement aria-label={decrementLabel} className={stepClasses}>
                <Minus aria-hidden="true" />
              </NumberInputDecrement>
            </div>
          ) : null}
        </NumberInputGroup>
      </NumberInput>
    </FormField>
  );
}
