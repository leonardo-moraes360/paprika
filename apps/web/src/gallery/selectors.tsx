import { AlignCenterVertical, AlignEndVertical, AlignStartVertical } from "lucide-react";
import { useState } from "react";
import { SegmentedControl, SegmentedControlItem } from "@/components/ui/segmented-control";
import { ThemeSwitch } from "@/components/ui/theme-switch";
import type { ThemePreference } from "@/lib/theme";
import { Cell, Grid, Specimen, type GalleryMeta } from "./_kit";

export const meta: GalleryMeta = { title: "Selectors", order: 30 };

const themeLabels = { label: "Theme", system: "System", light: "Light", dark: "Dark" };

const icons = [
  { value: "start", label: "Align left", Icon: AlignStartVertical },
  { value: "center", label: "Align center", Icon: AlignCenterVertical },
  { value: "end", label: "Align right", Icon: AlignEndVertical },
] as const;

export default function SelectorsSection() {
  const [view, setView] = useState<string | null>("properties");
  const [align, setAlign] = useState<string | null>(null);
  const [theme, setTheme] = useState<ThemePreference>("system");
  return (
    <>
      <Grid>
        <Specimen label="Segmented control · text" note="Rail 30 px, 1 px field border, 2 px inset (first option at x = 2), radius 6; options 24 px high, radius 4, 12/500 muted; the active one is 12/600 ink on the surface with a field border. Arrow keys move the selection.">
          <div className="w-full max-w-xs">
            <SegmentedControl aria-label="Panel" value={view} onValueChange={setView} stretch>
              <SegmentedControlItem value="properties">Properties</SegmentedControlItem>
              <SegmentedControlItem value="team">Team</SegmentedControlItem>
            </SegmentedControl>
          </div>
          <SegmentedControl aria-label="Panel, three options" defaultValue="b">
            <SegmentedControlItem value="a">One</SegmentedControlItem>
            <SegmentedControlItem value="b">Two</SegmentedControlItem>
            <SegmentedControlItem value="c">Three</SegmentedControlItem>
          </SegmentedControl>
          <Cell label="disabled">
            <SegmentedControl aria-label="Panel, disabled" defaultValue="a" disabled>
              <SegmentedControlItem value="a">One</SegmentedControlItem>
              <SegmentedControlItem value="b">Two</SegmentedControlItem>
            </SegmentedControl>
          </Cell>
          <Cell label="focus">
            <SegmentedControl aria-label="Panel, focus" defaultValue="a">
              <SegmentedControlItem value="a" data-force-focus="">
                One
              </SegmentedControlItem>
              <SegmentedControlItem value="b">Two</SegmentedControlItem>
            </SegmentedControl>
          </Cell>
        </Specimen>
        <Specimen label="Segmented control · icons" note="Same rail, 92 × 30, with three 28 × 24 icon options. No value selected is a valid (mixed) state: no indicator.">
          <Cell label="none selected">
            <SegmentedControl aria-label="Alignment" value={align} onValueChange={setAlign}>
              {icons.map(({ value, label, Icon }) => (
                <SegmentedControlItem key={value} value={value} iconOnly aria-label={label}>
                  <Icon aria-hidden="true" />
                </SegmentedControlItem>
              ))}
            </SegmentedControl>
          </Cell>
          <Cell label="selected">
            <SegmentedControl aria-label="Alignment, selected" defaultValue="center">
              {icons.map(({ value, label, Icon }) => (
                <SegmentedControlItem key={value} value={value} iconOnly aria-label={label}>
                  <Icon aria-hidden="true" />
                </SegmentedControlItem>
              ))}
            </SegmentedControl>
          </Cell>
          <Cell label="disabled">
            <SegmentedControl aria-label="Alignment, disabled" disabled>
              {icons.map(({ value, label, Icon }) => (
                <SegmentedControlItem key={value} value={value} iconOnly aria-label={label}>
                  <Icon aria-hidden="true" />
                </SegmentedControlItem>
              ))}
            </SegmentedControl>
          </Cell>
        </Specimen>
        <Specimen label="Theme switch" note="System, Light, Dark. Rail radius 8: 32 px high with 28 px options of radius 6 (13 text, 14 icons); compact is 28 px high, 92 wide, with 28 × 24 icon options. Controlled by props; this one is local to the specimen (the header switch drives the page).">
          <Cell label="full">
            <ThemeSwitch value={theme} onValueChange={setTheme} labels={themeLabels} />
          </Cell>
          <Cell label="compact">
            <ThemeSwitch value={theme} onValueChange={setTheme} labels={themeLabels} compact />
          </Cell>
          <Cell label="light selected">
            <ThemeSwitch value="light" onValueChange={() => undefined} labels={themeLabels} />
          </Cell>
          <Cell label="dark selected, compact">
            <ThemeSwitch value="dark" onValueChange={() => undefined} labels={themeLabels} compact />
          </Cell>
        </Specimen>
      </Grid>
    </>
  );
}
