import type { ReactNode } from "react";

export type WorkspaceEntry = {
  id: string;
  name: string;
  nodes: number;
  updatedAt: number;
  active?: boolean;
  archived?: boolean;
  projectId?: string | null;
  cover?: string | null;
  canArchive?: boolean;
  canDelete?: boolean;
};

export type ProjectEntry = {
  id: string;
  name: string;
};

export type OverviewProfile = {
  name: string;
  detail: string;
  initials: string;
};

export type OverviewTheme = "system" | "light" | "dark";

export type OverviewLanguage = {
  value: string;
  label: string;
  short?: string;
};

export type OverviewView = { kind: "workspaces" } | { kind: "archived" } | { kind: "project"; id: string };

export type ActionResult = void | Promise<unknown>;

export type OverviewProps = {
  workspaces: readonly WorkspaceEntry[];
  projects?: readonly ProjectEntry[];
  profile?: OverviewProfile;
  loading?: boolean;
  error?: string | null;
  view?: OverviewView;
  defaultView?: OverviewView;
  confirmDeleteByName?: boolean;
  now?: number;
  renderPreview?: (workspace: WorkspaceEntry) => ReactNode;
  onViewChange?: (view: OverviewView) => void;
  onRetry?: () => void;
  onOpen: (id: string) => void;
  onCreate: (name: string) => ActionResult;
  onRename: (id: string, name: string) => ActionResult;
  onDelete: (id: string) => ActionResult;
  onArchive: (id: string) => ActionResult;
  onRestore: (id: string) => ActionResult;
  onChangeCover: (id: string, file: File | null) => ActionResult;
  onMoveToProject: (id: string, projectId: string | null) => ActionResult;
  onCreateProject?: () => void;
  /** Offers the name field of a new project in the sidebar (the "+" opens it); resolves when the project exists, rejects to keep the field open and show the failure. */
  onSubmitProject?: (name: string) => ActionResult;
  onOpenImport?: () => void;
  onOpenProfile?: () => void;
  /** Theme and language controls in the footer of the sidebar (each pair appears only with its value and callback); the owner applies and persists them. */
  theme?: OverviewTheme;
  onThemeChange?: (theme: OverviewTheme) => void;
  language?: string;
  languages?: readonly OverviewLanguage[];
  onLanguageChange?: (language: string) => void;
  className?: string;
};
