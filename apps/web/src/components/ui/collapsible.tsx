import { useLayoutEffect, useRef, useState, type ComponentProps } from "react";
import { Collapsible as CollapsiblePrimitive } from "radix-ui";
import { cn } from "../../lib/cn";

export const Collapsible = CollapsiblePrimitive.Root;
export const CollapsibleTrigger = CollapsiblePrimitive.Trigger;

export function CollapsibleContent({ className, children, ...props }: ComponentProps<"div">) {
  const ref = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [animate, setAnimate] = useState(false);

  useLayoutEffect(() => {
    const parent = ref.current?.parentElement;
    if (!parent) return;
    const apply = (withMotion: boolean) => {
      const isOpen = parent.getAttribute("data-state") === "open";
      if (isOpen) setMounted(true);
      setAnimate(withMotion);
      setOpen(isOpen);
      if (!isOpen && (ref.current?.getBoundingClientRect().height ?? 0) < 1) setMounted(false);
    };
    apply(false);
    const obs = new MutationObserver(() => apply(true));
    obs.observe(parent, { attributes: true, attributeFilter: ["data-state"] });
    return () => obs.disconnect();
  }, []);

  return (
    <div
      {...props}
      ref={ref}
      data-slot="collapsible-content"
      data-state={open ? "open" : "closed"}
      className={cn(
        "grid overflow-hidden",
        open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        animate &&
          (open
            ? "animate-[inspector-collapse-down_200ms_ease-out_both]"
            : "animate-[inspector-collapse-up_200ms_ease-out_both]"),
      )}
      onAnimationEnd={(event) => {
        if (event.target !== event.currentTarget) return;
        if (ref.current?.parentElement?.getAttribute("data-state") !== "open") setMounted(false);
      }}
    >
      <div className={cn("min-h-0 overflow-hidden", className)} inert={!open}>
        {mounted ? children : null}
      </div>
    </div>
  );
}
