import { Input, InputClear, InputGroup } from "@ui-sdk/react/input";
import { Search, X } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { bareInput, fieldBoxWrapper, type BoxDataProps } from "./field-box";
import { Kbd } from "./kbd";
import { cn, focusRing, slot } from "@/lib/utils";

export type SearchFieldProps = Omit<ComponentProps<typeof Input>, "type" | "className"> & {
  "aria-label": string;
  shortcut?: ReactNode;
  clearLabel?: string;
  className?: string;
  inputClassName?: ComponentProps<typeof Input>["className"];
  boxProps?: BoxDataProps;
};

export function SearchField({ shortcut, clearLabel, className, inputClassName, boxProps, ...props }: SearchFieldProps) {
  return (
    <InputGroup className={cn("flex h-8.5 w-full items-center gap-2 pe-1.5 ps-2.5", fieldBoxWrapper, className)} {...boxProps}>
      <Search aria-hidden="true" className="size-4 shrink-0 text-muted" />
      <Input type="search" className={slot(cn(bareInput, "text-sm [&::-webkit-search-cancel-button]:hidden"), inputClassName)} {...props} />
      {clearLabel ? (
        <InputClear aria-label={clearLabel} className={`flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted hover:bg-surface hover:text-fg [&_svg]:size-3.5 ${focusRing} focus-visible:outline-offset-0`}>
          <X aria-hidden="true" />
        </InputClear>
      ) : null}
      {shortcut ? <Kbd aria-hidden="true">{shortcut}</Kbd> : null}
    </InputGroup>
  );
}
