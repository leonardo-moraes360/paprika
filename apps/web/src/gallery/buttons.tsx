import { ArrowRight, Cpu, Download, Plus, Settings, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CodeButton } from "@/components/ui/code-button";
import { IconButton } from "@/components/ui/icon-button";
import { MenuButton } from "@/components/ui/menu-button";
import { Cell, Grid, Section, Specimen, type GalleryMeta } from "./_kit";

export const meta: GalleryMeta = { title: "Buttons", order: 10 };

const variants = [
  ["primary", "Publish"],
  ["secondary", "Duplicate"],
  ["ghost", "Dismiss"],
  ["destructive", "Delete page"],
] as const;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export default function ButtonsSection() {
  const [codeOpen, setCodeOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <Section id="buttons" title="Buttons">
      <Specimen label="Button · style × size" note="Medium is 36 px high, small 28 px; radius 6, label 14/600 and 13/600.">
        {variants.map(([variant, label]) => (
          <Cell key={variant} label={`${variant} · md`}>
            <Button variant={variant}>{label}</Button>
          </Cell>
        ))}
        {variants.map(([variant, label]) => (
          <Cell key={variant} label={`${variant} · sm`}>
            <Button variant={variant} size="sm">
              {label}
            </Button>
          </Cell>
        ))}
        <Cell label="with icon">
          <Button>
            Get started
            <ArrowRight aria-hidden="true" />
          </Button>
        </Cell>
      </Specimen>
      <Specimen label="Button · states" note="Hover and focus are forced for the preview; the pending button is live (press it).">
        {variants.map(([variant, label]) => (
          <div key={variant} className="flex flex-col gap-3">
            <Cell label={`${variant} · hover`}>
              <Button variant={variant} data-force-hover="">
                {label}
              </Button>
            </Cell>
            <Cell label={`${variant} · focus`}>
              <Button variant={variant} data-force-focus="">
                {label}
              </Button>
            </Cell>
            <Cell label={`${variant} · disabled`}>
              <Button variant={variant} disabled>
                {label}
              </Button>
            </Cell>
            <Cell label={`${variant} · pending`}>
              <Button variant={variant} onClick={() => wait(2000)} pendingAnnouncement="Working">
                {label}
              </Button>
            </Cell>
          </div>
        ))}
      </Specimen>
      <Grid>
        <Specimen label="Icon button · states" note="32 × 32, radius 6, icon 18. Normal, hover, active (pressed), disabled; with and without border.">
          {([false, true] as const).map((bordered) => (
            <div key={String(bordered)} className="flex gap-3">
              <Cell label={bordered ? "bordered" : "plain"}>
                <IconButton aria-label="Settings" bordered={bordered}>
                  <Settings aria-hidden="true" />
                </IconButton>
              </Cell>
              <Cell label="hover">
                <IconButton aria-label="Settings" bordered={bordered} data-force-hover="">
                  <Settings aria-hidden="true" />
                </IconButton>
              </Cell>
              <Cell label="focus">
                <IconButton aria-label="Settings" bordered={bordered} data-force-focus="">
                  <Settings aria-hidden="true" />
                </IconButton>
              </Cell>
              <Cell label="active">
                <IconButton aria-label="Settings" bordered={bordered} active>
                  <Settings aria-hidden="true" />
                </IconButton>
              </Cell>
              <Cell label="disabled">
                <IconButton aria-label="Settings" bordered={bordered} disabled>
                  <Settings aria-hidden="true" />
                </IconButton>
              </Cell>
            </div>
          ))}
        </Specimen>
        <Specimen label="Icon button · sizes">
          <Cell label="md · 32">
            <IconButton aria-label="Add" bordered>
              <Plus aria-hidden="true" />
            </IconButton>
          </Cell>
          <Cell label="sm · 28">
            <IconButton aria-label="Add" bordered size="sm">
              <Plus aria-hidden="true" />
            </IconButton>
          </Cell>
          <Cell label="xs · 24">
            <IconButton aria-label="Add" bordered size="xs">
              <Trash2 aria-hidden="true" />
            </IconButton>
          </Cell>
          <Cell label="download">
            <IconButton aria-label="Download">
              <Download aria-hidden="true" />
            </IconButton>
          </Cell>
        </Specimen>
        <Specimen label="Menu button · trigger" note="Only the trigger; open state is aria-expanded (controlled here). The menu comes in a later batch.">
          <Cell label="closed">
            <MenuButton icon={<Cpu />}>WASM · GPU</MenuButton>
          </Cell>
          <Cell label="open">
            <MenuButton icon={<Cpu />} open>
              WASM · GPU
            </MenuButton>
          </Cell>
          <Cell label="no icon">
            <MenuButton>Renderer</MenuButton>
          </Cell>
          <Cell label="focus">
            <MenuButton icon={<Cpu />} data-force-focus="">
              WASM · GPU
            </MenuButton>
          </Cell>
          <Cell label="live">
            <MenuButton icon={<Cpu />} open={menuOpen} onClick={() => setMenuOpen((o) => !o)}>
              WASM · GPU
            </MenuButton>
          </Cell>
        </Specimen>
        <Specimen label="Code button" note="Toggles the code panel (aria-expanded); open state in soft selection.">
          <Cell label="closed">
            <CodeButton>Code</CodeButton>
          </Cell>
          <Cell label="open">
            <CodeButton open>Hide code</CodeButton>
          </Cell>
          <Cell label="hover">
            <CodeButton data-force-hover="">Code</CodeButton>
          </Cell>
          <Cell label="focus">
            <CodeButton data-force-focus="">Code</CodeButton>
          </Cell>
          <Cell label="disabled">
            <CodeButton disabled>Code</CodeButton>
          </Cell>
          <Cell label="live">
            <CodeButton open={codeOpen} onClick={() => setCodeOpen((o) => !o)}>
              {codeOpen ? "Hide code" : "Code"}
            </CodeButton>
          </Cell>
        </Specimen>
      </Grid>
    </Section>
  );
}

