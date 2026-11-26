import { Bot } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AgentStack } from "@/components/ui/agent-stack";
import { AgentsTrigger } from "@/components/ui/agents-trigger";
import { Pill } from "@/components/ui/pill";
import { Popover } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { relativeParts } from "@/lib/relative-time";
import { useNow } from "@/lib/use-now";
import { AgentRow } from "./agent-row";
import { splitAgents } from "./agents-model";
import { agentActiveWindowMs, type AgentEntry, type AgentsProps } from "./types";

export function Agents({
  agents,
  now: nowProp,
  clock,
  activeWindowMs = agentActiveWindowMs,
  onFocusAgent,
  onOpenPage,
  open,
  defaultOpen,
  onOpenChange,
  className,
}: AgentsProps) {
  const { t } = useTranslation();
  const now = useNow(nowProp, clock);
  const { active, idle } = splitAgents(agents, now, activeWindowMs);

  if (agents.length === 0) {
    return (
      <Pill className={className} icon={<Bot />} data-testid="agents-empty">
        {t("frontends.agents.none")}
      </Pill>
    );
  }

  const section = (title: string, list: AgentEntry[], isIdle: boolean) =>
    list.length === 0 ? null : (
      <section aria-labelledby={`agents-${isIdle ? "idle" : "active"}`} className="flex flex-col gap-1">
        <h3 id={`agents-${isIdle ? "idle" : "active"}`} className="px-2 text-xs font-bold tracking-[0.8px] text-muted uppercase">
          {title}
        </h3>
        <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
          {list.map((agent) => (
            <AgentRow key={agent.id} agent={agent} idle={isIdle} since={relativeParts(agent.lastActiveAt, now)} onFocusAgent={onFocusAgent} onOpenPage={onOpenPage} />
          ))}
        </ul>
      </section>
    );

  return (
    <Popover
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}
      align="end"
      contentProps={{ className: "w-76 p-3 gap-2" }}
      trigger={
        <AgentsTrigger
          className={className}
          stack={<AgentStack count={active.length} label={t("frontends.agents.stackLabel", { count: active.length })} />}
          label={t("frontends.agents.activeCount", { count: active.length })}
        />
      }
    >
      <div className="flex items-baseline gap-2">
        <h2 className="min-w-0 flex-1 truncate text-sm font-bold text-fg">{t("frontends.agents.title")}</h2>
        <span className="shrink-0 text-xs text-muted">{t("frontends.agents.activeCount", { count: active.length })}</span>
      </div>
      <ScrollArea style={{ maxHeight: 320 }} viewportClassName="max-h-[inherit]">
        <div className="flex flex-col gap-2">
          {section(t("frontends.agents.active"), active, false)}
          {section(t("frontends.agents.idleTitle"), idle, true)}
        </div>
      </ScrollArea>
    </Popover>
  );
}
