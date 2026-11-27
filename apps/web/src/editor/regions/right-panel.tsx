import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { SegmentedControl, SegmentedControlItem } from "@/components/ui/segmented-control";
import { useLive } from "@/data/live";
import { RegionProfiler } from "@/perf";
import { editorRightTabs, useEditor, useEditorActions, type EditorRightTab } from "../editor-store";
import { Activity } from "./activity";
import { Properties } from "./properties";
import { TeamPanel } from "./team";

/** "Properties | Team" at the top of the right panel (the design's tabs); the team tab only exists when the server runs with a team. */
function RightTabs({ value }: { value: EditorRightTab }) {
  const { t } = useTranslation();
  const { setRightTab } = useEditorActions();
  return (
    <div className="px-2 pt-2 pb-1">
      <SegmentedControl stretch aria-label={t("app.shell.rightTabs.label")} value={value} onValueChange={(next) => setRightTab(next as EditorRightTab)}>
        {editorRightTabs.map((id) => (
          <SegmentedControlItem key={id} value={id}>
            {t(`app.shell.rightTabs.${id}`)}
          </SegmentedControlItem>
        ))}
      </SegmentedControl>
    </div>
  );
}

/**
 * The right panel: the properties panel, with the tabs in its `header` slot when there is a team, or the team panel
 * under the same tabs while the team tab is picked. Without a team there are no tabs and no team tab.
 */
export function RightPanel() {
  const hasTeam = useLive((s) => s.team != null);
  const tab = useEditor((s) => s.rightTab);
  const showTeam = hasTeam && tab === "team";
  // A constant element per panel: re-rendering it (the tabs came or went) does not visit the activity region.
  const activityRegion = useMemo(
    () => (
      <RegionProfiler id="activity">
        <Activity />
      </RegionProfiler>
    ),
    [],
  );
  const tabs = useMemo(() => (hasTeam ? <RightTabs value={showTeam ? "team" : "properties"} /> : null), [hasTeam, showTeam]);
  return (
    <div className="flex h-full min-h-0 flex-col">
      {showTeam ? (
        <div className="flex h-full min-h-0 flex-col bg-panel">
          {tabs}
          <div className="min-h-0 flex-1 overflow-y-auto">
            <RegionProfiler id="team">
              <TeamPanel />
            </RegionProfiler>
          </div>
        </div>
      ) : (
        <>
          <RegionProfiler id="properties">
            <Properties header={tabs} />
          </RegionProfiler>
          {activityRegion}
        </>
      )}
    </div>
  );
}
