import { Textarea } from "@ui-sdk/react/textarea";
import type { ComponentProps, ReactNode } from "react";
import { fieldBoxWrapper, type BoxDataProps } from "./field-box";
import { FormField } from "./form-field";
import { cn } from "@/lib/utils";

export type TextAreaProps = ComponentProps<typeof Textarea> & {
  label?: ReactNode;
  description?: ReactNode;
  error?: ReactNode;
  invalid?: boolean;
  counter?: ReactNode;
  fieldClassName?: string;
  boxClassName?: string;
  boxProps?: BoxDataProps;
};

export function TextArea({ label, description, error, invalid, counter, fieldClassName, boxClassName, boxProps, className, disabled, name, ...props }: TextAreaProps) {
  return (
    <FormField label={label} description={description} error={error} invalid={invalid} disabled={disabled} name={name} className={fieldClassName}>
      <div className={cn("flex min-h-24 w-full flex-col gap-1.5 px-3 py-2.5", fieldBoxWrapper, boxClassName)} {...boxProps}>
        <Textarea
          className={(state) =>
            cn(
              "min-h-0 w-full flex-1 resize-none appearance-none border-0 bg-transparent p-0 text-base leading-[1.45] text-inherit outline-none placeholder:text-muted data-disabled:cursor-not-allowed",
              typeof className === "function" ? className(state) : className,
            )
          }
          {...props}
        />
        {counter ? <div className="flex justify-end text-xs text-muted">{counter}</div> : null}
      </div>
    </FormField>
  );
}
