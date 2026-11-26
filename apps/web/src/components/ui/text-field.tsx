import { Input } from "@ui-sdk/react/input";
import type { ComponentProps, ReactNode } from "react";
import { fieldBoxSelf } from "./field-box";
import { FormField } from "./form-field";
import { cn } from "@/lib/utils";

export type TextFieldProps = ComponentProps<typeof Input> & {
  label?: ReactNode;
  description?: ReactNode;
  error?: ReactNode;
  invalid?: boolean;
  fieldClassName?: string;
};

export function TextField({ label, description, error, invalid, fieldClassName, className, disabled, name, ...props }: TextFieldProps) {
  return (
    <FormField label={label} description={description} error={error} invalid={invalid} disabled={disabled} name={name} className={fieldClassName}>
      <Input
        className={(state) => cn("h-10 w-full px-3 text-base", fieldBoxSelf, "focus-visible:outline-offset-2", typeof className === "function" ? className(state) : className)}
        {...props}
      />
    </FormField>
  );
}

