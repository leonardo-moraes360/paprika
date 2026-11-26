export type ImportTab = "files" | "libraries" | "workspaces" | "projects";
export type ImportSourceTab = Exclude<ImportTab, "files">;

export type ImportSourceItem = {
  id: string;
  name: string;
  detail?: string;
};

export type ImportSource = {
  items: readonly ImportSourceItem[];
  loading?: boolean;
  error?: string | null;
};

export type ImportedFilePayload = {
  file: File;
  text?: string;
};

export type ImportRequest =
  | { source: "files"; files: ImportedFilePayload[] }
  | { source: ImportSourceTab; ids: string[] };

export type ImportDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  destination: string;
  tab?: ImportTab;
  defaultTab?: ImportTab;
  onTabChange?: (tab: ImportTab) => void;
  tabs?: readonly ImportTab[];
  accept?: readonly string[];
  maxFileSize?: number;
  sources?: Partial<Record<ImportSourceTab, ImportSource>>;
  onImport: (request: ImportRequest) => void | Promise<unknown>;
  onRetrySource?: (tab: ImportSourceTab) => void;
};
