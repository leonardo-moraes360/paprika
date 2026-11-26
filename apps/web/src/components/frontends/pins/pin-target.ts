import type { TFunction } from "i18next";
import type { PinTarget } from "./types";

export function targetLabel(t: TFunction, target: PinTarget): string {
  if (target.kind === "node") return target.name;
  if (target.kind === "area") return t("frontends.pins.area", { width: Math.round(target.width), height: Math.round(target.height) });
  return t("frontends.pins.missingTarget");
}
