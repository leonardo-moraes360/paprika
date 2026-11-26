import { Bot, MapPin } from "lucide-react";
import { Kbd } from "@/components/ui/kbd";
import { Pill, PillDot } from "@/components/ui/pill";
import { Tag } from "@/components/ui/tag";
import { Cell, Grid, Specimen, type GalleryMeta } from "./_kit";

export const meta: GalleryMeta = { title: "Labels", order: 20 };

export default function LabelsSection() {
  return (
    <>
      <Grid>
        <Specimen label="Key" note="Shortcut cap: 20 px high, 6 px side padding, radius 4, field border with a 1 px bottom shadow in the field colour, 12/600.">
          <Cell label="single">
            <Kbd>Y</Kbd>
          </Cell>
          <Cell label="word">
            <Kbd>Ctrl</Kbd>
          </Cell>
          <Cell label="combination">
            <span className="flex items-center gap-1">
              <Kbd>Ctrl</Kbd>
              <Kbd>D</Kbd>
            </span>
          </Cell>
        </Specimen>
        <Specimen label="Tag" note="24 px high, 10 px side padding, full radius, 12/600. Green ink on a green tint is the guide's active tag; other tones are the same recipe. Neutral is the default.">
          <Cell label="green (active)">
            <Tag tone="green">active</Tag>
          </Cell>
          <Cell label="yellow">
            <Tag tone="yellow">pending</Tag>
          </Cell>
          <Cell label="red">
            <Tag tone="red">failed</Tag>
          </Cell>
          <Cell label="select">
            <Tag tone="select">selected</Tag>
          </Cell>
          <Cell label="neutral (default)">
            <Tag>draft</Tag>
          </Cell>
        </Specimen>
      </Grid>
      <Specimen label="Pill" note="24 px high, 10 px side padding, 6 px gap, full radius, 12/600. Icon or dot before the text.">
        <Cell label="neutral">
          <Pill>2 open</Pill>
        </Cell>
        <Cell label="neutral + icon">
          <Pill icon={<MapPin />}>3 pins</Pill>
        </Cell>
        <Cell label="select">
          <Pill tone="select">You</Pill>
        </Cell>
        <Cell label="red">
          <Pill tone="red">2 errors</Pill>
        </Cell>
        <Cell label="yellow">
          <Pill tone="yellow">1 warning</Pill>
        </Cell>
        <Cell label="green">
          <Pill tone="green">Resolved</Pill>
        </Cell>
        {(["agent-1", "agent-2", "agent-3", "agent-4"] as const).map((tone, i) => (
          <Cell key={tone} label={tone}>
            <Pill tone={tone} icon={i === 0 ? <Bot /> : <PillDot />}>
              Agent {i + 1}
            </Pill>
          </Cell>
        ))}
      </Specimen>
    </>
  );
}
