import { Input } from "@ui-sdk/react/input";
import { Toggle } from "@ui-sdk/react/toggle";
import { Tree, TreeGroup, TreeItem, TreeItemIndicator, TreeItemLabel, type TreeItemProps, type TreeMode, type TreeProps } from "@ui-sdk/react/tree";
import { ChevronDown, ChevronRight, Eye, EyeOff, Lock, LockOpen } from "lucide-react";
import { memo, useLayoutEffect, useRef, type ComponentProps, type KeyboardEvent, type ReactNode } from "react";
import { cn, focusRing } from "@/lib/utils";

export type LayerTreeProps<Mode extends TreeMode = "single"> = TreeProps<Mode>;

export function LayerTree<Mode extends TreeMode = "single">({ className, expandOnPress = false, ...props }: LayerTreeProps<Mode>) {
  return <Tree<Mode> expandOnPress={expandOnPress} className={cn("flex flex-col outline-none", className)} {...props} />;
}

const toggleBase = `group/toggle hidden size-6 shrink-0 cursor-pointer items-center justify-center rounded-xs text-muted group-focus-within/layer:flex group-hover/layer:flex group-[:is([role=treeitem]:focus-visible>*)]/layer:flex pointer-coarse:flex data-pressed:flex data-disabled:cursor-not-allowed forced-colors:data-pressed:border forced-colors:data-pressed:border-[Highlight] [&_svg]:size-3.5 [&_svg]:stroke-[1.75] ${focusRing}`;

const stopBubbling = {
  onClick: (event: { stopPropagation: () => void }) => event.stopPropagation(),
  onKeyDown: (event: { stopPropagation: () => void }) => event.stopPropagation(),
  onPointerDown: (event: { stopPropagation: () => void }) => event.stopPropagation(),
};

export type LayerRowProps = Omit<ComponentProps<"div">, "children" | "onSelect"> & {
  value: string;
  name: string;
  icon: ReactNode;
  branch?: boolean;
  disabled?: boolean;
  visible?: boolean;
  locked?: boolean;
  hideLabel: string;
  lockLabel: string;
  renaming?: boolean;
  renameLabel?: string;
  trailing?: ReactNode;
  itemProps?: Omit<ComponentProps<typeof TreeItem>, keyof TreeItemProps | "children" | "className" | "onKeyDown"> & Record<`data-${string}`, string | undefined>;
  /** Called once per rename: by Enter or by leaving the field. Escape calls `onRenameCancel` instead, and the blur that follows is ignored. */
  onRename?: (name: string) => void;
  onRenameCancel?: () => void;
  onVisibleChange?: (visible: boolean) => void;
  onLockedChange?: (locked: boolean) => void;
  children?: ReactNode;
};

