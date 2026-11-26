import { Select, type SelectOption } from "@/components/ui/select";

export type ChoiceFieldProps = {
  label: string;
  value: string;
  options: readonly SelectOption[];
  onValueChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
};

export function ChoiceField({ label, value, options, onValueChange, disabled, className }: ChoiceFieldProps) {
  return (
    <Select
      label={label}
      value={value}
      options={[...options]}
      disabled={disabled}
      fieldClassName={className}
      onValueChange={(next) => {
        if (next !== null && next !== value) onValueChange(next);
      }}
    />
  );
}
