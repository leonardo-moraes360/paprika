import { Component, Frame, Globe, Image, Network, Plus, Square, Star, Type } from "lucide-react";
import { useState } from "react";
import { AgentsTrigger } from "@/components/ui/agents-trigger";
import { AgentStack } from "@/components/ui/agent-stack";
import { Avatar } from "@/components/ui/avatar";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { IconButton } from "@/components/ui/icon-button";
import { LayerRow, LayerTree } from "@/components/ui/layer-row";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu";
import { NavItem } from "@/components/ui/nav-item";
import { PageItem } from "@/components/ui/page-item";
import { Popover } from "@/components/ui/popover";
import { Profile } from "@/components/ui/profile";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SectionHeader } from "@/components/ui/section-header";
import { Cell, Grid, Specimen, type GalleryMeta } from "./_kit";

export const meta: GalleryMeta = { title: "Navigation", order: 200 };

const noop = () => undefined;
const layerLabels = { hideLabel: "Hide layer", lockLabel: "Lock layer" };
type LayerNode = { value: string; name: string; icon: React.ReactNode; children?: LayerNode[] };
const layerNodes: LayerNode[] = [
  {
    value: "navigation",
    name: "Navigation",
    icon: <Component />,
    children: [
      { value: "logo", name: "Logo", icon: <Image /> },
      { value: "links", name: "Links", icon: <Type /> },
    ],
  },
  { value: "content", name: "Content", icon: <Frame /> },
];
const photo = `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 56 56"><rect width="56" height="56" fill="#E23B2E"/><circle cx="28" cy="22" r="10" fill="#FBF4E6"/><rect x="10" y="38" width="36" height="18" rx="9" fill="#FBF4E6"/></svg>')}`;
const pageLabels = { renameLabel: "Page name", deleteLabel: "Delete page" };

function PanelMock({ children }: { children: React.ReactNode }) {
  return <div className="w-60 rounded-lg bg-panel py-1">{children}</div>;
}

