import { Copy, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox } from "@/components/ui/combobox";
import { List, ListItem } from "@/components/ui/list-item";
import { Menu, MenuContent, MenuGroup, MenuGroupLabel, MenuItem, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { MenuButton } from "@/components/ui/menu-button";
import { Radio, RadioGroup } from "@/components/ui/radio-group";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Cell, Grid, Specimen, type GalleryMeta } from "./_kit";

export const meta: GalleryMeta = { title: "Form controls", order: 110 };

const force = { "data-force-focus": "" } as const;

const fonts = [
  { value: "inter", label: "Inter" },
  { value: "geist", label: "Geist" },
  { value: "mono", label: "JetBrains Mono" },
  { value: "serif", label: "Source Serif", disabled: true },
];

const themes = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
  { value: "system", label: "System" },
];

const announce = (change: { type: string; count?: number }) => (change.type === "results" ? `${change.count ?? 0} results` : null);

export default function FormControlsSection() {
  const [rulers, setRulers] = useState<boolean | "indeterminate">("indeterminate");
  const [format, setFormat] = useState<string | null>("png");
  const [bar, setBar] = useState<string | null>("top");
  const [font, setFont] = useState<string | null>("inter");
  return (
    <Grid>
      <Specimen label="Checkbox" note="18 px box, radius 4; checked and mixed fill with the action color and a 14 px white 3 px stroke; empty is the panel color with a 1.5 px field border; label 14 with a 10 px gap. Space toggles; the third click cycles the controlled mixed state here.">
        <Cell label="checked">
          <Checkbox label="Show rulers" defaultChecked />
        </Cell>
        <Cell label="unchecked">
          <Checkbox label="Show rulers" />
        </Cell>
        <Cell label="mixed (controlled)">
          <Checkbox label="Show rulers" checked={rulers} onCheckedChange={setRulers} />
        </Cell>
        <Cell label="focus">
          <Checkbox label="Show rulers" defaultChecked {...force} />
        </Cell>
        <Cell label="disabled">
          <Checkbox label="Show rulers" disabled />
        </Cell>
        <Cell label="disabled, checked">
          <Checkbox label="Show rulers" disabled defaultChecked />
        </Cell>
      </Specimen>
      <Specimen label="Radio" note="18 px circle with a 1.5 px border; checked uses the action border and an 8 px action dot. Arrow keys move and select inside the group.">
        <Cell label="group (controlled)">
          <RadioGroup aria-label="Format" value={format} onValueChange={setFormat}>
            <Radio value="png" label="PNG" />
            <Radio value="jpeg" label="JPEG" />
            <Radio value="svg" label="SVG" />
            <Radio value="pdf" label="PDF" disabled />
          </RadioGroup>
        </Cell>
        <Cell label="focus">
          <RadioGroup aria-label="Format, focus" defaultValue="png">
            <Radio value="png" label="PNG" {...force} />
          </RadioGroup>
        </Cell>
        <Cell label="disabled">
          <RadioGroup aria-label="Format, disabled" defaultValue="png" disabled>
            <Radio value="png" label="PNG" />
          </RadioGroup>
        </Cell>
      </Specimen>
      <Specimen label="Switch" note="40 × 22, radius 11, 18 px white thumb with a 2 px inset; on is green, off is the field color. The label never changes between states.">
        <Cell label="on">
          <Switch label="Snap to grid" defaultChecked />
        </Cell>
        <Cell label="off">
          <Switch label="Snap to grid" />
        </Cell>
        <Cell label="focus">
          <Switch label="Snap to grid" defaultChecked {...force} />
        </Cell>
        <Cell label="disabled">
          <Switch label="Snap to grid" disabled />
        </Cell>
        <Cell label="disabled, on">
          <Switch label="Snap to grid" disabled defaultChecked />
        </Cell>
        <Cell label="no label">
          <Switch aria-label="Snap to grid" />
        </Cell>
      </Specimen>
      <Specimen label="List item" note="32 px high, radius 4, 8 px side padding, 14 px label, 16 px check on the right for the checked item. Highlighted rows use the surface color. Arrow keys move; Enter or Space picks." className="items-start">
        <div className="w-68">
          <List aria-label="Fonts" value={font} onValueChange={setFont} activation="manual">
            {fonts.map((f) => (
              <ListItem key={f.value} value={f.value} disabled={f.disabled}>
                {f.label}
              </ListItem>
            ))}
          </List>
        </div>
        <Cell label="highlighted (forced)">
          <div className="w-68">
            <List aria-label="Fonts, highlighted" defaultValue="inter">
              <ListItem value="inter" data-highlighted="">
                Inter
              </ListItem>
            </List>
          </div>
        </Cell>
      </Specimen>
      <Specimen label="Select" note="Menu dropdown: 36 px, radius 6, 12 px left and 10 px right padding, 14 px value, 16 px chevron. Open uses the selection border; the list is a popover surface with list items and a check on the chosen one." className="flex-col items-stretch gap-4">
        <Select label="Theme" options={themes} defaultValue="dark" placeholder="Choose a theme" className="max-w-70" />
        <Select label="Theme · placeholder" options={themes} placeholder="Choose a theme" className="max-w-70" />
        <Select label="Theme · focus" options={themes} defaultValue="dark" placeholder="Choose" className="max-w-70" triggerProps={force} />
        <Select label="Theme · error" options={themes} placeholder="Choose a theme" error="Pick a theme to continue." className="max-w-70" />
        <Select label="Theme · disabled" options={themes} defaultValue="dark" placeholder="Choose" disabled className="max-w-70" />
      </Specimen>
      <Specimen label="Combobox" note="Same 36 px box as the select with a typed value, a 1.5 px caret and the up/down chevrons (16 px). Typing filters; arrows highlight; Enter picks. The result announcement, the empty text and the toggle name arrive by props." className="flex-col items-stretch gap-4">
        <Combobox label="Font" options={fonts} placeholder="Search fonts" announcement={announce} emptyLabel="No fonts found." toggleLabel="Show fonts" className="max-w-70" />
        <Combobox label="Font · focus" options={fonts} defaultValue="inter" announcement={announce} emptyLabel="No fonts found." toggleLabel="Show fonts" className="max-w-70" boxProps={force} />
        <Combobox label="Font · error" options={fonts} placeholder="Search fonts" announcement={announce} emptyLabel="No fonts found." toggleLabel="Show fonts" error="Pick a font from the list." className="max-w-70" />
        <Combobox label="Font · disabled" options={fonts} defaultValue="inter" announcement={announce} emptyLabel="No fonts found." toggleLabel="Show fonts" disabled className="max-w-70" />
      </Specimen>
      <Specimen label="Menu" note="Live: Menu, MenuTrigger (rendered as MenuButton), items, separator, group label and radio items with a check. Item: 32 px, radius 4, 8 px padding, 12 px gap, label 14 (destructive 14/600 red ink), shortcut as two Kbd chips on the right, highlighted row on the surface color. Panel: popover surface, 8 px padding, 2 px gap; group label 12/600 uppercase. Arrow keys, typeahead and Escape come from the SDK." className="items-start">
        <Menu pendingAnnouncement="Working">
          <MenuTrigger render={<MenuButton />}>Actions</MenuTrigger>
          <MenuContent>
            <MenuItem value="rename" icon={<Pencil />} keys={["F2"]}>
              Rename
            </MenuItem>
            <MenuItem value="duplicate" icon={<Copy />} keys={["Ctrl", "D"]}>
              Duplicate
            </MenuItem>
            <MenuItem value="lock" keys={["Ctrl", "L"]} disabled>
              Lock
            </MenuItem>
            <MenuSeparator />
            <MenuGroup>
              <MenuGroupLabel>Bar position</MenuGroupLabel>
              <MenuRadioGroup value={bar ?? "top"} onValueChange={setBar}>
                <MenuRadioItem value="top">Top</MenuRadioItem>
                <MenuRadioItem value="left">Left</MenuRadioItem>
                <MenuRadioItem value="right">Right</MenuRadioItem>
              </MenuRadioGroup>
            </MenuGroup>
            <MenuSeparator />
            <MenuItem value="delete" icon={<Trash2 />} destructive keys={["Del"]}>
              Delete
            </MenuItem>
          </MenuContent>
        </Menu>
      </Specimen>
    </Grid>
  );
}