/** The label of a row. A memo: the tree hands every row a new `state` when only one row's selection changed, and the rows that did not change skip this subtree. */
const LayerLabel = memo(function LayerLabel({ branch, expanded, selected, visible, icon, name }: { branch: boolean; expanded: boolean; selected: boolean; visible: boolean; icon: ReactNode; name: string }) {
  return (
    <>
      {branch ? (
        <TreeItemIndicator className="-mx-[5px] inline-flex size-6 shrink-0 items-center justify-center rounded-xs text-muted [&_svg]:size-3.5 [&_svg]:stroke-[1.75]">
          {expanded ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
        </TreeItemIndicator>
      ) : (
        <span aria-hidden="true" className="size-3.5 shrink-0" />
      )}
      <span aria-hidden="true" className="inline-flex size-3.5 shrink-0 items-center justify-center text-muted [&_svg]:size-3.5 [&_svg]:stroke-2">
        {icon}
      </span>
      <span className={cn("truncate", selected ? "font-semibold text-select-soft-ink" : visible ? "text-fg" : "text-muted")}>{name}</span>
    </>
  );
});

export function LayerRow({
  className,
  value,
  name,
  icon,
  branch,
  disabled,
  visible = true,
  locked = false,
  hideLabel,
  lockLabel,
  renaming = false,
  renameLabel,
  trailing,
  itemProps,
  onRename,
  onRenameCancel,
  onVisibleChange,
  onLockedChange,
  children,
  ...props
}: LayerRowProps) {
  const settled = useRef(false);
  useLayoutEffect(() => {
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
  const isBranch = branch ?? Boolean(children);
  const shortcut = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target instanceof Element && event.target.closest('[role="treeitem"]') !== event.currentTarget) return;
    if (!(event.ctrlKey || event.metaKey) || !event.shiftKey) return;
    const key = event.key.toLowerCase();
    if (key === "h" && onVisibleChange) {
      event.preventDefault();
      onVisibleChange(!visible);
    }
    if (key === "l" && onLockedChange) {
      event.preventDefault();
      onLockedChange(!locked);
    }
  };
  return (
    <TreeItem {...itemProps} value={value} label={name} branch={isBranch} disabled={disabled} onKeyDown={shortcut} className="outline-none">
      <div
        data-hidden={visible ? undefined : ""}
        data-locked={locked ? "" : undefined}
        className={cn(
          "group/layer flex h-7 items-center rounded-md pe-1.5 transition-colors motion-reduce:transition-none hover:bg-surface has-data-selected:bg-select-soft forced-colors:has-data-selected:border-2 forced-colors:has-data-selected:border-[Highlight] [[role=treeitem]:focus-visible>&]:outline-2 [[role=treeitem]:focus-visible>&]:-outline-offset-2 [[role=treeitem]:focus-visible>&]:outline-select",
          className,
        )}
        {...props}
      >
        {renaming ? (
          <div className="flex h-full min-w-0 flex-1 items-center gap-1.5 ps-[calc(0.5rem+(var(--tree-level)-1)*20px)]" {...stopBubbling}>
            <span aria-hidden="true" className="size-3.5 shrink-0" />
            <span aria-hidden="true" className="inline-flex size-3.5 shrink-0 items-center justify-center text-muted [&_svg]:size-3.5 [&_svg]:stroke-2">
              {icon}
            </span>
            <Input
              autoFocus
              aria-label={renameLabel}
              defaultValue={name}
              onFocus={(event) => event.currentTarget.select()}
              onKeyDown={commit}
              onBlur={(event) => finish(event.currentTarget.value)}
              className="h-[22px] min-w-0 flex-1 rounded-sm border-[1.5px] border-select bg-field-bg px-1.5 text-sm text-fg outline-none forced-colors:border-[Highlight]"
            />
          </div>
        ) : (
          <TreeItemLabel className="flex h-full min-w-0 flex-1 cursor-pointer items-center gap-1.5 ps-[calc(0.5rem+(var(--tree-level)-1)*20px)] text-start text-sm data-disabled:cursor-not-allowed">
            {(state) => <LayerLabel branch={isBranch} expanded={state.expanded} selected={state.selected} visible={visible} icon={icon} name={name} />}
          </TreeItemLabel>
        )}
        {trailing}
        <Toggle
          aria-label={hideLabel}
          aria-keyshortcuts="Control+Shift+H Meta+Shift+H"
          tabIndex={-1}
          pressed={!visible}
          onPressedChange={(next) => onVisibleChange?.(!next)}
          className={toggleBase}
          {...stopBubbling}
        >
          <Eye aria-hidden="true" className="group-data-pressed/toggle:hidden" />
          <EyeOff aria-hidden="true" className="hidden group-data-pressed/toggle:block" />
        </Toggle>
        {onLockedChange ? (
          <Toggle
            aria-label={lockLabel}
            aria-keyshortcuts="Control+Shift+L Meta+Shift+L"
            tabIndex={-1}
            pressed={locked}
            onPressedChange={(next) => onLockedChange?.(next)}
            className={cn(toggleBase, "data-pressed:text-red-ink")}
            {...stopBubbling}
          >
            <LockOpen aria-hidden="true" className="group-data-pressed/toggle:hidden" />
            <Lock aria-hidden="true" className="hidden group-data-pressed/toggle:block" />
          </Toggle>
        ) : (
          <span aria-hidden="true" className="hidden size-6 shrink-0 group-focus-within/layer:block group-hover/layer:block pointer-coarse:block" />
        )}
      </div>
      {isBranch && children ? <TreeGroup>{children}</TreeGroup> : null}
    </TreeItem>
  );
}
