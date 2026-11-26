import { Button as ButtonPrimitive } from "@ui-sdk/react/button";
import { ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";
import { IconButton } from "@/components/ui/icon-button";
import { TeamRow } from "@/components/ui/team-row";
import { Tooltip } from "@/components/ui/tooltip";
import { focusRing } from "@/lib/utils";
import type { RelativeParts } from "@/lib/relative-time";
import type { AgentEntry } from "./types";

type AgentRowProps = {
  agent: AgentEntry;
  idle: boolean;
  since: RelativeParts;
  onFocusAgent: (id: string) => void;
  onOpenPage?: (pageId: string, agentId: string) => void;
};

export function AgentRow({ agent, idle, since, onFocusAgent, onOpenPage }: AgentRowProps) {
  const { t } = useTranslation();
  const tool = idle ? t(`frontends.agents.ago.${since.unit}`, { count: since.count }) : agent.tool;
  return (
    <li className="flex items-center gap-0.5" data-agent={agent.id} data-activity={agent.activity}>
      <ButtonPrimitive
        pendingAnnouncement=""
        onClick={() => onFocusAgent(agent.id)}
        className={`min-w-0 flex-1 cursor-pointer rounded-md text-start transition-colors hover:bg-surface motion-reduce:transition-none ${focusRing}`}
      >
        <TeamRow
          tone={agent.tone}
          name={agent.name}
          tool={tool}
          page={agent.pageName ?? ""}
          idle={idle}
          idleLabel={t("frontends.agents.idle")}
          className="pointer-events-none"
        />
        <span className="sr-only">{t("frontends.agents.focus", { name: agent.name })}</span>
      </ButtonPrimitive>
      {agent.pageId && onOpenPage ? (
        <Tooltip content={t("frontends.agents.openPage", { name: agent.name })} side="left">
          <IconButton size="xs" aria-label={t("frontends.agents.openPage", { name: agent.name })} onClick={() => onOpenPage(agent.pageId as string, agent.id)}>
            <ExternalLink aria-hidden="true" />
          </IconButton>
        </Tooltip>
      ) : null}
    </li>
  );
}
