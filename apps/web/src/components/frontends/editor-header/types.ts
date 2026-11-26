import type { ComponentProps, MouseEvent, ReactElement } from "react";

export type EditorHeaderCrumb = {
  label: string;
  href?: string;
  render?: ReactElement<ComponentProps<"a">>;
  onSelect?: (event: MouseEvent) => void;
};

export type EditorHeaderTheme = "system" | "light" | "dark";

export type EditorHeaderLanguage = {
  value: string;
  label: string;
  short?: string;
};

export type EditorHeaderTeam = {
  name: string;
  online: number;
};

export type EditorHeaderProps = {
  path: readonly EditorHeaderCrumb[];
  pins?: number;
  onPinsClick?: () => void;
  agents?: number;
  agentsOpen?: boolean;
  onAgentsClick?: () => void;
  renderAgents?: (trigger: ReactElement) => ReactElement;
  team?: EditorHeaderTeam | null;
  onTeamClick?: () => void;
  connected: boolean;
  connectionLabel?: string;
  language: string;
  languages?: readonly EditorHeaderLanguage[];
  onLanguageChange: (language: string) => void;
  theme: EditorHeaderTheme;
  onThemeChange: (theme: EditorHeaderTheme) => void;
  className?: string;
};
