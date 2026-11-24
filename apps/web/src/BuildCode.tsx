import { useMemo, useState } from "react";
import { Code2 } from "lucide-react";
import { exportReact } from "@paprika/core";
import { toolActivity, topFrameId } from "./agents";
import { useT } from "./i18n";
import { useLive } from "./useDocument";
import { cx } from "./ui";

export function BuildCode() {
  const m = useT();
  const doc = useLive((s) => s.doc);
  const agents = useLive((s) => s.agents);
  const build = useLive((s) => s.build);
  const [open, setOpen] = useState(false);
  const frameId = useMemo(() => {
    if (!doc) return undefined;
    const fromBuild = build?.ids[Math.min(build.index, build.ids.length - 1)];
    if (fromBuild) {
      const frame = topFrameId(doc, fromBuild);
      if (frame) return frame;
    }
    for (const agent of agents) {
      if (toolActivity(agent.tool) !== "writing") continue;
      for (const id of agent.nodes) {
        const frame = topFrameId(doc, id);
        if (frame) return frame;
      }
    }
    return undefined;
  }, [doc, agents, build]);
  const code = useMemo(() => {
    if (!doc || !frameId || !doc.nodes[frameId]) return "";
    return exportReact(doc, frameId);
  }, [doc, frameId]);
  return (
    <div className="pointer-events-none absolute top-3 left-3 z-6 flex w-64 flex-col items-start gap-2">
      <button
        type="button"
        className={cx(
          "pointer-events-auto inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-2 py-1 text-xs font-semibold",
          open ? "border-[#3b82f6] bg-[#3b82f6] text-[#141827]" : "border-line bg-panel text-fg",
        )}
        aria-pressed={open}
        aria-label={open ? m.buildCodeHide : m.buildCode}
        data-testid="build-code-toggle"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => setOpen((value) => !value)}
      >
        <Code2 className="size-3.5" aria-hidden />
        {open ? m.buildCodeHide : m.buildCode}
      </button>
      {open && (
        <pre
          className="pointer-events-auto m-0 max-h-[50vh] w-full overflow-auto rounded-xl border border-line bg-[#141827cc] p-3 font-mono text-xs leading-snug whitespace-pre text-[#eef0f7]"
          data-testid="build-code"
          onPointerDown={(e) => e.stopPropagation()}
        >
          {code || m.buildCodeEmpty}
        </pre>
      )}
    </div>
  );
}
