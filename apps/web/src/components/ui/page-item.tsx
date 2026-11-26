import { Button as ButtonPrimitive } from "@ui-sdk/react/button";
import { Input } from "@ui-sdk/react/input";
import { File, X } from "lucide-react";
import type { ComponentProps, KeyboardEvent, ReactNode, Ref } from "react";
import { cn, focusRing } from "@/lib/utils";
import { IconButton } from "./icon-button";

export type PageItemProps = Omit<ComponentProps<"div">, "children" | "onSelect"> & {
  name: string;
  active?: boolean;
  agents?: ReactNode;
  renaming?: boolean;
  renameLabel: string;
  deleteLabel: string;
  selectRef?: Ref<HTMLButtonElement>;
  onSelect?: () => void;
  onRename?: (name: string) => void;
  onRenameCancel?: () => void;
  onDelete?: () => void;
};

export function PageItem({
  className,
  name,
  active = false,
  agents,
  renaming = false,
  renameLabel,
  deleteLabel,
  selectRef,
  onSelect,
  onRename,
  onRenameCancel,
  onDelete,
  ...props
}: PageItemProps) {
  const commit = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && !event.nativeEvent.isComposing) onRename?.(event.currentTarget.value);
    if (event.key === "Escape") onRenameCancel?.();
  };
  return (
    <div
      data-active={active ? "" : undefined}
      className={cn(
        "group/page relative flex h-7 items-center gap-2 rounded-md pe-2 ps-3 transition-colors motion-reduce:transition-none hover:bg-surface data-active:bg-surface forced-colors:data-active:border-2 forced-colors:data-active:border-[Highlight]",
        className,
      )}
      {...props}
    >
      {active ? <span aria-hidden="true" className="absolute start-0 top-1.5 h-4 w-[3px] rounded-xs bg-red" /> : null}
      {renaming ? (
        <>
          <File aria-hidden="true" className="size-3.5 shrink-0 stroke-[1.75] text-muted" />
          <Input
            autoFocus
            aria-label={renameLabel}
            defaultValue={name}
            onFocus={(event) => event.currentTarget.select()}
            onKeyDown={commit}
            onBlur={(event) => onRename?.(event.currentTarget.value)}
            className="h-[22px] min-w-0 flex-1 rounded-sm border-[1.5px] border-select bg-field-bg px-1.5 text-sm text-fg outline-none forced-colors:border-[Highlight]"
          />
        </>
      ) : (
        <>
          <ButtonPrimitive
            ref={selectRef}
            pendingAnnouncement=""
            aria-current={active ? "page" : undefined}
            onClick={onSelect}
            className={`flex h-full min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md text-start text-sm text-fg ${focusRing} data-disabled:cursor-not-allowed`}
          >
            <File aria-hidden="true" className={cn("size-3.5 shrink-0 stroke-[1.75]", active ? "text-fg" : "text-muted")} />
            <span className={cn("truncate", active && "font-semibold")}>{name}</span>
          </ButtonPrimitive>
          {agents}
          {onDelete ? (
            <IconButton
              aria-label={deleteLabel}
              onClick={onDelete}
              className="hidden size-5 group-focus-within/page:flex group-hover/page:flex pointer-coarse:flex [&_svg]:size-[11.25px]"
            >
              <X aria-hidden="true" />
            </IconButton>
          ) : null}
        </>
      )}
    </div>
  );
}
