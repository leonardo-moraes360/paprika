import { NumberInput, NumberInputControl, NumberInputDecrement, NumberInputGroup, NumberInputIncrement } from "@ui-sdk/react/number-input";
import { Minus, Plus } from "lucide-react";
import { useId, type ComponentProps, type ReactNode } from "react";
import { fieldBoxWrapper, type BoxDataProps } from "./field-box";
import { FormField } from "./form-field";
import { cn, focusRing } from "@/lib/utils";

const stepClasses = `flex h-4.5 w-6.5 shrink-0 cursor-pointer items-center justify-center rounded-xs text-fg transition-colors motion-reduce:transition-none hover:bg-surface data-disabled:cursor-not-allowed data-disabled:text-field [&_svg]:size-3.5 [&_svg]:stroke-2 ${focusRing} focus-visible:outline-offset-0`;

export type NumberFieldProps = Omit<ComponentProps<typeof NumberInput>, "children" | "className"> & {
  incrementLabel: string;
  decrementLabel: string;
  label?: ReactNode;
  description?: ReactNode;
  error?: ReactNode;
  invalid?: boolean;
  prefix?: ReactNode;
  suffix?: ReactNode;
  steppers?: boolean;
  placeholder?: string;
  "aria-label"?: string;
  className?: string;
  boxProps?: BoxDataProps;
  fieldClassName?: string;
};

export function NumberField({
  incrementLabel,
  decrementLabel,
  label,
  description,
  error,
  invalid,
  prefix,
  suffix,
  steppers = true,
  placeholder,
  "aria-label": ariaLabel,
  className,
  boxProps,
  fieldClassName,
  disabled,
  name,
  ...props
}: NumberFieldProps) {
  const labelId = useId();
  return (
    <FormField label={label} description={description} error={error} invalid={invalid} disabled={disabled} name={name} labelId={labelId} className={fieldClassName}>
      <NumberInput disabled={disabled} {...props}>
        <NumberInputGroup className={cn("flex h-9 w-full items-center gap-2 pr-2 pl-3", fieldBoxWrapper, className)} {...boxProps}>
          {prefix ? <span aria-hidden="true" className="text-sm font-semibold text-muted">{prefix}</span> : null}
          <NumberInputControl
            aria-label={ariaLabel}
            aria-labelledby={label && !ariaLabel ? labelId : undefined}
            placeholder={placeholder}
            className="min-w-0 flex-1 appearance-none border-0 bg-transparent p-0 text-base text-inherit tabular-nums outline-none placeholder:text-muted data-disabled:cursor-not-allowed"
          />
          {suffix ? <span aria-hidden="true" className="text-sm text-muted">{suffix}</span> : null}
          {steppers ? (
            <div className="-mr-0.5 flex shrink-0 flex-col items-center justify-center gap-0.5">
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
