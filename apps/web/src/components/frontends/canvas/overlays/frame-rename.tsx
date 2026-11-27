import { useLayoutEffect, useRef } from "react";
import { TextField } from "@/components/ui/text-field";
import { useCanvasRuntime } from "../runtime";

/**
 * The name of a frame, edited where its label is: a field with the name selected. Enter or leaving it renames (a name with
 * only spaces, or the same one, changes nothing); Escape keeps the old one. One `apply`, labelled "rename frame".
 */
export function FrameRename({ id, name }: { id: string; name: string }) {
  const rt = useCanvasRuntime();
  const field = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useLayoutEffect(() => {
    field.current?.focus();
    field.current?.select();
  }, []);
  const finish = (value: string | null, refocus: boolean) => {
    if (done.current) return;
    done.current = true;
    const next = value?.trim();
    if (next && next !== name) void rt.apply([{ op: "update", id, props: { name: next } }], rt.text("history.renameFrame"));
    rt.store.actions.setEditing(null);
    if (refocus) rt.viewport()?.focus({ preventScroll: true });
  };
  return (
    <TextField
      ref={field}
      data-testid="frame-rename"
      aria-label={rt.text("editors.frameName")}
      defaultValue={name}
      maxLength={200}
      className="h-[18px] w-45 rounded-xs px-1 py-0 text-xs"
      onFocus={(e) => e.currentTarget.select()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={(e) => finish(e.currentTarget.value, false)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") finish(e.currentTarget.value, true);
        else if (e.key === "Escape") finish(null, true);
      }}
    />
  );
}
