import { PasswordInput, PasswordInputControl, PasswordInputToggle } from "@ui-sdk/react/password-input";
import { Copy, Eye, EyeOff } from "lucide-react";
import { useId, type ComponentProps, type ReactNode } from "react";
import { fieldBoxWrapper, type BoxDataProps } from "./field-box";
import { FormField } from "./form-field";
import { IconButton, iconButtonClasses } from "./icon-button";
import { cn } from "@/lib/utils";

export type SecretFieldProps = Omit<ComponentProps<typeof PasswordInput>, "children" | "className"> & {
  toggleLabel: string;
  copyLabel?: string;
  onCopy?: () => void;
  label?: ReactNode;
  description?: ReactNode;
  error?: ReactNode;
  invalid?: boolean;
  placeholder?: string;
  "aria-label"?: string;
  className?: string;
  boxProps?: BoxDataProps;
  fieldClassName?: string;
};

export function SecretField({
  toggleLabel,
  copyLabel,
  onCopy,
  label,
  description,
  error,
  invalid,
  placeholder,
  "aria-label": ariaLabel,
  className,
  boxProps,
  fieldClassName,
  disabled,
  name,
  ...props
}: SecretFieldProps) {
  const labelId = useId();
  return (
    <FormField label={label} description={description} error={error} invalid={invalid} disabled={disabled} name={name} labelId={labelId} className={fieldClassName}>
      <PasswordInput disabled={disabled} className={cn("flex h-9 w-full items-center gap-0.5 pr-1 pl-3", fieldBoxWrapper, className)} {...boxProps} {...props}>
        <PasswordInputControl
          aria-label={ariaLabel}
          aria-labelledby={label && !ariaLabel ? labelId : undefined}
          placeholder={placeholder}
          className="min-w-0 flex-1 appearance-none border-0 bg-transparent p-0 text-base text-inherit outline-none placeholder:text-muted data-disabled:cursor-not-allowed"
        />
        <PasswordInputToggle aria-label={toggleLabel} className={cn(iconButtonClasses("sm", false), "rounded-sm text-fg [&_svg]:size-4")}>
          {(state) => (state.visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />)}
        </PasswordInputToggle>
        {copyLabel ? (
          <IconButton aria-label={copyLabel} size="sm" disabled={disabled} onClick={onCopy} className="rounded-sm text-fg">
            <Copy aria-hidden="true" />
          </IconButton>
        ) : null}
      </PasswordInput>
    </FormField>
  );
}