export default function NavigationSection() {
  const [pagesOpen, setPagesOpen] = useState(true);
  const [active, setActive] = useState("cover");
  const [renaming, setRenaming] = useState(false);
  const [layer, setLayer] = useState<string | null>("navigation");
  const [openLayers, setOpenLayers] = useState<string[]>(["navigation"]);
  const [hiddenLayers, setHiddenLayers] = useState<string[]>([]);
  const [lockedLayers, setLockedLayers] = useState<string[]>([]);
  const [navExpanded, setNavExpanded] = useState(true);
  return (
    <>
      <Grid>
        <Specimen
          label="Section header"
          note="36 px high, 10 px left and 8 px right padding, 6 px gap. Panel style: 12/700 muted label in capitals, tracking 0.8. Inspector style: 13/600 ink, muted when closed. 14 px chevron; actions arrive by slot (24 px icon buttons). Click or Enter/Space toggles. Without content the header is plain text (no toggle); headingLevel wraps the trigger in a heading."
          className="items-start"
        >
          <PanelMock>
            <SectionHeader
              title="PAGES"
              open={pagesOpen}
              onOpenChange={setPagesOpen}
              actions={
                <IconButton size="xs" aria-label="New page">
                  <Plus aria-hidden="true" />
                </IconButton>
              }
            >
              <div className="px-2 pb-1 text-xs text-muted">Panel content</div>
            </SectionHeader>
          </PanelMock>
          <PanelMock>
            <SectionHeader title="Position and size" variant="inspector" defaultOpen>
              <div className="px-2.5 pb-1 text-xs text-muted">Inspector content</div>
            </SectionHeader>
            <SectionHeader title="Effects" variant="inspector" defaultOpen={false}>
              <div className="px-2.5 pb-1 text-xs text-muted">Effects content</div>
            </SectionHeader>
          </PanelMock>
          <PanelMock>
            <SectionHeader title="LAYERS" defaultOpen={false}>
              <div className="px-2 pb-1 text-xs text-muted">Layers content</div>
            </SectionHeader>
          </PanelMock>
          <PanelMock>
            <SectionHeader title="Static title" variant="inspector" headingLevel={3} />
          </PanelMock>
        </Specimen>
        <Specimen
          label="Scroll area"
          note="Native scrolling with a 6 px vertical bar: line track, field thumb, radius 3. Visible while the content overflows (type auto); the viewport is a named region and takes the focus ring from the keyboard."
        >
          <Cell label="overflowing list">
            <ScrollArea label="Layers list" className="h-40 w-52 rounded-lg bg-panel" viewportClassName="pr-2 pl-2">
              {Array.from({ length: 14 }, (_, i) => (
                <div key={i} className="flex h-7 items-center text-sm text-fg">
                  Layer {i + 1}
                </div>
              ))}
            </ScrollArea>
          </Cell>
          <Cell label="fits (no bar)">
            <ScrollArea label="Short list" className="h-40 w-52 rounded-lg bg-panel" viewportClassName="pr-2 pl-2">
              <div className="flex h-7 items-center text-sm text-fg">Only one</div>
            </ScrollArea>
          </Cell>
        </Specimen>
        <Specimen
          label="Page item"
          note="28 px high, radius 6, 12 px left and 8 px right padding, 8 px gap. Hover fills the surface; active adds the 3 × 16 red bar at the left edge, the surface fill, ink icon and 13/600 name. Renaming swaps the name for a 22 px field with a 1.5 px select border (Enter commits, Escape cancels). Delete shows on hover or focus."
          className="items-start"
        >
          <Cell label="normal">
            <div className="w-60 rounded-lg bg-panel p-1">
              <PageItem name="Editor" onSelect={noop} onDelete={noop} {...pageLabels} />
            </div>
          </Cell>
          <Cell label="hover">
            <div className="w-60 rounded-lg bg-panel p-1">
              <PageItem name="Editor" data-force-hover="" onSelect={noop} onDelete={noop} {...pageLabels} />
            </div>
          </Cell>
          <Cell label="active, with agents">
            <div className="w-60 rounded-lg bg-panel p-1">
              <PageItem name="Cover" active agents={<AgentStack count={2} label="2 agents" />} onSelect={noop} onDelete={noop} {...pageLabels} />
            </div>
          </Cell>
          <Cell label="many agents">
            <div className="w-60 rounded-lg bg-panel p-1">
              <PageItem name="Overview and states" agents={<AgentStack count={6} label="6 agents" />} {...pageLabels} />
            </div>
          </Cell>
          <Cell label="renaming">
            <div className="w-60 rounded-lg bg-panel p-1">
              <PageItem name="Cover" renaming {...pageLabels} onRename={noop} onRenameCancel={noop} />
            </div>
          </Cell>
          <Cell label="live (select, rename on double state)">
            <div className="w-60 rounded-lg bg-panel p-1">
              {(
                [
                  ["cover", "Cover"],
                  ["editor", "Editor"],
                  ["components", "Components"],
                ] as const
              ).map(([id, name]) => (
                <PageItem
                  key={id}
                  name={name}
                  active={active === id}
                  renaming={renaming && active === id}
                  onSelect={() => (active === id ? setRenaming(true) : setActive(id))}
                  onRename={() => setRenaming(false)}
                  onRenameCancel={() => setRenaming(false)}
                  onDelete={noop}
                  {...pageLabels}
                />
              ))}
            </div>
          </Cell>
        </Specimen>
        <Specimen
          label="Layer row"
          note="A real tree (@ui-sdk/react/tree): one Tab stop for the whole list, arrows move and expand, aria-selected on the selected row, aria-level and posinset from the tree. 28 px high, radius 6, 8 px left and 6 px right padding, 20 px indent per level, 14 px chevron and type icon, 13 name. Selected: soft selection fill and 13/600 soft ink; hidden: muted name with the closed eye always shown; locked: red lock always shown. Eye and lock are 24 px targets outside the Tab order: click them, or press Ctrl/Cmd+Shift+H and Ctrl/Cmd+Shift+L on the focused row."
          className="items-start"
        >
          <Cell label="normal, open">
            <div className="w-60 rounded-lg bg-panel p-1">
              <LayerTree aria-label="Layers, normal" defaultExpanded={["home"]}>
                <LayerRow value="home" name="Home" icon={<Frame />} {...layerLabels}>
                  <LayerRow value="button" name="Button" icon={<Square />} {...layerLabels} />
                </LayerRow>
              </LayerTree>
            </div>
          </Cell>
          <Cell label="hover">
            <div className="w-60 rounded-lg bg-panel p-1">
              <LayerTree aria-label="Layers, hover">
                <LayerRow value="button" name="Button" icon={<Square />} data-force-hover="" {...layerLabels} />
              </LayerTree>
            </div>
          </Cell>
          <Cell label="selected">
            <div className="w-60 rounded-lg bg-panel p-1">
              <LayerTree aria-label="Layers, selected" defaultValue="home" defaultExpanded={["home"]}>
                <LayerRow value="home" name="Home" icon={<Frame />} {...layerLabels}>
                  <LayerRow value="button" name="Button" icon={<Square />} {...layerLabels} />
                </LayerRow>
              </LayerTree>
            </div>
          </Cell>
          <Cell label="hidden">
            <div className="w-60 rounded-lg bg-panel p-1">
              <LayerTree aria-label="Layers, hidden">
                <LayerRow value="caption" name="Caption" icon={<Type />} visible={false} {...layerLabels} />
              </LayerTree>
            </div>
          </Cell>
          <Cell label="hidden and selected">
            <div className="w-60 rounded-lg bg-panel p-1">
              <LayerTree aria-label="Layers, hidden and selected" defaultValue="caption">
                <LayerRow value="caption" name="Caption" icon={<Type />} visible={false} {...layerLabels} />
              </LayerTree>
            </div>
          </Cell>
          <Cell label="locked">
            <div className="w-60 rounded-lg bg-panel p-1">
              <LayerTree aria-label="Layers, locked">
                <LayerRow value="footer" name="Footer" icon={<Frame />} locked {...layerLabels}>
                  <LayerRow value="legal" name="Legal" icon={<Type />} {...layerLabels} />
                </LayerRow>
              </LayerTree>
            </div>
          </Cell>
          <Cell label="depth 3, image">
            <div className="w-60 rounded-lg bg-panel p-1">
              <LayerTree aria-label="Layers, depth" defaultExpanded={["page", "hero"]}>
                <LayerRow value="page" name="Page" icon={<Frame />} {...layerLabels}>
                  <LayerRow value="hero" name="Hero" icon={<Frame />} {...layerLabels}>
                    <LayerRow value="illustration" name="Illustration" icon={<Image />} {...layerLabels} />
                  </LayerRow>
                </LayerRow>
              </LayerTree>
            </div>
          </Cell>
          <Cell label="live (controlled)">
            <div className="w-60 rounded-lg bg-panel p-1">
              <LayerTree aria-label="Layers, live" value={layer} onValueChange={setLayer} expanded={openLayers} onExpandedChange={setOpenLayers}>
                {layerNodes.map((node) => (
                  <LayerRow
                    key={node.value}
                    value={node.value}
                    name={node.name}
                    icon={node.icon}
                    visible={!hiddenLayers.includes(node.value)}
                    locked={lockedLayers.includes(node.value)}
                    onVisibleChange={(next) => setHiddenLayers((list) => (next ? list.filter((v) => v !== node.value) : [...list, node.value]))}
                    onLockedChange={(next) => setLockedLayers((list) => (next ? [...list, node.value] : list.filter((v) => v !== node.value)))}
                    {...layerLabels}
                  >
                    {node.children?.map((child) => (
                      <LayerRow
                        key={child.value}
                        value={child.value}
                        name={child.name}
                        icon={child.icon}
                        visible={!hiddenLayers.includes(child.value)}
                        locked={lockedLayers.includes(child.value)}
                        onVisibleChange={(next) => setHiddenLayers((list) => (next ? list.filter((v) => v !== child.value) : [...list, child.value]))}
                        onLockedChange={(next) => setLockedLayers((list) => (next ? [...list, child.value] : list.filter((v) => v !== child.value)))}
                        {...layerLabels}
                      />
                    ))}
                  </LayerRow>
                ))}
              </LayerTree>
            </div>
          </Cell>
        </Specimen>
        <Specimen label="Breadcrumb" note="24 px high, 13 text, 6 px gap, 14 px chevron separators. The last item is the current page in ink and 600; an item takes href, onSelect (receives the click event) or render, an element the app clones as its link (a router Link, so navigation does not reload); the ones before it are muted 500 links. One to three levels shown; any number works." className="flex-col items-start">
          <Cell label="3 levels">
            <Breadcrumb
              label="Location"
              items={[
                { label: "North Studio", href: "#navigation" },
                { label: "App · new interface", href: "#navigation" },
                { label: "Cover" },
              ]}
            />
          </Cell>
          <Cell label="2 levels">
            <Breadcrumb label="Location, two levels" items={[{ label: "Projects", onSelect: noop }, { label: "North Studio" }]} />
          </Cell>
          <Cell label="render (client-side link)">
            <Breadcrumb
              label="Location, router link"
              items={[
                { label: "Projects", render: <a href="#navigation" onClick={(event) => event.preventDefault()} /> },
                { label: "North Studio" },
              ]}
            />
          </Cell>
          <Cell label="1 level">
            <Breadcrumb label="Location, one level" items={[{ label: "Projects" }]} />
          </Cell>
        </Specimen>
        <Specimen
          label="Nav item"
          note="32 px high, radius 6, 10 px left and 8 px right padding, 8 px gap, 16 px icon. Hover fills the surface; active adds the red bar (3 × 16 at y = 8), the surface fill and a 13/600 label. Level 1 indents 22 px; the chevron marks expandable projects; trailing text is a count or the muted “soon” note."
          className="items-start"
        >
          <Cell label="normal">
            <div className="w-60 rounded-lg bg-panel p-1">
              <NavItem label="Recent" icon={<Star />} />
            </div>
          </Cell>
          <Cell label="hover">
            <div className="w-60 rounded-lg bg-panel p-1">
              <NavItem label="Recent" icon={<Star />} data-force-hover="" />
            </div>
          </Cell>
          <Cell label="active, count">
            <div className="w-60 rounded-lg bg-panel p-1">
              <NavItem label="Favorites" icon={<Star />} active trailing="3" />
            </div>
          </Cell>
          <Cell label="level 1">
            <div className="w-60 rounded-lg bg-panel p-1">
              <NavItem label="App · new interface" icon={<Frame />} level={1} />
            </div>
          </Cell>
          <Cell label="soon">
            <div className="w-60 rounded-lg bg-panel p-1">
              <NavItem label="Explore" icon={<Globe />} trailing="soon" />
              <NavItem label="Federations (F2P)" icon={<Network />} trailing="soon" />
            </div>
          </Cell>
          <Cell label="live (expandable)">
            <div className="w-60 rounded-lg bg-panel p-1">
              <NavItem label="North Studio" icon={<Frame />} trailing="4" expanded={navExpanded} onClick={() => setNavExpanded((v) => !v)} />
            </div>
          </Cell>
        </Specimen>
        <Specimen label="Avatar" note="28 px circle, initials 12/700 in the agent ink on the agent fill (the profile uses the select pill pair). Large is 56 px with 24 initials. Falls back to the initials when the image is missing; the full name is read by screen readers, from the photo alt text or the hidden label. Without a label the avatar is hidden from them." className="items-end">
          <Cell label="select pill">
            <Avatar initials="LM" label="Leonardo M." tone="select-pill" />
          </Cell>
          <Cell label="agent 1">
            <Avatar initials="CL" label="Claude" tone="agent-1" />
          </Cell>
          <Cell label="agent 2">
            <Avatar initials="CX" label="Codex" tone="agent-2" />
          </Cell>
          <Cell label="agent 3">
            <Avatar initials="CU" label="Cursor" tone="agent-3" />
          </Cell>
          <Cell label="agent 4">
            <Avatar initials="GE" label="Gemini" tone="agent-4" />
          </Cell>
          <Cell label="large">
            <Avatar initials="LM" label="Leonardo M." tone="select-pill" size="lg" />
          </Cell>
          <Cell label="with photo">
            <Avatar initials="AM" label="Ana M." src={photo} tone="agent-3" />
          </Cell>
          <Cell label="decorative (no label)">
            <Avatar initials="LM" tone="select-pill" />
          </Cell>
        </Specimen>
        <Specimen label="Agent stack" note="50 × 16 box with 14 px dots overlapping every 9 px, a 1.5 px panel ring, each in its agent colour, the first on top. Above five agents it becomes a 50 × 16 pill with the bot icon and the total." className="items-end">
          {[1, 2, 3, 4, 5, 8].map((count) => (
            <Cell key={count} label={count > 5 ? `${count} (many)` : String(count)}>
              <AgentStack count={count} label={`${count} agents`} />
            </Cell>
          ))}
        </Specimen>
        <Specimen label="Agents trigger" note="28 px pill on the surface, 8 px gap, the stack, a 13/600 label and a 14 px chevron. Open (popover) is the soft selection with a 1.5 px select border. Live: opens the agents popover.">
          <Cell label="closed">
            <AgentsTrigger stack={<AgentStack count={3} />} label="3 active" />
          </Cell>
          <Cell label="open">
            <AgentsTrigger data-open="" aria-expanded stack={<AgentStack count={3} />} label="3 active" />
          </Cell>
          <Cell label="hover">
            <AgentsTrigger data-force-hover="" stack={<AgentStack count={3} />} label="3 active" />
          </Cell>
          <Cell label="focus">
            <AgentsTrigger data-force-focus="" stack={<AgentStack count={3} />} label="3 active" />
          </Cell>
          <Cell label="live">
            <Popover trigger={<AgentsTrigger stack={<AgentStack count={3} />} label="3 active" />}>
              Agents in the workspace
            </Popover>
          </Cell>
        </Specimen>
        <Specimen label="Profile" note="48 px high, radius 8, 8 px left and 10 px right padding, 10 px gap: avatar, name 13/600 over detail 12 muted, 16 px up-down chevron. Open (menu) fills the surface." className="items-start">
          <Cell label="normal">
            <div className="w-60">
              <Profile name="Leonardo" detail="North Studio" avatar={<Avatar initials="LM" tone="select-pill" />} />
            </div>
          </Cell>
          <Cell label="open">
            <div className="w-60">
              <Profile name="Leonardo" detail="North Studio" data-open="" aria-expanded avatar={<Avatar initials="LM" tone="select-pill" />} />
            </div>
          </Cell>
          <Cell label="focus">
            <div className="w-60">
              <Profile name="Leonardo" detail="North Studio" data-force-focus="" avatar={<Avatar initials="LM" tone="select-pill" />} />
            </div>
          </Cell>
          <Cell label="live">
            <div className="w-60">
              <Menu pendingAnnouncement="Working">
                <MenuTrigger render={<Profile name="Leonardo" detail="North Studio" avatar={<Avatar initials="LM" tone="select-pill" />} />} />
                <MenuContent>
                  <MenuItem value="profile">Profile</MenuItem>
                  <MenuItem value="settings">Settings</MenuItem>
                </MenuContent>
              </Menu>
            </div>
          </Cell>
        </Specimen>
      </Grid>
    </>
  );
}
