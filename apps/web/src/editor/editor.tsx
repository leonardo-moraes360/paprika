import { EditorLayout } from "@/components/frontends/editor-layout";
import { RegionProfiler } from "@/perf";
import { EditorProvider, initialEditorState } from "./editor-store";
import { Activity } from "./regions/activity";
import { Agents } from "./regions/agents";
import { EditorBoundary } from "./regions/boundary";
import { Export } from "./regions/export";
import { Header } from "./regions/header";
import { History } from "./regions/history";
import { Import } from "./regions/import";
import { Layers } from "./regions/layers";
import { Notice } from "./regions/notice";
import { Pages } from "./regions/pages";
import { Pins } from "./regions/pins";
import { Properties } from "./regions/properties";
import { Stage } from "./regions/stage";
import { Team } from "./regions/team";

/**
 * The editor of one workspace. The route mounts it with `key={workspaceId}` once the document is in, so every
 * workspace gets its own editor state. Each region sits in a `RegionProfiler` and reads its own slices.
 */
export function Editor() {
  return (
    <EditorProvider initial={initialEditorState}>
      <EditorBoundary>
        <div className="flex h-dvh min-h-0 flex-col bg-bg text-fg">
          <RegionProfiler id="header">
            <Header />
          </RegionProfiler>
          <div className="min-h-0 flex-1">
            <EditorLayout
              left={
                <div className="flex h-full min-h-0 flex-col">
                  <RegionProfiler id="pages">
                    <Pages />
                  </RegionProfiler>
                  <RegionProfiler id="layers">
                    <Layers />
                  </RegionProfiler>
                </div>
              }
              center={
                <RegionProfiler id="stage">
                  <Stage />
                </RegionProfiler>
              }
              right={
                <div className="flex h-full min-h-0 flex-col">
                  <RegionProfiler id="properties">
                    <Properties />
                  </RegionProfiler>
                  <RegionProfiler id="activity">
                    <Activity />
                  </RegionProfiler>
                </div>
              }
            />
          </div>
          <RegionProfiler id="history">
            <History />
          </RegionProfiler>
          <RegionProfiler id="pins">
            <Pins />
          </RegionProfiler>
          <RegionProfiler id="agents">
            <Agents />
          </RegionProfiler>
          <RegionProfiler id="team">
            <Team />
          </RegionProfiler>
          <RegionProfiler id="notice">
            <Notice />
          </RegionProfiler>
          <RegionProfiler id="export">
            <Export />
          </RegionProfiler>
          <RegionProfiler id="import">
            <Import />
          </RegionProfiler>
        </div>
      </EditorBoundary>
    </EditorProvider>
  );
}

/** Names of the regions, in the order `editor.tsx` mounts them (the profiler ids). */
export const editorRegionIds = ["header", "pages", "layers", "stage", "properties", "activity", "history", "pins", "agents", "team", "notice", "export", "import"] as const;
