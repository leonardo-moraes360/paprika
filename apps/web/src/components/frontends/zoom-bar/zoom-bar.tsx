import { ChevronDown, ChevronUp } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Menu, MenuContent, MenuGroup, MenuGroupLabel, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "@/components/ui/menu";
import { ToolbarButton } from "@/components/ui/toolbar-button";
import { ZoomControl } from "@/components/ui/zoom-control";
import type { ZoomBarProps } from "./types";

export function ZoomBar({ zoom, minZoom, maxZoom, onZoomOut, onZoomIn, onFit, renderers, renderer, switching = false, onRendererChange, className }: ZoomBarProps) {
  const { t } = useTranslation();
  const percent = Math.round(zoom * 100);
  const active = renderers?.find((option) => option.id === renderer);
  const label = switching ? t("frontends.zoomBar.switching") : (active?.shortLabel ?? active?.label ?? t("frontends.zoomBar.renderer"));

  return (
    <ZoomControl
      className={className}
      label={t("frontends.zoomBar.label")}
      value={`${percent}%`}
      zoomOutLabel={t("frontends.zoomBar.zoomOut")}
      zoomInLabel={t("frontends.zoomBar.zoomIn")}
      fitLabel={t("frontends.zoomBar.fit")}
      zoomOutDisabled={minZoom !== undefined && zoom <= minZoom}
      zoomInDisabled={maxZoom !== undefined && zoom >= maxZoom}
      onZoomOut={onZoomOut}
      onZoomIn={onZoomIn}
      onFit={onFit}
      trailing={
        renderers && renderers.length > 0 ? (
          <Menu pendingAnnouncement={t("common.working")}>
            <MenuTrigger
              render={
                <ToolbarButton
                  aria-label={t("frontends.zoomBar.rendererMenu", { renderer: label })}
                  aria-busy={switching || undefined}
                  className="group/renderer h-7 w-auto gap-1.5 border-field px-2.5 text-sm font-semibold text-fg aria-expanded:border-[1.5px] aria-expanded:border-select [&_svg]:size-3.5"
                />
              }
            >
              <span aria-hidden="true" className="inline-flex size-3.5 items-center justify-center [&_svg]:size-3.5">
                {active?.icon}
              </span>
              {label}
              <ChevronDown aria-hidden="true" className="text-muted group-aria-expanded/renderer:hidden" />
              <ChevronUp aria-hidden="true" className="hidden group-aria-expanded/renderer:block" />
            </MenuTrigger>
            <MenuContent side="top" align="end" className="min-w-60">
              <MenuGroup>
                <MenuGroupLabel>{t("frontends.zoomBar.renderer")}</MenuGroupLabel>
                <MenuRadioGroup value={renderer ?? ""} onValueChange={(next) => typeof next === "string" && next !== renderer && onRendererChange?.(next)}>
                  {renderers.map((option) => (
                    <MenuRadioItem key={option.id} value={option.id} disabled={option.disabled || switching}>
                      {option.disabled && option.reason ? t("frontends.zoomBar.unavailable", { label: option.label, reason: option.reason }) : option.label}
                    </MenuRadioItem>
                  ))}
                </MenuRadioGroup>
              </MenuGroup>
            </MenuContent>
          </Menu>
        ) : null
      }
    />
  );
}
