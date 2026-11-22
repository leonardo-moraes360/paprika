import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cx, ui } from "../ui";
import { sectionOpen, setSectionOpen } from "./sectionState";

interface Props {
  id: string;
  title: string;
  defaultOpen?: boolean;
  badge?: ReactNode;
  children: ReactNode;
}

export function InspectorSection({ id, title, defaultOpen = false, badge, children }: Props) {
  const [open, setOpen] = useState(() => sectionOpen(id, defaultOpen));
  const bodyId = `inspector-section-${id}`;
  const toggle = () => {
    const next = !open;
    setOpen(next);
    setSectionOpen(id, next);
  };
  return (
    <section className={ui.inspectorSection} data-testid={`inspector-section-${id}`}>
      <button type="button" className={ui.inspectorSectionTrigger} aria-expanded={open} aria-controls={bodyId} onClick={toggle}>
        <ChevronRight className={cx("size-3.5 shrink-0 text-muted transition-transform", open && "rotate-90")} aria-hidden />
        <span className="min-w-0 flex-1 truncate text-left">{title}</span>
        {badge}
      </button>
      {open ? (
        <div id={bodyId} className={ui.inspectorSectionBody}>
          {children}
        </div>
      ) : null}
    </section>
  );
}