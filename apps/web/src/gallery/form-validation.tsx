import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ColorPicker } from "@/components/ui/color-picker";
import { Combobox } from "@/components/ui/combobox";
import { NumberField } from "@/components/ui/number-field";
import { SecretField } from "@/components/ui/secret-field";
import { Select } from "@/components/ui/select";
import { TextField } from "@/components/ui/text-field";
import { Specimen, type GalleryMeta } from "./_kit";
import { colorLabels } from "./form-color";

export const meta: GalleryMeta = { title: "Form validation", order: 130 };

const themes = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
  { value: "system", label: "System" },
];

const announce = (change: { type: string; count?: number }) => (change.type === "results" ? `${change.count ?? 0} ${change.count === 1 ? "result" : "results"}` : null);

export default function FormValidationSection() {
  const [submitted, setSubmitted] = useState("");
  const [commits, setCommits] = useState(0);
  return (
    <Specimen
      label="Form, reset and validation"
      note="A real form: names reach the FormData, Reset returns every control to its default (the color picker included) and a required select or checkbox shows its own message by prop. The commit counter counts onValueCommit from the picker, including edits typed in its channel fields."
      className="items-start"
    >
      <form
        id="gallery-form"
        onSubmit={(event) => {
          event.preventDefault();
          setSubmitted(new URLSearchParams(new FormData(event.currentTarget) as unknown as Record<string, string>).toString());
        }}
        className="flex w-full max-w-72 flex-col gap-4"
      >
        <TextField name="text" label="Name" defaultValue="Cover" />
        <NumberField name="num" label="Width" incrementLabel="Increase" decrementLabel="Decrease" defaultValue={5} />
        <SecretField name="secret" label="Key" toggleLabel="Show key" defaultValue="s1" />
        <Select name="theme" label="Theme" options={themes} placeholder="Choose a theme" required validationMessages={{ valueMissing: "Pick a theme to continue." }} />
        <Combobox name="font" label="Font" options={themes} announcement={announce} emptyLabel="None" toggleLabel="Show" defaultValue="light" />
        <Checkbox name="terms" value="yes" label="I accept the terms" required validationMessages={{ valueMissing: "You must accept the terms." }} />
        <ColorPicker
          aria-label="Fill"
          labels={colorLabels}
          name="fill"
          defaultValue="#FF0000"
          onValueCommit={() => setCommits((count) => count + 1)}
        />
        <div className="flex gap-2">
          <Button type="submit" pendingAnnouncement="Working">
            Submit
          </Button>
          <Button type="reset" variant="secondary" pendingAnnouncement="Working">
            Reset
          </Button>
        </div>
        <output data-testid="form-data" className="text-xs break-all text-muted">{submitted}</output>
        <output data-testid="commits" className="text-xs text-muted">{commits}</output>
      </form>
    </Specimen>
  );
}
