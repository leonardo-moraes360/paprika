import { useState } from "react";
import { NumberField } from "@/components/ui/number-field";
import { SearchField } from "@/components/ui/search-field";
import { SecretField } from "@/components/ui/secret-field";
import { TextArea } from "@/components/ui/text-area";
import { TextField } from "@/components/ui/text-field";
import { Cell, Grid, Specimen, type GalleryMeta } from "./_kit";

export const meta: GalleryMeta = { title: "Form fields", order: 100 };

const force = { "data-force-focus": "" } as const;
const stepLabels = { incrementLabel: "Increase", decrementLabel: "Decrease" };

export default function FormFieldsSection() {
  const [bio, setBio] = useState("Draws brand systems.");
  const [query, setQuery] = useState("");
  return (
    <Grid>
      <Specimen
        label="Text field"
        note="40 px high, radius 6, field background, 1 px field border, 12 px side padding, 14 px text. Focus and error use a 1.5 px border plus a 2 px outline with 2 px offset (focus selection cyan, error red ink). Label 12/600, help 12 muted, error 12/500 red ink; the error text comes by prop."
        className="flex-col items-stretch gap-4"
      >
        <TextField label="Layer name" placeholder="Search layers…" defaultValue="Cover" description="Shown in the layers panel." />
        <TextField label="Layer name · focus" defaultValue="Cover" {...force} />
        <TextField label="Layer name · error" defaultValue="Cover" error="That name is already in use." />
        <TextField label="Layer name · disabled" defaultValue="Cover" disabled />
        <TextField label="Empty" placeholder="Search layers…" />
      </Specimen>
      <Specimen
        label="Number field"
        note="36 px high, radius 6, prefix 13/600 muted, value 14, suffix 13 muted, steppers as 26 px wide plus and minus buttons stacked. Arrow keys, Page Up/Down and the steppers change the value; typing commits on Enter or blur."
        className="flex-col items-stretch gap-4"
      >
        <NumberField {...stepLabels} label="Width" prefix="W" suffix="px" defaultValue={1600} min={0} step={8} className="max-w-40" />
        <NumberField {...stepLabels} label="Width · focus" prefix="W" suffix="px" defaultValue={1600} className="max-w-40" boxProps={force} />
        <NumberField {...stepLabels} label="Width · error" prefix="W" suffix="px" defaultValue={-4} error="Must be 0 or more." className="max-w-40" />
        <NumberField {...stepLabels} label="Width · disabled" prefix="W" suffix="px" defaultValue={1600} disabled className="max-w-40" />
        <NumberField {...stepLabels} aria-label="Opacity, no steppers" suffix="%" defaultValue={80} steppers={false} className="max-w-40" />
      </Specimen>
      <Specimen
        label="Secret field"
        note="36 px high, 280 wide in the guide. 28 px square icon buttons (radius 4, 16 px icons) for show/hide and copy, right padding 4. The toggle keeps one name in both states; the copy action is a callback."
        className="flex-col items-stretch gap-4"
      >
        <SecretField toggleLabel="Show key" copyLabel="Copy key" label="Agent key" defaultValue="pk-agent-7f3a92c1e0" className="max-w-70" />
        <SecretField toggleLabel="Show key" copyLabel="Copy key" label="Agent key · visible" defaultValue="pk-agent-7f3a92c1e0" defaultVisible className="max-w-70" />
        <SecretField toggleLabel="Show key" copyLabel="Copy key" label="Agent key · focus" defaultValue="pk-agent-7f3a92c1e0" className="max-w-70" boxProps={force} />
        <SecretField toggleLabel="Show key" label="Agent key · error" defaultValue="pk-agent" error="The key is too short." className="max-w-70" />
        <SecretField toggleLabel="Show key" copyLabel="Copy key" label="Agent key · disabled" defaultValue="pk-agent-7f3a92c1e0" disabled className="max-w-70" />
      </Specimen>
      <Specimen
        label="Text area"
        note="Minimum 96 px, radius 6, 12 px sides and 10 px top padding, 14 px text with 1.45 line height; counter 12 muted at the bottom right, set by prop. Same focus and error treatment as the text field."
        className="flex-col items-stretch gap-4"
      >
        <TextArea label="Pin note" description="Shown to the agent." placeholder="What should the AI do here?" counter="0/500" maxLength={500} />
        <TextArea label="Pin note · filled" value={bio} onValueChange={setBio} counter={`${bio.length}/500`} maxLength={500} />
        <TextArea label="Pin note · focus" defaultValue="Make the button bigger." counter="23/500" boxProps={force} />
        <TextArea label="Pin note · error" defaultValue="" error="Write a note before sending." counter="0/500" />
        <TextArea label="Pin note · disabled" defaultValue="Make the button bigger." disabled counter="23/500" />
      </Specimen>
      <Specimen
        label="Search field"
        note="34 px high, radius 6, 10 px left and 6 px right padding, 8 px gap, 16 px magnifier in muted, 13 px text, shortcut as Kbd. Pressing the icon focuses the input."
        className="flex-col items-stretch gap-4"
      >
        <SearchField aria-label="Search" placeholder="Search…" shortcut="Ctrl K" clearLabel="Clear search" value={query} onValueChange={setQuery} />
        <Cell label="focus">
          <div className="w-full min-w-72">
            <SearchField aria-label="Search, focus" placeholder="Search…" defaultValue="brand" shortcut="Ctrl K" boxProps={force} />
          </div>
        </Cell>
        <Cell label="no shortcut">
          <div className="w-full min-w-72">
            <SearchField aria-label="Search, no shortcut" placeholder="Search…" />
          </div>
        </Cell>
        <Cell label="disabled">
          <div className="w-full min-w-72">
            <SearchField aria-label="Search, disabled" placeholder="Search…" shortcut="Ctrl K" disabled />
          </div>
        </Cell>
      </Specimen>
    </Grid>
  );
}
