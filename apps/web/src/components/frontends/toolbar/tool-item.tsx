import { useState } from "react";
import { IconToggle } from "@/components/ui/icon-toggle";
import { Popover } from "@/components/ui/popover";
import { ToolbarButton, ToolbarToggle } from "@/components/ui/toolbar-button";
import { Tooltip, type TooltipSide } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { ToolbarTool } from "./types";

export type ToolItemProps = {
  tool: ToolbarTool;
  value: string;
  lastOption: string | undefined;
  side: TooltipSide;
  onValueChange: (id: string) => void;
};

const tip = (label: string, hotkey: string | undefined) => (hotkey ? { shortcut: hotkey.toLowerCase() } : {});

export function ToolItem({ tool, value, lastOption, side, onValueChange }: ToolItemProps) {
  const [open, setOpen] = useState(false);
  const options = tool.options;
  if (!options) {
    return (
      <Tooltip content={tool.label} side={side} {...tip(tool.label, tool.hotkey)}>
        <ToolbarToggle aria-label={tool.label} pressed={value === tool.id} onPressedChange={(pressed) => pressed && onValueChange(tool.id)}>
          {tool.icon}
        </ToolbarToggle>
      </Tooltip>
    );
  }
  const current = options.find((option) => option.id === value) ?? options.find((option) => option.id === lastOption) ?? options[0];
  const active = options.some((option) => option.id === value);
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      side={side}
      align="center"
      title={undefined}
      trigger={
        <ToolbarButton aria-label={tool.label} data-active={active ? "" : undefined} className={cn("data-active:bg-select-soft data-active:text-select-soft-ink")}>
          {active ? (current?.icon ?? tool.icon) : tool.icon}
        </ToolbarButton>
      }
      contentProps={{ className: "w-auto p-2 gap-2", "aria-label": tool.label }}
    >
      <p className="px-1 text-xs font-bold tracking-[0.8px] text-label uppercase">{tool.label}</p>
      <div className="flex gap-0.5">
        {options.map((option) => (
          <Tooltip key={option.id} content={option.label} side="bottom" arrow={false}>
            <IconToggle
              aria-label={option.label}
              pressed={value === option.id}
              onPressedChange={() => {
                onValueChange(option.id);
                setOpen(false);
              }}
            >
              {option.icon}
            </IconToggle>
          </Tooltip>
        ))}
      </div>
    </Popover>
  );
}
