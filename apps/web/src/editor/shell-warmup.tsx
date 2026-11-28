import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu";
import { Popover } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip } from "@/components/ui/tooltip";

/**
 * The UI SDK does part of its first-use work (the `ui-sdk-hidden` and `ui-sdk-popover-reset` style sheets, a scroll
 * area's first measure) when the first part of each kind mounts, and each of those invalidates the style of the whole
 * document. In the editor that happened together with the nodes, after 5 000 of them were in the DOM. The opening
 * state mounts one closed part of each kind while the document is still on its way (nothing else to do then, and no
 * nodes to restyle), so the editor finds the sheets in place. It draws nothing: it is hidden and out of the tree.
 */
export function ShellWarmup() {
  return (
    <div hidden aria-hidden="true" inert>
      <ScrollArea className="h-4">
        <span />
      </ScrollArea>
      <Popover trigger={<button type="button" tabIndex={-1} />} />
      <Tooltip content="">
        <button type="button" tabIndex={-1} />
      </Tooltip>
      <Menu pendingAnnouncement="">
        <MenuTrigger render={<button type="button" tabIndex={-1} />} />
        <MenuContent>
          <MenuItem>{""}</MenuItem>
        </MenuContent>
      </Menu>
    </div>
  );
}
