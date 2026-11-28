import { Languages, MapPin } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AgentStack } from "@/components/ui/agent-stack";
import { AgentsTrigger } from "@/components/ui/agents-trigger";
import { BrandMark } from "@/components/ui/brand-mark";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { ConnectionStatus } from "@/components/ui/connection-status";
import { Menu, MenuContent, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "@/components/ui/menu";
import { Pill, PillDot } from "@/components/ui/pill";
import { ThemeSwitch } from "@/components/ui/theme-switch";
import { cn, focusRing } from "@/lib/utils";
import type { EditorHeaderLanguage, EditorHeaderProps } from "./types";

const chip = `inline-flex shrink-0 cursor-pointer rounded-full ${focusRing}`;

function Divider() {
  return <span aria-hidden="true" className="h-5 w-px shrink-0 bg-line" />;
}

function Chip({ label, onClick, children }: { label: string; onClick?: () => void; children: ReactNode }) {
  if (!onClick) return <span className="inline-flex shrink-0">{children}</span>;
  return (
    <button type="button" aria-label={label} onClick={onClick} className={chip}>
      {children}
    </button>
  );
}

export function EditorHeader({
  path,
  pins = 0,
  onPinsClick,
  agents = 0,
  agentsOpen,
  onAgentsClick,
  renderAgents,
  team,
  onTeamClick,
  connected,
  connectionLabel,
  language,
  languages,
  onLanguageChange,
  theme,
  onThemeChange,
  className,
}: EditorHeaderProps) {
  const { t } = useTranslation();
  const options: readonly EditorHeaderLanguage[] = languages ?? [
    { value: "en", label: t("language.en"), short: "EN" },
    { value: "pt-BR", label: t("language.pt-BR"), short: "PT" },
  ];
  const current = options.find((option) => option.value === language);
  const short = current?.short ?? language.slice(0, 2).toUpperCase();

  const agentsTrigger = (
    <AgentsTrigger
      aria-expanded={agentsOpen}
      aria-label={t("frontends.editorHeader.agentsShow", { count: agents })}
      onClick={onAgentsClick}
      stack={<AgentStack count={agents} />}
      label={t("frontends.editorHeader.agentsActive", { count: agents })}
    />
  );

  return (
    <header aria-label={t("frontends.editorHeader.region")} className={cn("flex h-12 shrink-0 items-center gap-3 bg-panel pe-3 ps-3.5", className)}>
      <div className="flex min-w-0 items-center gap-3">
        <BrandMark label={t("frontends.editorHeader.brand")} height={24} />
        <Divider />
        <Breadcrumb label={t("frontends.editorHeader.path")} items={[...path]} className="min-w-0" />
      </div>
      <div className="flex-1" />
      {pins > 0 ? (
        <Chip label={t("frontends.editorHeader.pinsShow", { count: pins })} onClick={onPinsClick}>
          <Pill tone="red" icon={<MapPin />}>
            {t("frontends.editorHeader.pinsOpen", { count: pins })}
          </Pill>
        </Chip>
      ) : null}
      {agents > 0 ? (renderAgents ? renderAgents(agentsTrigger) : agentsTrigger) : null}
      {team ? (
        <Chip label={t("frontends.editorHeader.teamShow", { name: team.name })} onClick={onTeamClick}>
          <Pill icon={<PillDot className="bg-green" />}>{t("frontends.editorHeader.team", { name: team.name, count: team.online })}</Pill>
        </Chip>
      ) : null}
      <Divider />
      <ConnectionStatus
        connected={connected}
        label={connected ? (connectionLabel ?? t("frontends.editorHeader.connected")) : t("frontends.editorHeader.disconnected")}
      />
      <Menu pendingAnnouncement={t("common.working")}>
        <MenuTrigger aria-label={t("frontends.editorHeader.languageCurrent", { code: short })} className={cn(chip, "items-center gap-1.5 bg-panel px-2.5 h-6 text-xs font-semibold text-muted hover:bg-surface")}>
          <Languages aria-hidden="true" className="size-3.5" />
          {short}
        </MenuTrigger>
        <MenuContent align="end">
          <MenuRadioGroup value={language} onValueChange={(next) => typeof next === "string" && onLanguageChange(next)}>
            {options.map((option) => (
              <MenuRadioItem key={option.value} value={option.value}>
                {option.label}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </MenuContent>
      </Menu>
      <ThemeSwitch
        compact
        value={theme}
        onValueChange={onThemeChange}
        labels={{ label: t("theme.label"), system: t("theme.system"), light: t("theme.light"), dark: t("theme.dark") }}
      />
    </header>
  );
}
