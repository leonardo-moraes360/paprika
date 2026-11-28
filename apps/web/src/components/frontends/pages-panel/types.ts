export type PageEntry = {
  id: string;
  name: string;
  agents?: number;
  hasContent?: boolean;
};

export type PagesPanelProps = {
  pages: readonly PageEntry[];
  activePageId?: string | null;
  onOpen: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  storageKey?: string;
  listMaxHeight?: number;
  className?: string;
};
