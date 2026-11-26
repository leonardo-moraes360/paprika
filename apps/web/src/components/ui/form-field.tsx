import { Field, FieldDescription, FieldError, FieldLabel, type ValidityKey } from "@ui-sdk/react/field";
import type { ReactNode, Ref } from "react";
import { cn } from "@/lib/utils";

export type ValidationMessages = Partial<Record<ValidityKey, ReactNode>>;

export type FieldChromeProps = {
  label?: ReactNode;
  description?: ReactNode;
  error?: ReactNode;
  invalid?: boolean;
  validationMessages?: ValidationMessages;
  fieldClassName?: string;
};

export type ChoiceChromeProps = Omit<FieldChromeProps, "label">;

export type FormFieldProps = {
  label?: ReactNode;
  description?: ReactNode;
  error?: ReactNode;
  invalid?: boolean;
  validationMessages?: ValidationMessages;
  disabled?: boolean;
  name?: string;
  labelId?: string;
  className?: string;
  ref?: Ref<HTMLDivElement>;
  children: ReactNode;
};

export function hasFieldChrome({ description, error, invalid, validationMessages }: FieldChromeProps) {
  return Boolean(description || error || invalid !== undefined || validationMessages);
}

export function FormField({ label, description, error, invalid, validationMessages, disabled, name, labelId, className, ref, children }: FormFieldProps) {
  const messages = validationMessages ? (Object.entries(validationMessages) as [ValidityKey, ReactNode][]).filter(([, message]) => message) : [];
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
      {messages.map(([key, message]) => (
        <FieldError key={key} match={key} className="text-xs font-medium text-red-ink">
          {message}
        </FieldError>
      ))}
      {error ? (
        <FieldError match={invalid !== false} className="text-xs font-medium text-red-ink">
          {error}
        </FieldError>
      ) : null}
    </Field>
  );
}
