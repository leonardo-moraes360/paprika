import { Input, InputGroup } from "@ui-sdk/react/input";
import { Search } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { fieldBoxWrapper, type BoxDataProps } from "./field-box";
import { Kbd } from "./kbd";
import { cn } from "@/lib/utils";

export type SearchFieldProps = Omit<ComponentProps<typeof Input>, "type"> & {
  "aria-label": string;
  shortcut?: ReactNode;
  groupClassName?: string;
  groupProps?: BoxDataProps;
};

export function SearchField({ shortcut, groupClassName, groupProps, className, ...props }: SearchFieldProps) {
  return (
    <InputGroup className={cn("flex h-8.5 w-full items-center gap-2 pr-1.5 pl-2.5", fieldBoxWrapper, groupClassName)} {...groupProps}>
      <Search aria-hidden="true" className="size-4 shrink-0 text-muted" />
      <Input
        type="search"
        className={(state) =>
          cn(
            "min-w-0 flex-1 appearance-none border-0 bg-transparent p-0 text-sm text-inherit outline-none placeholder:text-muted data-disabled:cursor-not-allowed [&::-webkit-search-cancel-button]:hidden",
            typeof className === "function" ? className(state) : className,
          )
        }
        {...props}
      />
      {shortcut ? <Kbd aria-hidden="true">{shortcut}</Kbd> : null}
    </InputGroup>
  );
}
