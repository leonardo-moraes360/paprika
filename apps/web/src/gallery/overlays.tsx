import { Layers, SlidersHorizontal } from "lucide-react";
import { useState, type ReactNode } from "react";
import { AlertDialog } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { MenuButton } from "@/components/ui/menu-button";
import { TextField } from "@/components/ui/text-field";
import { PanelHandle } from "@/components/ui/panel-handle";
import { Popover, PopoverClose } from "@/components/ui/popover";
import type { Status } from "@/components/ui/status-icon";
import { ToastShell } from "@/components/ui/toast";
import { Tooltip, TooltipBubble } from "@/components/ui/tooltip";
import { Undo2, X } from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";
import { dismissToasts, showStatusToast, showUndoToast } from "@/lib/notify";
import { Cell, Grid, Specimen, type GalleryMeta } from "./_kit";
import { StatusToastSpecimen } from "./_toast-static";

export const meta: GalleryMeta = { title: "Overlays", order: 300 };

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const alerts: ReadonlyArray<{ status: Status; trigger: string; title: string; body: string; confirm: string }> = [
  { status: "danger", trigger: "Danger", title: "Delete workspace?", body: "This action cannot be undone.", confirm: "Delete" },
  { status: "warning", trigger: "Warning", title: "Leave without saving?", body: "Your last changes are only on this device.", confirm: "Leave" },
  { status: "info", trigger: "Info", title: "Update available", body: "Reload to use the new version.", confirm: "Reload" },
  { status: "success", trigger: "Success", title: "Workspace shared", body: "Everyone on the team can open it now.", confirm: "Done" },
];

const statuses: ReadonlyArray<{ status: Status; title: string; description?: string; action?: string }> = [
  { status: "success", title: "Workspace exported", description: "The file was saved to Downloads.", action: "Open folder" },
  { status: "info", title: "codex joined the workspace" },
  { status: "warning", title: "Unstable connection", description: "Changes stay saved here and sync when the connection returns." },
  { status: "danger", title: "Could not save", description: "The server did not respond.", action: "Try again" },
];

function PanelMock({ side, open, onToggle, children }: { side: "left" | "right"; open: boolean; onToggle: () => void; children?: ReactNode }) {
  const Icon = side === "left" ? Layers : SlidersHorizontal;
  const label = open ? `Hide ${side === "left" ? "layers" : "properties"} panel` : `Show ${side === "left" ? "layers" : "properties"} panel`;
  const id = `mock-panel-${side}`;
  return (
    <div className="relative flex h-40 w-full items-center overflow-hidden rounded-lg border border-line bg-canvas">
      <div className={side === "right" ? "absolute inset-y-0 right-0 flex items-center" : "absolute inset-y-0 left-0 flex items-center"}>
        {side === "right" ? (
          <Tooltip content={label} side="left" type="label">
            <PanelHandle side={side} aria-label={label} expanded={open} controls={id} icon={<Icon />} onClick={onToggle} />
          </Tooltip>
        ) : null}
        <div id={id} hidden={!open} className="h-full w-24 border-line bg-panel p-2 text-xs text-muted data-[side=left]:border-r data-[side=right]:border-l" data-side={side}>
          {children}
        </div>
        {side === "left" ? (
          <Tooltip content={label} side="right" type="label">
            <PanelHandle side={side} aria-label={label} expanded={open} controls={id} icon={<Icon />} onClick={onToggle} />
          </Tooltip>
        ) : null}
      </div>
    </div>
  );
}

