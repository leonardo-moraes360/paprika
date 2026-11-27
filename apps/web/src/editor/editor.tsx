import { EditorLayout } from "@/components/frontends/editor-layout";
import { RegionProfiler } from "@/perf";
import { EditorProvider, initialEditorState } from "./editor-store";
import { readRendererPreference } from "./renderer-preference";
import { EditorBoundary } from "./regions/boundary";
import { Export } from "./regions/export";
import { Header } from "./regions/header";
import { History } from "./regions/history";
import { Import } from "./regions/import";
import { Layers } from "./regions/layers";
import { Notice } from "./regions/notice";
import { Pages } from "./regions/pages";
import { Pins } from "./regions/pins";
import { RightPanel } from "./regions/right-panel";
import { Stage } from "./regions/stage";

/**
 * The editor of one workspace. The route mounts it with `key={workspaceId}` once the document is in, so every
 * workspace gets its own editor state. Each region sits in a `RegionProfiler` and reads its own slices.
 */
export function Editor() {
  return (
    <EditorProvider initial={() => initialEditorState({ renderer: readRendererPreference() })}>
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
<RightPanel />
              }
            />
          </div>
          <RegionProfiler id="history">
            <History />
          </RegionProfiler>
          <RegionProfiler id="pins">
            <Pins />
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

/** Names of the regions (the profiler ids). `agents` (the roster, inside the header) and `team` (the team tab of the right panel) mount only when there are agents or a team. */
export const editorRegionIds = ["header", "pages", "layers", "stage", "properties", "activity", "history", "pins", "agents", "team", "notice", "export", "import"] as const;
/** The regions that are always mounted once the editor is open. */
export const alwaysMountedRegionIds = editorRegionIds.filter((id) => id !== "agents" && id !== "team");
