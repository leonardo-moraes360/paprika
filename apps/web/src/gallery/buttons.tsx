import { Menu, MenuContent, MenuItem, MenuTrigger } from "@ui-sdk/react/menu";
import { ArrowRight, Cpu, Download, Plus, Settings, Star, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CodeButton } from "@/components/ui/code-button";
import { IconButton } from "@/components/ui/icon-button";
import { IconToggle } from "@/components/ui/icon-toggle";
import { MenuButton } from "@/components/ui/menu-button";
import { Cell, Grid, Specimen, type GalleryMeta } from "./_kit";

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
  const [starred, setStarred] = useState(false);
  return (
    <>
      <Specimen
        label="Button · style × size"
        note="Medium is 36 px high, small 28 px; radius 8, 18 px side padding, label 14/600. Secondary sits on the page background with a 1 px field border; destructive has a 1.5 px red border on the panel."
      >
        {variants.map(([variant, label]) => (
          <Cell key={variant} label={`${variant} · md`}>
            <Button variant={variant} pendingAnnouncement="Working">
              {label}
            </Button>
          </Cell>
        ))}
        {variants.map(([variant, label]) => (
          <Cell key={variant} label={`${variant} · sm`}>
            <Button variant={variant} size="sm" pendingAnnouncement="Working">
              {label}
            </Button>
          </Cell>
        ))}
        <Cell label="with icon">
          <Button pendingAnnouncement="Working">
            Get started
            <ArrowRight aria-hidden="true" />
          </Button>
        </Cell>
      </Specimen>
      <Specimen
        label="Button · states"
        note="Hover and focus are forced for the preview; the pending button is live (press it): cursor wait, a small spinner, no opacity change. Disabled shows not-allowed."
      >
        {variants.map(([variant, label]) => (
          <div key={variant} className="flex flex-col gap-3">
            <Cell label={`${variant} · hover`}>
              <Button variant={variant} data-force-hover="" pendingAnnouncement="Working">
                {label}
              </Button>
            </Cell>
            <Cell label={`${variant} · focus`}>
              <Button variant={variant} data-force-focus="" pendingAnnouncement="Working">
                {label}
              </Button>
            </Cell>
            <Cell label={`${variant} · disabled`}>
              <Button variant={variant} disabled pendingAnnouncement="Working">
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
        <Specimen label="Icon button · states" note="32 × 32, radius 6, icon 18 with a 1.75 stroke; hover fills with the surface and keeps the icon colour; field border when bordered; focus ring offset 1.">
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
              <Cell label="disabled">
                <IconButton aria-label="Settings" bordered={bordered} disabled>
                  <Settings aria-hidden="true" />
                </IconButton>
              </Cell>
            </div>
          ))}
        </Specimen>
        <Specimen label="Icon toggle · states" note="Same box on the Toggle primitive: pressed is data-pressed (soft selection). Pressed also gets a 2 px Highlight border in forced colors.">
          {([false, true] as const).map((bordered) => (
            <div key={String(bordered)} className="flex gap-3">
              <Cell label={bordered ? "bordered off" : "plain off"}>
                <IconToggle aria-label="Star" bordered={bordered}>
                  <Star aria-hidden="true" />
                </IconToggle>
              </Cell>
              <Cell label="pressed">
                <IconToggle aria-label="Star" bordered={bordered} defaultPressed>
                  <Star aria-hidden="true" />
                </IconToggle>
              </Cell>
              <Cell label="disabled pressed">
                <IconToggle aria-label="Star" bordered={bordered} defaultPressed disabled>
                  <Star aria-hidden="true" />
                </IconToggle>
              </Cell>
              <Cell label="controlled">
                <IconToggle aria-label="Star" bordered={bordered} pressed={starred} onPressedChange={setStarred}>
                  <Star aria-hidden="true" />
                </IconToggle>
              </Cell>
            </div>
          ))}
        </Specimen>
        <Specimen label="Icon button · sizes" note="md 32, sm 28 (icon 16), xs 24 (icon 14).">
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
        <Specimen
          label="Menu button · trigger"
          note="28 high, radius 6, 10 / 8 padding, label 13/600. Open is data-open or aria-expanded on the element: 1.5 px select border on soft selection, chevron up. The live one is a real MenuTrigger."
        >
          <Cell label="closed">
            <MenuButton icon={<Cpu />}>WASM · GPU</MenuButton>
          </Cell>
          <Cell label="open">
            <MenuButton icon={<Cpu />} aria-expanded data-open="">
              WASM · GPU
            </MenuButton>
          </Cell>
          <Cell label="no icon">
            <MenuButton>Renderer</MenuButton>
          </Cell>
          <Cell label="hover">
            <MenuButton icon={<Cpu />} data-force-hover="">
              WASM · GPU
            </MenuButton>
          </Cell>
          <Cell label="focus">
            <MenuButton icon={<Cpu />} data-force-focus="">
              WASM · GPU
            </MenuButton>
          </Cell>
          <Cell label="disabled">
            <MenuButton icon={<Cpu />} disabled>
              WASM · GPU
            </MenuButton>
          </Cell>
          <Cell label="live">
            <Menu>
              <MenuTrigger render={<MenuButton icon={<Cpu />} />}>WASM · GPU</MenuTrigger>
              <MenuContent className="rounded-lg border border-line bg-popover p-1 text-sm text-fg shadow-popover">
                <MenuItem value="wasm" className="rounded-md px-2 py-1 data-highlighted:bg-surface">
                  WASM · GPU
                </MenuItem>
                <MenuItem value="dom" className="rounded-md px-2 py-1 data-highlighted:bg-surface">
                  DOM
                </MenuItem>
              </MenuContent>
            </Menu>
          </Cell>
        </Specimen>
        <Specimen label="Code button" note="32 high, radius 8, 12 px padding, label 13/600. Open (aria-expanded, with aria-controls) is the soft selection with a 1.5 px select border; the label takes the soft ink.">
          <Cell label="closed">
            <CodeButton>Code</CodeButton>
          </Cell>
          <Cell label="open">
            <CodeButton open controls="code-panel">
              Hide code
            </CodeButton>
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
            <CodeButton open={codeOpen} controls="code-panel" onClick={() => setCodeOpen((o) => !o)}>
              {codeOpen ? "Hide code" : "Code"}
            </CodeButton>
          </Cell>
        </Specimen>
      </Grid>
    </>
  );
}
