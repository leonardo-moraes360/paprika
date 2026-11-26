import { CircleDot, FileText, Frame, Group, Image, Shapes, Spline, Square, Type, PenTool } from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { CommitTextField } from "./fields/commit-text-field";

const ICONS: Record<string, ComponentType<{ "aria-hidden"?: boolean; className?: string }>> = {
  frame: Frame,
  rect: Square,
  ellipse: CircleDot,
  text: Type,
  image: Image,
  path: PenTool,
  group: Group,
  page: FileText,
  shape: Shapes,
  connector: Spline,
  instance: Frame,
};

export type IdentityHeaderProps = {
  kind: string;
  id: string;
  name: string;
  onRename: (name: string) => void;
  note?: ReactNode;
};

export function IdentityHeader({ kind, id, name, onRename, note }: IdentityHeaderProps) {
  const { t } = useTranslation();
  const Icon = ICONS[kind] ?? Frame;
  return (
    <div className="flex flex-col gap-2 px-3.5 pt-1 pb-3.5">
      <h2 className="flex items-center gap-1.5 text-sm font-semibold text-fg">
        <Icon aria-hidden className="size-3.5 shrink-0 text-muted" />
        <span>{t(`frontends.propertiesPanel.kinds.${kind}` as never)}</span>{" "}
        <code className="font-normal text-muted">#{id}</code>
      </h2>
      {note}
      <CommitTextField label={t("frontends.propertiesPanel.identity.name")} value={name} onCommit={onRename} />
    </div>
  );
}
