import { Button as ButtonPrimitive } from "@ui-sdk/react/button";
import { Input } from "@ui-sdk/react/input";
import { Archive, ImagePlus } from "lucide-react";
import { useEffect, useRef, type ComponentProps, type KeyboardEvent, type ReactNode, type Ref } from "react";
import { cn } from "@/lib/utils";
import { Pill } from "./pill";
import { Tag } from "./tag";

export type WorkspaceCardProps = Omit<ComponentProps<"div">, "children" | "title" | "onSelect"> & {
  name: string;
  meta: string;
  preview: ReactNode;
  active?: boolean;
  activeLabel?: string;
  archivedLabel?: string;
  dropping?: boolean;
  droppingLabel?: string;
  renaming?: boolean;
  renameLabel: string;
  openRef?: Ref<HTMLButtonElement>;
  menu?: ReactNode;
  onOpen?: () => void;
  onRename?: (name: string) => void;
  onRenameCancel?: () => void;
};

const openFocus =
  "has-[[data-card-open]:focus-visible]:outline-2 has-[[data-card-open]:focus-visible]:outline-offset-2 has-[[data-card-open]:focus-visible]:outline-select";

export function WorkspaceCard({
  className,
  name,
  meta,
  preview,
  active = false,
  activeLabel,
  archivedLabel,
  dropping = false,
  droppingLabel,
  renaming = false,
  renameLabel,
  openRef,
  menu,
  onOpen,
  onRename,
  onRenameCancel,
  ...props
}: WorkspaceCardProps) {
  const settled = useRef(false);
  useEffect(() => {
    if (renaming) settled.current = false;
  }, [renaming]);
  const finish = (value: string | null) => {
    if (settled.current) return;
    settled.current = true;
    if (value === null) onRenameCancel?.();
    else onRename?.(value);
  };
  const commit = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && !event.nativeEvent.isComposing) finish(event.currentTarget.value);
    if (event.key === "Escape") finish(null);
  };
  return (
    <div
      data-active={active ? "" : undefined}
      data-dropping={dropping ? "" : undefined}
      className={cn(
        "group/card relative flex flex-col overflow-hidden rounded-xl border border-line bg-panel transition-colors motion-reduce:transition-none",
        "hover:border-select hover:ring-1 hover:ring-select hover:ring-inset focus-within:border-select focus-within:ring-1 focus-within:ring-select focus-within:ring-inset",
        "data-active:border-green data-active:ring-1 data-active:ring-green data-active:ring-inset data-dropping:border-dashed data-dropping:border-select data-dropping:ring-1 data-dropping:ring-select data-dropping:ring-inset",
        "forced-colors:hover:border-[Highlight] forced-colors:data-active:border-[Highlight]",
        openFocus,
        className,
      )}
      {...props}
    >
      <div className="relative h-42 shrink-0 overflow-hidden bg-canvas">
        {preview}
        {active && activeLabel ? <Tag tone="green" className="absolute start-2.5 top-2.5">{activeLabel}</Tag> : null}
        {menu ? (
          <span className="absolute end-3 bottom-3 z-10 flex opacity-0 transition-opacity group-focus-within/card:opacity-100 group-hover/card:opacity-100 has-[[aria-expanded=true]]:opacity-100 pointer-coarse:opacity-100 motion-reduce:transition-none">
            {menu}
          </span>
        ) : null}
        {dropping ? (
          <span className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-1.5 bg-select-soft text-sm font-semibold text-select-soft-ink">
            <ImagePlus aria-hidden="true" className="size-6" />
            {droppingLabel}
          </span>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-col gap-1 px-3.5 pt-3 pb-3.5">
        <div className="flex min-w-0 items-center gap-2">
          {renaming ? (
            <Input
              autoFocus
              aria-label={renameLabel}
              defaultValue={name}
              onFocus={(event) => event.currentTarget.select()}
              onKeyDown={commit}
              onBlur={(event) => finish(event.currentTarget.value)}
              className="-my-0.5 h-7 min-w-0 flex-1 rounded-sm border-[1.5px] border-select bg-field-bg px-1.5 text-sm font-semibold text-fg outline-none forced-colors:border-[Highlight]"
            />
          ) : (
            <ButtonPrimitive
              ref={openRef}
              pendingAnnouncement=""
              data-card-open=""
              onClick={onOpen}
              className="min-w-0 flex-1 cursor-pointer truncate text-start text-sm font-semibold text-fg outline-none after:absolute after:inset-0 after:content-['']"
            >
              {name}
            </ButtonPrimitive>
          )}
          {archivedLabel ? (
            <Pill icon={<Archive aria-hidden="true" className="size-3" />} className="h-5.5 shrink-0">
              {archivedLabel}
            </Pill>
          ) : null}
        </div>
        <span className="truncate text-sm text-muted">{meta}</span>
      </div>
    </div>
  );
}
