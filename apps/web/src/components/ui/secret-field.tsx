import { PasswordInput, PasswordInputControl, PasswordInputToggle } from "@ui-sdk/react/password-input";
import { Copy, Eye, EyeOff } from "lucide-react";
import type { ComponentProps } from "react";
import { bareInput, fieldBoxWrapper, type BoxDataProps } from "./field-box";
import { FormField, type FieldChromeProps } from "./form-field";
import { IconButton, iconButtonClasses } from "./icon-button";
import { cn } from "@/lib/utils";

export type SecretFieldProps = Omit<ComponentProps<typeof PasswordInput>, "children" | "className"> &
  FieldChromeProps & {
    toggleLabel: string;
    copyLabel?: string;
    onCopy?: () => void;
    placeholder?: string;
    "aria-label"?: string;
    className?: string;
    inputClassName?: string;
    boxProps?: BoxDataProps;
  };

export function SecretField({
  toggleLabel,
  copyLabel,
  onCopy,
  label,
  description,
  error,
  invalid,
  validationMessages,
  placeholder,
  "aria-label": ariaLabel,
  autoComplete = "off",
  className,
  inputClassName,
  boxProps,
  fieldClassName,
  disabled,
  name,
  ...props
}: SecretFieldProps) {
  return (
    <FormField label={label} description={description} error={error} invalid={invalid} validationMessages={validationMessages} disabled={disabled} name={name} className={fieldClassName}>
      <PasswordInput disabled={disabled} autoComplete={autoComplete} className={cn("flex h-9 w-full items-center gap-0.5 pr-1 pl-3", fieldBoxWrapper, className)} {...boxProps} {...props}>
        <PasswordInputControl aria-label={ariaLabel} placeholder={placeholder} className={cn(bareInput, inputClassName)} />
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
