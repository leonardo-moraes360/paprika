export type LocalFontRecord = { family: string };

export type QueryLocalFonts = () => Promise<ReadonlyArray<LocalFontRecord>>;

export type FontPickerProps = {
  value: string;
  onValueChange: (family: string) => void;
  documentFonts?: readonly string[];
  commonFonts?: readonly string[];
  queryLocalFonts?: QueryLocalFonts | null;
  disabled?: boolean;
  className?: string;
};
