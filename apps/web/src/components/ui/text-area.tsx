import { FieldDescription } from "@ui-sdk/react/field";
import { Textarea } from "@ui-sdk/react/textarea";
import type { ComponentProps, ReactNode } from "react";
import { bareInput, fieldBoxWrapper, type BoxDataProps } from "./field-box";
import { FormField, type FieldChromeProps } from "./form-field";
import { cn, slot } from "@/lib/utils";

export type TextAreaProps = Omit<ComponentProps<typeof Textarea>, "className"> &
  FieldChromeProps & {
    counter?: ReactNode;
    className?: string;
    inputClassName?: ComponentProps<typeof Textarea>["className"];
    boxProps?: BoxDataProps;
  };

export function TextArea({ label, description, error, invalid, validationMessages, counter, fieldClassName, className, inputClassName, boxProps, disabled, name, ...props }: TextAreaProps) {
  return (
    <FormField label={label} description={description} error={error} invalid={invalid} validationMessages={validationMessages} disabled={disabled} name={name} className={fieldClassName}>
      <div className={cn("relative flex min-h-24 w-full cursor-text flex-col has-[[data-disabled]]:cursor-not-allowed", fieldBoxWrapper, className)} {...boxProps}>
        <Textarea className={slot(cn(bareInput, "min-h-0 w-full resize-none px-3 pt-2.5 leading-[1.45]", counter ? "pb-8" : "pb-2.5"), inputClassName)} {...props} />
        {counter ? <FieldDescription className="pointer-events-none absolute inset-x-3 bottom-2.5 flex justify-end text-xs text-muted">{counter}</FieldDescription> : null}
      </div>
    </FormField>
  );
}
