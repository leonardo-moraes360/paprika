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
  listMaxHeight?: number;
  className?: string;
};