export default function OverlaysSection() {
  const [openAlert, setOpenAlert] = useState(false);
  const [left, setLeft] = useState(true);
  const [right, setRight] = useState(false);
  const [count, setCount] = useState(0);
  return (
    <>
      <Specimen
        label="Alert dialog · status × live"
        note="440 wide, radius 14, padding 24, gap 16; 36 px status circle on the soft tone, title 17/700, body 14/1.5 muted. Danger confirms with the destructive Button, the other statuses with the primary. Cancel is the first answer in focus order and takes the initial focus, so an accidental Enter never confirms; it is required for danger and optional for the other statuses. Tab stays inside, Escape closes and returns focus to the trigger; the backdrop does not close it."
      >
        {alerts.map((a) => (
          <Cell key={a.status} label={a.status}>
            <AlertDialog
              status={a.status}
              title={a.title}
              description={a.body}
              confirmLabel={a.confirm}
              cancelLabel="Cancel"
              pendingAnnouncement="Working"
              trigger={<Button variant="secondary" pendingAnnouncement="Working">{a.trigger}</Button>}
            />
          </Cell>
        ))}
        <Cell label="no cancel (info)">
          <AlertDialog
            status="info"
            title="Update available"
            description="The only answer is to continue."
            confirmLabel="Reload"
            pendingAnnouncement="Working"
            trigger={<Button variant="secondary" pendingAnnouncement="Working">No cancel</Button>}
          />
        </Cell>
        <Cell label="slot + extra action">
          <AlertDialog
            status="danger"
            title="Delete workspace?"
            description="This action cannot be undone."
            confirmLabel="Delete"
            cancelLabel="Cancel"
            extra={<Button variant="secondary" pendingAnnouncement="Working">Export first</Button>}
            pendingAnnouncement="Working"
            trigger={<Button variant="secondary" pendingAnnouncement="Working">Slot + extra</Button>}
          >
            <p className="text-sm text-muted">Optional content slot: 12 pages and 3 libraries go with it.</p>
          </AlertDialog>
        </Cell>
        <Cell label="async confirm (pending)">
          <AlertDialog
            open={openAlert}
            onOpenChange={setOpenAlert}
            status="warning"
            title="Publish changes?"
            description="The confirm button waits for the promise."
            confirmLabel="Publish"
            cancelLabel="Cancel"
            onConfirm={() => wait(1500)}
            pendingAnnouncement="Publishing"
            trigger={<Button variant="secondary" pendingAnnouncement="Working">Async confirm</Button>}
          />
        </Cell>
      </Specimen>
      <Grid>
        <Specimen label="Dialog · simple" note="The alert surface without a status: title and description at the top, a close icon button, free content, footer actions on the right. The close button is last in the DOM so the first field takes the initial focus; contentProps takes initialFocus and finalFocus. Escape and the backdrop close it.">
          <Dialog
            title="Share workspace"
            description="Anyone on the team can open it."
            closeLabel="Close"
            pendingAnnouncement="Working"
            trigger={<Button variant="secondary" pendingAnnouncement="Working">Open dialog</Button>}
            footer={<Button pendingAnnouncement="Working">Done</Button>}
          >
            <TextField label="Email" type="email" placeholder="name@studio.com" />
          </Dialog>
        </Specimen>
        <Specimen label="Popover · surface" note="Radius 12, padding 16, gap 12, popover fill, line border, popover shadow. Opens under the trigger; Escape or a press outside closes it and focus returns to the trigger.">
          <Popover
            trigger={<MenuButton>Agents</MenuButton>}
            title="Active agents"
            description="Three agents are connected."
          >
            <div className="flex justify-end">
              <PopoverClose render={<Button size="sm" variant="secondary" pendingAnnouncement="Working" />}>Close</PopoverClose>
            </div>
          </Popover>
        </Specimen>
      </Grid>
      <Specimen
        label="Tooltip · live and static"
        note="Ink fill, bg text, 12/500, padding 6 / 10, radius 6; arrow 6 × 12 on the sides and 12 × 6 above and below. Opens 400 ms after hover and at once on keyboard focus; the arrow tip sits 4 px from the trigger (offset 10 with an arrow). Pass type=label (a prop) when the content repeats the trigger name, so it is not also read as a description. Static bubbles below show each arrow side and no arrow."
      >
        {(["top", "right", "bottom", "left"] as const).map((side) => (
          <Cell key={side} label={`live · ${side}`}>
            <Tooltip content="Show layers panel" side={side}>
              <Button variant="secondary" pendingAnnouncement="Working">{side}</Button>
            </Tooltip>
          </Cell>
        ))}
        <Cell label="no arrow">
          <Tooltip content="Show layers panel" arrow={false}>
            <Button variant="secondary" pendingAnnouncement="Working">No arrow</Button>
          </Tooltip>
        </Cell>
        <Cell label="static · arrow left">
          <TooltipBubble side="right">Show layers panel</TooltipBubble>
        </Cell>
        <Cell label="static · arrow right">
          <TooltipBubble side="left">Hide properties panel</TooltipBubble>
        </Cell>
        <Cell label="static · arrow top">
          <TooltipBubble side="bottom">Show layers panel</TooltipBubble>
        </Cell>
        <Cell label="static · arrow bottom">
          <TooltipBubble side="top">Show layers panel</TooltipBubble>
        </Cell>
        <Cell label="static · no arrow">
          <TooltipBubble arrow={false}>Show layers panel</TooltipBubble>
        </Cell>
      </Specimen>
      <Specimen
        label="Panel handle · states"
        note="28 × 56 half circle (radius 28 on the canvas side), panel fill, line border, 0 4 12 shadow; icon 16 muted. Hover: surface fill, field border, ink icon. Focus: 2 px select outline, offset 2. It is a button with aria-expanded and aria-controls; the live ones toggle a mock panel and carry a tooltip."
      >
        {(["left", "right"] as const).flatMap((side) => {
          const Icon = side === "left" ? Layers : SlidersHorizontal;
          return [
            <Cell key={`${side}-n`} label={`${side} · normal`}>
              <PanelHandle side={side} aria-label="Show panel" expanded={false} controls="none" icon={<Icon />} />
            </Cell>,
            <Cell key={`${side}-h`} label={`${side} · hover`}>
              <PanelHandle side={side} aria-label="Show panel" expanded={false} controls="none" icon={<Icon />} data-force-hover="" />
            </Cell>,
            <Cell key={`${side}-f`} label={`${side} · focus`}>
              <PanelHandle side={side} aria-label="Show panel" expanded={false} controls="none" icon={<Icon />} data-force-focus="" />
            </Cell>,
          ];
        })}
        <Cell label="disabled">
          <PanelHandle side="left" aria-label="Show panel" expanded={false} controls="none" icon={<Layers />} disabled />
        </Cell>
        <div className="grid w-full gap-3 md:grid-cols-2">
          <PanelMock side="left" open={left} onToggle={() => setLeft((o) => !o)}>Layers</PanelMock>
          <PanelMock side="right" open={right} onToggle={() => setRight((o) => !o)}>Properties</PanelMock>
        </div>
      </Specimen>
      <Specimen
        label="Toast · status (static)"
        note="360 wide, radius 10, popover fill, line border, 28 px status circle, title 13/600, description 12 muted, action is the small secondary Button, close is the 24 px icon button; the optional time bar is 3 px in the status colour. Specimen only: no role and no live announcement, the real ones come from the region below."
      >
        <div className="flex w-full flex-wrap gap-4">
          {statuses.map((s) => (
            <div key={s.status} className="flex w-90 max-w-full flex-col gap-1.5">
              <StatusToastSpecimen
                status={s.status}
                title={s.title}
                description={s.description}
                actionLabel={s.action}
                closeLabel="Close"
                progress={s.status === "success" || s.status === "info" ? 0.6 : undefined}
              />
              <span className="text-xs text-muted">{s.status}{s.action ? " · action" : ""}{s.status === "success" || s.status === "info" ? " · time bar" : ""}</span>
            </div>
          ))}
          <div className="flex w-90 max-w-full flex-col gap-1.5">
            <ToastShell
              kind="undo"
              leading={
                <span aria-hidden="true" className="mt-0.5 inline-flex h-5 w-[18px] shrink-0 items-center justify-center text-fg [&_svg]:size-[18px]">
                  <Undo2 />
                </span>
              }
              title="Undone: Change Button colour"
              actions={
                <>
                  <Button variant="secondary" size="sm" pendingAnnouncement="Working">Redo</Button>
                  <span className="flex gap-1"><Kbd>Ctrl</Kbd><Kbd>Y</Kbd></span>
                </>
              }
              close={<IconButton aria-label="Close" size="xs"><X aria-hidden="true" /></IconButton>}
            />
            <span className="text-xs text-muted">undo toast · action + shortcut (padding 12 / 8 / 12 / 14, gap 10, title 13/400)</span>
          </div>
        </div>
      </Specimen>
      <Specimen
        label="Toast · live region"
        note="The queue is the app toaster in lib/notify.ts, rendered by the single region the root mounts. At most 3 are visible and the 4th waits; success and info last 5 s, 8 s with an action, danger stays until closed and a new danger replaces the previous one (one persistent danger at most, so it never starves the queue). Hover or focus pauses the timers and expands the stack; F6 moves focus to the newest toast and Escape closes it."
      >
        {statuses.map((s) => (
          <Cell key={s.status} label={s.status}>
            <Button
              variant="secondary"
              pendingAnnouncement="Working"
              onClick={() =>
                showStatusToast({
                  status: s.status,
                  title: s.title,
                  description: s.description,
                  action: s.action ? { label: s.action, onAction: () => undefined } : undefined,
                  timeBar: s.status === "success" || s.status === "info",
                })
              }
            >
              {s.status}
            </Button>
          </Cell>
        ))}
        <Cell label="stack of five">
          <Button
            variant="secondary"
            pendingAnnouncement="Working"
            onClick={() => {
              for (let i = 0; i < 5; i++) showStatusToast({ status: "info", title: `Notification ${count + i + 1}`, timeBar: true });
              setCount((c) => c + 5);
            }}
          >
            Fire five
          </Button>
        </Cell>
        <Cell label="three dangers + success">
          <Button
            variant="secondary"
            onClick={() => {
              for (let i = 1; i <= 3; i++) showStatusToast({ status: "danger", title: `Error ${i}`, id: `error-${i}` });
              showStatusToast({ status: "success", title: "Saved", timeBar: true });
            }}
          >
            3 dangers + 1
          </Button>
        </Cell>
        <Cell label="undo toast">
          <Button
            variant="secondary"
            pendingAnnouncement="Working"
            onClick={() =>
              showUndoToast({
                title: "Undone: Change Button colour",
                action: { label: "Redo" },
                shortcut: (
                  <span className="flex gap-1">
                    <Kbd>Ctrl</Kbd>
                    <Kbd>Y</Kbd>
                  </span>
                ),
              })
            }
          >
            Undo toast
          </Button>
        </Cell>
        <Cell label="dismiss all">
          <Button variant="ghost" pendingAnnouncement="Working" onClick={dismissToasts}>
            Dismiss all
          </Button>
        </Cell>
      </Specimen>
    </>
  );
}
