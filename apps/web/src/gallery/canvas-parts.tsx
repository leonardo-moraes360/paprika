import { Image, Link2 } from "lucide-react";
import { Ellipsis } from "lucide-react";
import { useState } from "react";
import { AgentLabel } from "@/components/ui/agent-label";
import { AttachedReference } from "@/components/ui/attached-reference";
import { Cursor } from "@/components/ui/cursor";
import { HistoryStep } from "@/components/ui/history-step";
import { IconButton } from "@/components/ui/icon-button";
import { Pin } from "@/components/ui/pin";
import { SelectionHandles } from "@/components/ui/selection-handles";
import { SelectionSize } from "@/components/ui/selection-size";
import { TeamRow } from "@/components/ui/team-row";
import { Cell, Grid, Specimen, type GalleryMeta } from "./_kit";

export const meta: GalleryMeta = { title: "Canvas parts", order: 210 };

const noop = () => undefined;

export default function CanvasPartsSection() {
  const [refs, setRefs] = useState(["moodboard.png", "brief.pdf"]);
  const [lastCorner, setLastCorner] = useState("none");
  return (
    <Grid>
      <Specimen label="Agent label" note="24 px high, full radius, 10 px right and 8 px left padding, 6 px gap, 14 px icon (pen = writing, eye = reading), name 12/700 and tool 12/500 in the agent ink on the agent fill." className="items-start">
        <Cell label="agent 1 · writing">
          <AgentLabel tone="agent-1" status="writing" statusLabel="Writing" name="Claude" tool="create_nodes" />
        </Cell>
        <Cell label="agent 2 · reading">
          <AgentLabel tone="agent-2" status="reading" statusLabel="Reading" name="Codex" tool="get_nodes" />
        </Cell>
        <Cell label="agent 3 · writing">
          <AgentLabel tone="agent-3" status="writing" statusLabel="Writing" name="Cursor" tool="move_nodes" />
        </Cell>
        <Cell label="agent 4 · reading">
          <AgentLabel tone="agent-4" status="reading" statusLabel="Reading" name="Gemini" tool="get_nodes" />
        </Cell>
      </Specimen>
      <Specimen label="Team row" note="36 px high, radius 6, 8 px padding and gap: 10 px colour dot with a 1 px edge, name 13/600 (64 px), tool 12 muted (110 px), page 12 muted (56 px). Idle agents are faded to 60%." className="items-start">
        <div className="flex w-[280px] flex-col gap-0.5 rounded-xl border border-line bg-popover p-3">
          <TeamRow tone="agent-1" name="Claude" tool="update_nodes" page="Cover" />
          <TeamRow tone="agent-2" name="Codex" tool="get_nodes" page="Cover" />
          <TeamRow tone="agent-3" name="Cursor" tool="move_nodes" page="Editor" />
          <TeamRow tone="agent-4" name="Gemini" tool="2 min ago" page="Cover" idle />
        </div>
      </Specimen>
      <Specimen label="Cursor" note="Arrow 18 × 22 with a 1.5 px stroke in the canvas background colour; the label starts at (16, 20), 24 px high, full radius, 10 px padding, 13/600. You are the select colour; each agent has its own. The box is 18 × 44; position it with className." className="items-start">
        {(
          [
            ["select", "You", "You"],
            ["agent-1", "Claude · editing Cover", "Agent 1"],
            ["agent-2", "Codex · reading", "Agent 2"],
            ["agent-3", "Cursor · moving", "Agent 3"],
            ["agent-4", "Gemini · reading", "Agent 4"],
          ] as const
        ).map(([tone, label, caption]) => (
          <Cell key={tone} label={caption}>
            <div className="h-11 w-48 rounded-md bg-canvas p-2">
              <Cursor tone={tone} label={label} />
            </div>
          </Cell>
        ))}
        <Cell label="arrow only">
          <div className="h-11 w-16 rounded-md bg-canvas p-2">
            <Cursor tone="agent-1" />
          </div>
        </Cell>
      </Specimen>
      <Specimen label="Pin" note="26 px circle with a 2 px ring in the page colour and a soft shadow, number 12/700. Open is the action red; claimed takes the colour of the agent that took it; resolved is green (green ink in the light theme). A button: Enter or Space activates." className="items-end">
        <Cell label="open">
          <Pin number={1} aria-label="Pin 1, open" onClick={noop} />
        </Cell>
        <Cell label="claimed · agent 1">
          <Pin number={2} status="claimed" tone="agent-1" aria-label="Pin 2, claimed by agent 1" onClick={noop} />
        </Cell>
        <Cell label="claimed · agent 2">
          <Pin number={3} status="claimed" tone="agent-2" aria-label="Pin 3, claimed by agent 2" onClick={noop} />
        </Cell>
        <Cell label="claimed · agent 3">
          <Pin number={4} status="claimed" tone="agent-3" aria-label="Pin 4, claimed by agent 3" onClick={noop} />
        </Cell>
        <Cell label="claimed · agent 4">
          <Pin number={5} status="claimed" tone="agent-4" aria-label="Pin 5, claimed by agent 4" onClick={noop} />
        </Cell>
        <Cell label="resolved">
          <Pin number={6} status="resolved" aria-label="Pin 6, resolved" onClick={noop} />
        </Cell>
        <Cell label="focus">
          <Pin number={7} data-force-focus="" aria-label="Pin 7, open, focused" />
        </Cell>
      </Specimen>
      <Specimen label="Selection size" note="22 px high pill, radius 11, 10 px padding, 12/600 in the on-select ink over the select fill." className="items-start">
        <Cell label="default">
          <SelectionSize>240 × 120</SelectionSize>
        </Cell>
        <Cell label="large">
          <SelectionSize>1280 × 720</SelectionSize>
        </Cell>
      </Specimen>
      <Specimen
        label="Selection handles"
        note={`1.5 px select frame centred on the edge, four 8 px handles (radius 2, panel fill, 1.5 px select stroke) centred on the corners, and the size pill 10 px below. The handles report pointer presses by corner; last pressed: ${lastCorner}.`}
        className="items-start"
      >
        <div className="relative h-[200px] w-[360px] rounded-lg bg-canvas">
          <div className="absolute top-6 left-8 h-[120px] w-[240px] rounded-lg border border-line bg-frame" />
          <SelectionHandles
            className="top-6 left-8 h-[120px] w-[240px]"
            size="240 × 120"
            onHandlePointerDown={(corner) => setLastCorner(corner)}
          />
        </div>
      </Specimen>
      <Specimen label="History step" note="32 px high, radius 6, 8 px left and 4 px right padding, 8 px gap. Author chip 20 px high, 12/700 (you in the select pill, agents in their colour); it can be omitted inside a group by the same author. Undone steps go muted with the undo icon and a note. Actions arrive by slot." className="items-start">
        <div className="flex w-[352px] flex-col gap-0.5 rounded-lg bg-panel p-1">
          <HistoryStep author="you" label="Move “Title”" time="now" />
          <HistoryStep author="claude" tone="agent-1" label="Update “Button”" time="12 s" />
          <HistoryStep label="Resize “Button”" time="12 s" />
          <HistoryStep author="you" label="Move “Title”" time="1 min" undone undoneLabel="undone" />
          <HistoryStep
            author="you"
            label="Change colour of “Button”"
            time="2 min"
            active
            actions={
              <IconButton size="xs" aria-label="Step menu">
                <Ellipsis aria-hidden="true" />
              </IconButton>
            }
          />
          <HistoryStep
            author="codex"
            tone="agent-2"
            label="Create “Card”"
            time="3 min"
            data-force-hover=""
            actions={
              <IconButton size="xs" aria-label="Step menu">
                <Ellipsis aria-hidden="true" />
              </IconButton>
            }
          />
        </div>
      </Specimen>
      <Specimen label="Attached reference" note="36 px high, radius 6, page background with a line border, 10 px left and 4 px right padding, 8 px gap, 16 px type icon, name 13/600 ink, detail 12 muted, 28 px remove button." className="items-start">
        <div className="flex w-[320px] flex-col gap-2">
          {refs.map((name) => (
            <AttachedReference
              key={name}
              name={name}
              detail={name.endsWith(".png") ? "PNG · 1.2 MB" : "PDF · 340 KB"}
              icon={name.endsWith(".png") ? <Image /> : undefined}
              removeLabel={`Remove ${name}`}
              onRemove={() => setRefs((current) => current.filter((item) => item !== name))}
            />
          ))}
          <AttachedReference name="https://example.com/spec" detail="link" icon={<Link2 />} removeLabel="Remove link" onRemove={noop} />
          <AttachedReference name="read-only.pdf" detail="PDF · 1 MB" removeLabel="Remove" />
        </div>
      </Specimen>
    </Grid>
  );
}
