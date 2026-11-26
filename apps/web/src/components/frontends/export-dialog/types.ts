export type ExportMode = "image" | "code";

export type ExportOption = {
  value: string;
  label: string;
};

export type ExportImageFormat = ExportOption & {
  vector?: boolean;
  transparent?: boolean;
};

export type ExportCodeFormat = ExportOption & {
  extension?: string;
};

export type ExportSize = {
  width: number;
  height: number;
};

export type ExportRequest =
  | {
      kind: "image";
      format: string;
      scale: number;
      scope: string | null;
      width: number | null;
      height: number | null;
      transparent: boolean;
    }
  | { kind: "code"; format: string; tokens: boolean };

export type ExportDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRequestExport: (request: ExportRequest) => Promise<Blob | string>;
  fileName: string;
  mode?: ExportMode;
  defaultMode?: ExportMode;
  onModeChange?: (mode: ExportMode) => void;
  modes?: readonly ExportMode[];
  imageFormats?: readonly ExportImageFormat[];
  defaultImageFormat?: string;
  scales?: readonly number[];
  scopes?: readonly ExportOption[];
  size?: ExportSize;
  codeFormats?: readonly ExportCodeFormat[];
  defaultCodeFormat?: string;
};
