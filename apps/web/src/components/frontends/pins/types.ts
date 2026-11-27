import type { AgentColor } from "@/components/ui/agent-tone";
import type { PinStatus } from "@/components/ui/pin";

export type { PinStatus };

export type PinFilter = "open" | "resolved" | "all";

export type PinTarget = { kind: "node"; name: string } | { kind: "area"; width: number; height: number } | { kind: "missing" };

export type PinAuthor = { name: string; you?: boolean; tone?: AgentColor };

export type PinReplyEntry = {
  id: string;
  author: PinAuthor;
  text: string;
  createdAt: number;
};

export type PinEntry = {
  id: string;
  number: number;
  status: PinStatus;
  text: string;
  author: PinAuthor;
  createdAt: number;
  target: PinTarget;
  claimedBy?: { name: string; tone: AgentColor };
  replies: readonly PinReplyEntry[];
};

export type PinClock = { now?: number; clock?: () => number };

export type PinsPanelProps = PinClock & {
  pins: readonly PinEntry[];
  filter?: PinFilter;
  defaultFilter?: PinFilter;
  onFilterChange?: (filter: PinFilter) => void;
  selectedId?: string | null;
  onSelectPin: (id: string) => void;
  onClose?: () => void;
  shortcut?: readonly string[];
  className?: string;
};

export type PinCardProps = PinClock & {
  pin: PinEntry;
  onReply: (text: string) => Promise<unknown>;
  onSetStatus: (status: "open" | "resolved") => Promise<unknown>;
  onDelete: () => Promise<unknown>;
  onShow?: () => void;
  onClose?: () => void;
  maxLength?: number;
  className?: string;
};

export type PinRecipientOption = { value: string; label: string };

export type PinReference = { id: string; kind: "image" | "link"; name: string; detail?: string };

export type NewPinInput = { text: string; recipient: string | null; attachRegion: boolean };

export type NewPinFormProps = {
  number: number;
  target: PinTarget;
  recipients?: readonly PinRecipientOption[];
  references?: readonly PinReference[];
  onSubmit: (input: NewPinInput) => Promise<unknown>;
  onCancel: () => void;
  onAttachReference?: () => void;
  onRemoveReference?: (id: string) => void;
  /** Labels of the submit shortcut shown as hints (for example `["Ctrl", "Enter"]` or `["⌘", "Enter"]`); the owner formats them for the platform. Hidden when absent. */
  submitShortcut?: readonly string[];
  maxLength?: number;
  defaultAttachRegion?: boolean;
  /** Hides the "attach a crop of the area" checkbox, for an owner that cannot attach one (default: shown). */
  showAttachRegion?: boolean;
  /** Hides the "click the canvas to change" hint, for an owner without a canvas to click (default: shown). */
  showChangeHint?: boolean;
  className?: string;
};
