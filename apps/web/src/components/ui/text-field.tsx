import { Input } from "@ui-sdk/react/input";
import type { ComponentProps } from "react";
import { fieldBoxSelf, type BoxDataProps } from "./field-box";
import { FormField, type FieldChromeProps } from "./form-field";
import { cn, slot } from "@/lib/utils";

export type TextFieldProps = ComponentProps<typeof Input> & FieldChromeProps & {
  boxProps?: BoxDataProps;
};

export function TextField({ label, description, error, invalid, validationMessages, fieldClassName, className, boxProps, disabled, name, ...props }: TextFieldProps) {
  return (
    <FormField label={label} description={description} error={error} invalid={invalid} validationMessages={validationMessages} disabled={disabled} name={name} className={fieldClassName}>
      <Input className={slot(cn("h-10 w-full px-3 text-base", fieldBoxSelf), className)} {...boxProps} {...props} />
    </FormField>
  );
}
