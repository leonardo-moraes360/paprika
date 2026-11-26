import { NumericField } from "./numeric-field";

export type OpacityFieldProps = {
  label: string;
  /** Opacity as the document keeps it, from 0 to 1; a node without one is fully opaque. */
  value: number | undefined;
  onCommit: (value: number) => void;
  className?: string;
};

const round = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits;

/** Shows opacity as a percentage ("100 %") and hands the owner the document's 0..1 number. */
export function OpacityField({ label, value, onCommit, className }: OpacityFieldProps) {
  return (
    <NumericField
      label={label}
      prefix="O"
      unit="%"
      min={0}
      max={100}
      value={round((value ?? 1) * 100, 4)}
      onCommit={(percent) => onCommit(round(Number(percent) / 100, 6))}
      className={className}
    />
  );
}
