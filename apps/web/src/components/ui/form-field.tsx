import { Field, FieldDescription, FieldError, FieldLabel } from "@ui-sdk/react/field";
import type { ReactNode, Ref } from "react";
import { cn } from "@/lib/utils";

export type FormFieldProps = {
  label?: ReactNode;
  description?: ReactNode;
  error?: ReactNode;
  invalid?: boolean;
  disabled?: boolean;
  name?: string;
  labelId?: string;
  className?: string;
  ref?: Ref<HTMLDivElement>;
  children: ReactNode;
};

export function FormField({ label, description, error, invalid, disabled, name, labelId, className, ref, children }: FormFieldProps) {
  return (
    <Field
      ref={ref}
      name={name}
      disabled={disabled}
      invalid={invalid ?? (error ? true : undefined)}
      className={cn("flex min-w-0 flex-col gap-1.5", className)}
    >
      {label ? <FieldLabel id={labelId} className="text-xs font-semibold text-label data-disabled:text-muted">{label}</FieldLabel> : null}
      {children}
      {description ? <FieldDescription className="text-xs text-muted">{description}</FieldDescription> : null}
      {error ? (
        <FieldError match className="text-xs font-medium text-red-ink">
          {error}
        </FieldError>
      ) : null}
    </Field>
  );
}
