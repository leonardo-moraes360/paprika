import type { Locale } from "./locales";

type Plural = { one: string; other: string };

export type Messages = {
  language: string;
  languageEn: string;
  languagePt: string;
  switchLanguage: string;
  cancel: string;
  close: string;
  save: string;
  create: string;
  delete: string;
  remove: string;
  copy: string;
  copied: string;
  loading: string;
  connecting: string;
  connected: string;
  disconnected: string;
  you: string;
  now: string;
  galleryLoading: string;
  workspacesTitle: string;
  documentTitle: (name: string) => string;
  overviewHeading: string;
  overviewLead: (count: string) => string;
  overviewEmpty: string;
  overviewCount: (n: number) => string;
  overviewActive: string;
  overviewActiveHint: string;
  overviewRenameHint: string;
  overviewCoverHint: (hasCover: boolean) => string;
  overviewCoverAria: (action: string, name: string) => string;
  overviewAddCover: string;
  overviewOpenAria: (name: string) => string;
  overviewRenameAria: (name: string) => string;
  overviewDeleteAria: (name: string) => string;
  overviewArchiveAria: (name: string) => string;
  overviewRestoreAria: (name: string) => string;
  overviewArchiveHint: string;
  overviewRestoreHint: string;
  overviewArchiveBlocked: string;
  overviewFilterAll: string;
  overviewFilterArchived: string;
  overviewArchivedHeading: string;
  overviewArchivedEmpty: string;
  overviewArchivedCount: (n: number) => string;
  overviewActiveSuccessor: (name: string) => string;
  overviewOnServer: string;
  newWorkspace: string;
  workspaceName: string;
  workspaceNameNew: string;
  createWorkspace: string;
  openWorkspace: string;
  renameWorkspace: string;
  deleteWorkspace: string;
  deleteWorkspaceTitle: (name: string) => string;
  deleteWorkspaceBody: (nodesLabel: string) => string;
  deleteWorkspaceConfirm: string;
  deleteWorkspaceBlocked: string;
  coverImage: string;
  changeCover: string;
  removeCover: string;
  coverConvertFail: string;
  listWorkspacesFail: (err: string) => string;
  mutationFail: (what: string, err: string) => string;
  whatCreateWorkspace: string;
  whatRenameWorkspace: string;
  whatDeleteWorkspace: string;
  whatArchiveWorkspace: string;
  whatRestoreWorkspace: string;
  whatChangeCover: string;
  whatRemoveCover: string;
  mcpOn: string;
  disconnectedShort: string;
  openingWorkspace: string;
  loadingWorkspace: string;
  connectingServer: string;
  openWorkspaceFail: (err: string) => string;
  allWorkspaces: string;
  pagesAndLayers: string;
  properties: string;
  rightPanel: string;
  inspectorTab: string;
  teamTab: string;
  layersPanelWidth: string;
  propsPanelWidth: string;
  showLayersPanel: string;
  showPropsPanel: string;
  tools: string;
  toolSelect: string;
  toolFrame: string;
  toolRect: string;
  toolEllipse: string;
  toolText: string;
  toolPen: string;
  toolShape: string;
  toolDiamond: string;
  toolTriangle: string;
  toolNote: string;
  toolConnector: string;
  toolPin: string;
  pinsTitle: string;
  pinsOpenCount: (n: number) => string;
  pinsToggle: string;
  pinsFilterOpen: (n: number) => string;
  pinsFilterResolved: (n: number) => string;
  pinsFilterAll: string;
  pinsEmpty: string;
  pinsHint: string;
  pinToolHint: string;
  pinTarget: string;
  pinArea: (w: number, h: number) => string;
  pinTo: string;
  pinAnyAgent: string;
  pinPlaceholder: string;
  pinSend: string;
  pinSendKeys: string;
  pinCancelKeys: string;
  pinStatusOpen: string;
  pinStatusClaimed: (agent: string) => string;
  pinStatusResolved: string;
  pinWorking: (agent: string) => string;
  pinReplied: (agent: string) => string;
  pinResolvedBy: (agent: string) => string;
  pinReopen: string;
  pinResolve: string;
  pinDelete: string;
  pinShow: string;
  pinNodeGone: string;
  pinBadge: (n: number) => string;
  pinComposer: string;
  pinSaveFail: (err: string) => string;
  undo: string;
  redo: string;
  undoHint: string;
  redoHint: string;
  exportSvg: string;
  exportSvgHint: string;
  exportSvgMissing: string;
  exportSvgWarn: (warnings: string) => string;
  exportSvgFail: (err: string) => string;
  toolbarDrag: string;
  toolbarDragHint: string;
  toolbarMenu: string;
  toolbarPosition: string;
  toolbarDockLabel: string;
  dockTop: string;
  dockLeft: string;
  dockRight: string;
  dockBottom: string;
  pages: string;
  newPage: string;
  pageName: string;
  pageN: (n: number) => string;
  renamePageHint: string;
  deletePageHint: string;
  deletePageAria: (name: string) => string;
  pagesPlaceholderHint: string;
  createPageLabel: string;
  renamePageLabel: string;
  deletePageLabel: string;
  layers: string;
  layerName: string;
  hideLayer: (name: string) => string;
  showLayer: (name: string) => string;
  renameLayerHint: string;
  layerMenu: string;
  zoomIn: string;
  zoomOut: string;
  zoomFit: string;
  zoomFitHint: string;
  rendererDom: string;
  rendererWasm: string;
  rendererWasmUnavailable: string;
  rendererWasmHint: (backend: string) => string;
  rendererDomHint: string;
  pasteFail: (err: string) => string;
  nothingToPaste: string;
  ratioLock: string;
  ratioLockAlt: string;
  renameFrameHint: string;
  resizeCorner: (corner: string) => string;
  rotate: string;
  rotateHint: string;
  cornerTl: string;
  cornerTr: string;
  cornerBl: string;
  cornerBr: string;
  agentsInWorkspace: string;
  otherPage: string;
  goToAgentCursor: (name: string) => string;
  goToAgentOnPage: (name: string, page: string) => string;
  noEditsYet: string;
  historyPosition: string;
  editSingular: string;
  editPlural: string;
  nodeSingular: string;
  nodePlural: string;
  pageSingular: string;
  pagePlural: string;
  frameSingular: string;
  framePlural: string;
  imageSingular: string;
  imagePlural: string;
  connectorSingular: string;
  connectorPlural: string;
  relativeNow: string;
  untitled: string;
  noticeDeleted: (name: string) => string;
  noticeOpened: (name: string) => string;
  noticeRenamed: (name: string) => string;
  noticeSummary: (parts: string[]) => string;
  noticeEdits: (n: number) => string;
  viewWorkspaces: string;
  dismissNotice: string;
  invalidResponse: (path: string) => string;
  offline: string;
  colorRecent: string;
  colorTokens: string;
  colorSatBri: string;
  colorHue: string;
  colorAlpha: string;
  connectorLabel: string;
  confirmCancel: string;
  typeToConfirmBefore: string;
  typeToConfirmAfter: string;
  numericUseNumber: string;
  numericBetween: (min: string, max: string) => string;
  numericMin: (min: string) => string;
  numericMax: (max: string) => string;
  themeMode: string;
  selectedNodes: (n: number) => string;
  groupNodes: string;
  ungroupNodes: string;
  arrange: string;
  bringForward: string;
  sendBackward: string;
  bringToFront: string;
  sendToBack: string;
  opacity: string;
  fill: string;
  stroke: string;
  radius: string;
  rotation: string;
  position: string;
  size: string;
  width: string;
  height: string;
  text: string;
  font: string;
  weight: string;
  lineHeight: string;
  letterSpacing: string;
  align: string;
  notes: string;
  tokens: string;
  lint: string;
  activity: string;
  instanceOf: string;
  scale: string;
  detach: string;
  component: string;
  makeComponent: string;
  lockSize: string;
  autoLayout: string;
  gap: string;
  padding: string;
  clip: string;
  visible: string;
  locked: string;
  name: string;
  type: string;
  label: string;
  route: string;
  dashed: string;
  startArrow: string;
  endArrow: string;
  shapeKind: string;
  fit: string;
  alt: string;
  src: string;
  shadow: string;
  noSelection: string;
  multiSelectionHint: string;
  teamTitle: string;
  teamChipHint: string;
  teamEmpty: string;
  teamCreate: string;
  teamNamePlaceholder: string;
  teamPeople: string;
  teamSync: string;
  teamShare: string;
  teamShared: string;
  teamLocalOnly: string;
  teamNotShared: string;
  teamInvite: string;
  teamJoin: string;
  teamKeys: string;
  teamInviteTitle: (name: string) => string;
  teamInviteLead: string;
  teamCopyLink: string;
  teamExpires: string;
  teamJoinTitle: string;
  teamJoinLead: string;
  teamJoinFail: string;
  teamJoinOk: string;
  teamJoinExpired: (mins: string) => string;
  teamJoinExpiredBody: string;
  teamLeft: string;
  teamLeftBody: string;
  teamKeysTitle: string;
  teamKeysLead: string;
  teamRemoveMember: string;
  teamRemoveConfirm: (name: string, fingerprint: string) => string;
  teamRotate: string;
  teamRotateConfirm: string;
  teamRotateLead: string;
  teamConnecting: string;
  teamPublicKey: string;
  teamFounder: string;
  teamPerson: string;
  teamAgent: string;
  teamSoon: string;
  teamThisDevice: string;
  teamEnter: string;
  teamState: string;
  teamWho: string;
  teamSince: string;
  teamDelegated: string;
  teamGenerateKey: string;
  teamRemoving: string;
  teamRotating: string;
  verbOutline: string;
  verbGuide: string;
  verbHistory: string;
  verbCreatePage: string;
  verbCreateComponent: string;
  verbImportSvg: string;
  verbImportHtml: string;
  verbTokens: string;
  verbPath: string;
  verbGeneric: string;
};

const en: Messages = {
  language: "Language",
  languageEn: "English",
  languagePt: "Português",
  switchLanguage: "Language",
  cancel: "Cancel",
  close: "Close",
  save: "Save",
  create: "Create",
  delete: "Delete",
  remove: "Remove",
  copy: "Copy",
  copied: "Copied",
  loading: "Loading…",
  connecting: "Connecting…",
  connected: "Connected to server",
  disconnected: "Disconnected from server",
  you: "you",
  now: "now",
  galleryLoading: "Gallery…",
  workspacesTitle: "Workspaces · Paprika",
  documentTitle: (name) => `${name} · Paprika`,
  overviewHeading: "Workspaces",
  overviewLead: (count) =>
    `${count} on this server. The active one is what agents see over MCP. Click to open; F2 or the pencil renames.`,
  overviewEmpty: "No workspaces yet. Create the first one.",
  overviewCount: (n) => (n === 1 ? "1 workspace" : `${n} workspaces`),
  overviewActive: "active",
  overviewActiveHint: "Open on the server: MCP agents read and write this one",
  overviewRenameHint: "Rename (F2)",
  overviewCoverHint: (has) => `${has ? "Change" : "Add"} cover (or drop an image on the card)`,
  overviewCoverAria: (action, name) => `${action} cover of ${name}`,
  overviewAddCover: "Add",
  overviewOpenAria: (name) => `Open workspace ${name}`,
  overviewRenameAria: (name) => `Rename ${name}`,
  overviewDeleteAria: (name) => `Delete ${name}`,
  overviewArchiveAria: (name) => `Archive ${name}`,
  overviewRestoreAria: (name) => `Restore ${name}`,
  overviewArchiveHint: "Archive (keeps the file)",
  overviewRestoreHint: "Restore to the list",
  overviewArchiveBlocked: "The only workspace cannot be archived",
  overviewFilterAll: "All",
  overviewFilterArchived: "Archived",
  overviewArchivedHeading: "Archived",
  overviewArchivedEmpty: "No archived workspaces.",
  overviewArchivedCount: (n) => (n === 1 ? "1 archived" : `${n} archived`),
  overviewActiveSuccessor: (name) => `This is the active workspace: the canvas and MCP agents move to “${name}”.`,
  overviewOnServer: "on this server",
  newWorkspace: "New workspace",
  workspaceName: "Workspace name",
  workspaceNameNew: "New workspace name",
  createWorkspace: "Create",
  openWorkspace: "Open",
  renameWorkspace: "Rename",
  deleteWorkspace: "Delete (Delete)",
  deleteWorkspaceTitle: (name) => `Delete “${name}”?`,
  deleteWorkspaceBody: (nodesLabel) => `${nodesLabel} and the undo history will be removed. This cannot be undone.`,
  deleteWorkspaceConfirm: "Delete workspace",
  deleteWorkspaceBlocked: "The only workspace cannot be deleted",
  coverImage: "Cover image",
  changeCover: "Change",
  removeCover: "Remove",
  coverConvertFail: "could not convert the image",
  listWorkspacesFail: (err) => `Could not list workspaces: ${err}`,
  mutationFail: (what, err) => `Could not ${what}: ${err}`,
  whatCreateWorkspace: "create the workspace",
  whatRenameWorkspace: "rename the workspace",
  whatDeleteWorkspace: "delete the workspace",
  whatArchiveWorkspace: "archive the workspace",
  whatRestoreWorkspace: "restore the workspace",
  whatChangeCover: "change the cover",
  whatRemoveCover: "remove the cover",
  mcpOn: "MCP at /mcp",
  disconnectedShort: "disconnected",
  openingWorkspace: "Opening workspace…",
  loadingWorkspace: "Loading workspace…",
  connectingServer: "Connecting to the Paprika server…",
  openWorkspaceFail: (err) => `Could not open the workspace: ${err}`,
  allWorkspaces: "All workspaces",
  pagesAndLayers: "Pages and layers",
  properties: "Properties",
  rightPanel: "Right panel",
  inspectorTab: "Inspector",
  teamTab: "Team",
  layersPanelWidth: "Layers panel width",
  propsPanelWidth: "Properties panel width",
  showLayersPanel: "Show layers panel",
  showPropsPanel: "Show properties panel",
  tools: "Tools",
  toolSelect: "Select",
  toolFrame: "Frame",
  toolRect: "Rectangle",
  toolEllipse: "Ellipse",
  toolText: "Text",
  toolPen: "Pen (bezier)",
  toolShape: "Diagram box",
  toolDiamond: "Decision (diamond)",
  toolTriangle: "Triangle",
  toolNote: "Sticky note",
  toolConnector: "Arrow (snaps to shapes)",
  toolPin: "Point for the AI (click an element or drag an area)",
  pinsTitle: "Pins",
  pinsOpenCount: (n) => (n === 1 ? "1 open pin" : `${n} open pins`),
  pinsToggle: "Pins for the AI (Shift+I)",
  pinsFilterOpen: (n) => `Open ${n}`,
  pinsFilterResolved: (n) => `Resolved ${n}`,
  pinsFilterAll: "All",
  pinsEmpty: "No pins here. Press I, click an element or drag an area, and write what the AI should do.",
  pinsHint: "Click an item to bring the canvas to its pin. Resolved pins leave the canvas but stay here.",
  pinToolHint: "click an element or drag an area",
  pinTarget: "Target",
  pinArea: (w, h) => `area ${w}×${h}`,
  pinTo: "To",
  pinAnyAgent: "Any agent",
  pinPlaceholder: "What should the AI do here?",
  pinSend: "Send to the AI",
  pinSendKeys: "sends",
  pinCancelKeys: "cancels",
  pinStatusOpen: "Open",
  pinStatusClaimed: (agent) => agent,
  pinStatusResolved: "Resolved",
  pinWorking: (agent) => `${agent} is working on this`,
  pinReplied: (agent) => `${agent} replied`,
  pinResolvedBy: (agent) => `resolved by ${agent}`,
  pinReopen: "Reopen",
  pinResolve: "Mark resolved",
  pinDelete: "Delete pin",
  pinShow: "Show on canvas",
  pinNodeGone: "element deleted",
  pinBadge: (n) => `Pin ${n}`,
  pinComposer: "New pin for the AI",
  pinSaveFail: (err) => `Could not save the pin: ${err}`,
  undo: "Undo",
  redo: "Redo",
  undoHint: "Undo (Ctrl+Z)",
  redoHint: "Redo (Ctrl+Shift+Z)",
  exportSvg: "Export SVG",
  exportSvgHint: "Export SVG (selection, or the page)",
  exportSvgMissing: "the server did not return SVG",
  exportSvgWarn: (w) => `SVG exported with warnings: ${w}`,
  exportSvgFail: (err) => `Failed to export SVG: ${err}`,
  toolbarDrag: "Drag toolbar",
  toolbarDragHint: "Drag to dock",
  toolbarMenu: "Toolbar menu",
  toolbarPosition: "Toolbar position",
  toolbarDockLabel: "Dock toolbar",
  dockTop: "Top",
  dockLeft: "Left",
  dockRight: "Right",
  dockBottom: "Bottom",
  pages: "Pages",
  newPage: "New page",
  pageName: "Page name",
  pageN: (n) => `Page ${n}`,
  renamePageHint: "Double-click or F2 to rename",
  deletePageHint: "Delete page (undo with Ctrl+Z)",
  deletePageAria: (name) => `Delete page ${name}`,
  pagesPlaceholderHint: "Workspace with no pages: the first + creates page 1. Double-click or F2 to rename.",
  createPageLabel: "create page",
  renamePageLabel: "rename page",
  deletePageLabel: "delete page",
  layers: "Layers",
  layerName: "Layer name",
  hideLayer: (name) => `Hide ${name}`,
  showLayer: (name) => `Show ${name}`,
  renameLayerHint: "Double-click or F2 to rename",
  layerMenu: "Layers under the cursor",
  zoomIn: "Zoom in",
  zoomOut: "Zoom out",
  zoomFit: "Fit",
  zoomFitHint: "Fit (Shift+1)",
  rendererDom: "DOM",
  rendererWasm: "WASM",
  rendererWasmUnavailable: "WASM renderer not built (pnpm build with Rust installed).",
  rendererWasmHint: (backend) => `WASM renderer (${backend}). Click to switch back to DOM.`,
  rendererDomHint: "DOM renderer. Click to try WASM.",
  pasteFail: (err) => `Could not paste: ${err}`,
  nothingToPaste: "nothing to paste",
  ratioLock: "Aspect · Shift",
  ratioLockAlt: "1:1 · Shift+Alt",
  renameFrameHint: "Double-click to rename",
  resizeCorner: (corner) => `Resize ${corner} corner`,
  rotate: "Rotate",
  rotateHint: "Drag to rotate. Shift snaps to 15°.",
  cornerTl: "top-left",
  cornerTr: "top-right",
  cornerBl: "bottom-left",
  cornerBr: "bottom-right",
  agentsInWorkspace: "Agents in the workspace",
  otherPage: "other page",
  goToAgentCursor: (name) => `Go to ${name}'s cursor`,
  goToAgentOnPage: (name, page) => `Go to ${name} on page ${page}`,
  noEditsYet: "No edits yet.",
  historyPosition: "Current position in history",
  editSingular: "edit",
  editPlural: "edits",
  nodeSingular: "node",
  nodePlural: "nodes",
  pageSingular: "page",
  pagePlural: "pages",
  frameSingular: "frame",
  framePlural: "frames",
  imageSingular: "image",
  imagePlural: "images",
  connectorSingular: "connector",
  connectorPlural: "connectors",
  relativeNow: "now",
  untitled: "Untitled",
  noticeDeleted: (name) => `deleted workspace “${name}”`,
  noticeOpened: (name) => `opened workspace “${name}”`,
  noticeRenamed: (name) => `renamed the workspace to “${name}”`,
  noticeSummary: (parts) => parts.join(" · "),
  noticeEdits: (n) => (n === 1 ? "1 edit in history" : `${n} edits in history`),
  viewWorkspaces: "View workspaces",
  dismissNotice: "Dismiss notice",
  invalidResponse: (path) => `invalid response from ${path}`,
  offline: "no connection to the server",
  colorRecent: "Recent",
  colorTokens: "Document tokens",
  colorSatBri: "Saturation and brightness",
  colorHue: "Hue",
  colorAlpha: "Alpha",
  connectorLabel: "Arrow label",
  confirmCancel: "Cancel",
  typeToConfirmBefore: "Type ",
  typeToConfirmAfter: " to confirm",
  numericUseNumber: "Use a number.",
  numericBetween: (min, max) => `Use a number between ${min} and ${max}.`,
  numericMin: (min) => `Use a number ≥ ${min}.`,
  numericMax: (max) => `Use a number ≤ ${max}.`,
  themeMode: "Theme mode",
  selectedNodes: (n) => `${n} nodes selected`,
  groupNodes: "Group",
  ungroupNodes: "Ungroup",
  arrange: "Order",
  bringForward: "Bring forward",
  sendBackward: "Send backward",
  bringToFront: "Bring to front",
  sendToBack: "Send to back",
  opacity: "Opacity",
  fill: "Fill",
  stroke: "Stroke",
  radius: "Radius",
  rotation: "Rotation",
  position: "Position",
  size: "Size",
  width: "W",
  height: "H",
  text: "Text",
  font: "Font",
  weight: "Weight",
  lineHeight: "Line height",
  letterSpacing: "Letter spacing",
  align: "Align",
  notes: "Notes",
  tokens: "Tokens",
  lint: "Lint",
  activity: "Activity",
  instanceOf: "Instance of",
  scale: "Scale",
  detach: "Detach",
  component: "Component",
  makeComponent: "Make component",
  lockSize: "Lock size",
  autoLayout: "Auto layout",
  gap: "Gap",
  padding: "Padding",
  clip: "Clip",
  visible: "Visible",
  locked: "Locked",
  name: "Name",
  type: "Type",
  label: "Label",
  route: "Route",
  dashed: "Dashed",
  startArrow: "Start arrow",
  endArrow: "End arrow",
  shapeKind: "Shape",
  fit: "Fit",
  alt: "Alt text",
  src: "Source",
  shadow: "Shadow",
  noSelection: "Nothing selected",
  multiSelectionHint: "Edit shared properties or group the selection.",
  teamTitle: "Team: people, agents and sync",
  teamChipHint: "Team sync",
  teamEmpty: "This Paprika is not in a team yet. Create one and invite people, or join with an invite link.",
  teamCreate: "Create team",
  teamNamePlaceholder: "North Studio",
  teamPeople: "People and agents",
  teamSync: "Connection and sync",
  teamShare: "Share this workspace",
  teamShared: "Synced",
  teamLocalOnly: "Only on this device now",
  teamNotShared: "Workspace not shared",
  teamInvite: "Invite",
  teamJoin: "Join a team",
  teamKeys: "Team keys",
  teamInviteTitle: (name) => `Invite to ${name}`,
  teamInviteLead: "Whoever opens the link joins with their own key. The link works once and expires.",
  teamCopyLink: "Copy link",
  teamExpires: "Expires",
  teamJoinTitle: "Join a team",
  teamJoinLead: "Paste the link or scan the QR from whoever invited you.",
  teamJoinFail: "Could not join",
  teamJoinOk: "You joined the team. Shared workspaces show up on the home page.",
  teamJoinExpired: (mins) => `Invite expired ${mins} min ago`,
  teamJoinExpiredBody: "Ask for a new link. Nothing changed on your Paprika.",
  teamLeft: "You are no longer on this team",
  teamLeftBody: "Your changes stay on this device only. To rejoin, ask for a new invite.",
  teamKeysTitle: "Team keys",
  teamKeysLead: "Only operations signed by these keys enter the team's workspaces.",
  teamRemoveMember: "Remove",
  teamRemoveConfirm: (name, fp) =>
    `${name}'s key (ed25519 ${fp}) and their agents stop syncing. What already changed stays in the workspaces; new changes signed by that key are refused.`,
  teamRotate: "Rotate key",
  teamRotateConfirm: "Generate a new key?",
  teamRotateLead: "Use this if this machine or key leaked. The new key signs the swap with the old one and the team then accepts only the new key.",
  teamConnecting: "Connecting to the team sidecar…",
  teamPublicKey: "Public key",
  teamFounder: "founder",
  teamPerson: "person",
  teamAgent: "agent",
  teamSoon: "soon",
  teamThisDevice: "this device",
  teamEnter: "Join",
  teamState: "State",
  teamWho: "Who",
  teamSince: "Since",
  teamDelegated: "Delegated by",
  teamGenerateKey: "Generate new key",
  teamRemoving: "Removing…",
  teamRotating: "Rotating…",
  verbOutline: "reading the outline",
  verbGuide: "reading the guide",
  verbHistory: "reading history",
  verbCreatePage: "creating a page",
  verbCreateComponent: "creating a component",
  verbImportSvg: "importing SVG",
  verbImportHtml: "importing HTML",
  verbTokens: "updating tokens",
  verbPath: "measuring a path",
  verbGeneric: "working",
};

const pt: Messages = {
  ...en,
  language: "Idioma",
  switchLanguage: "Idioma",
  cancel: "Cancelar",
  close: "Fechar",
  save: "Salvar",
  create: "Criar",
  delete: "Excluir",
  remove: "Remover",
  copy: "Copiar",
  copied: "Copiado",
  loading: "Carregando…",
  connecting: "Conectando…",
  connected: "Conectado ao servidor",
  disconnected: "Desconectado do servidor",
  you: "você",
  now: "agora",
  galleryLoading: "Galeria…",
  overviewLead: (count) =>
    `${count} neste servidor. O ativo é o que os agentes enxergam pelo MCP. Clique para abrir; F2 ou o lápis renomeia.`,
  overviewEmpty: "Nenhum workspace ainda. Crie o primeiro.",
  overviewActive: "ativo",
  overviewActiveHint: "Aberto no servidor: os agentes MCP leem e escrevem neste",
  overviewRenameHint: "Renomear (F2)",
  overviewCoverHint: (has) => `${has ? "Trocar" : "Adicionar"} capa (ou arraste uma imagem para o card)`,
  overviewCoverAria: (action, name) => `${action} capa de ${name}`,
  overviewAddCover: "Adicionar",
  overviewOpenAria: (name) => `Abrir workspace ${name}`,
  overviewRenameAria: (name) => `Renomear ${name}`,
  overviewDeleteAria: (name) => `Excluir ${name}`,
  overviewArchiveAria: (name) => `Arquivar ${name}`,
  overviewRestoreAria: (name) => `Restaurar ${name}`,
  overviewArchiveHint: "Arquivar (o arquivo fica)",
  overviewRestoreHint: "Restaurar para a lista",
  overviewArchiveBlocked: "O único workspace não pode ser arquivado",
  overviewFilterAll: "Todos",
  overviewFilterArchived: "Arquivados",
  overviewArchivedHeading: "Arquivados",
  overviewArchivedEmpty: "Nenhum workspace arquivado.",
  overviewArchivedCount: (n) => (n === 1 ? "1 arquivado" : `${n} arquivados`),
  overviewActiveSuccessor: (name) => `Este é o workspace ativo: o canvas e os agentes MCP passam para “${name}”.`,
  overviewOnServer: "neste servidor",
  newWorkspace: "Novo workspace",
  workspaceName: "Nome do workspace",
  workspaceNameNew: "Novo nome do workspace",
  createWorkspace: "Criar",
  openWorkspace: "Abrir",
  renameWorkspace: "Renomear",
  deleteWorkspace: "Excluir (Delete)",
  deleteWorkspaceTitle: (name) => `Excluir “${name}”?`,
  deleteWorkspaceBody: (nodesLabel) => `${nodesLabel} e o histórico de desfazer serão apagados. Essa ação não pode ser desfeita.`,
  deleteWorkspaceConfirm: "Excluir workspace",
  deleteWorkspaceBlocked: "O único workspace não pode ser excluído",
  coverImage: "Imagem de capa",
  changeCover: "Trocar",
  removeCover: "Remover",
  coverConvertFail: "não foi possível converter a imagem",
  listWorkspacesFail: (err) => `Não foi possível listar os workspaces: ${err}`,
  mutationFail: (what, err) => `Não foi possível ${what}: ${err}`,
  whatCreateWorkspace: "criar o workspace",
  whatRenameWorkspace: "renomear o workspace",
  whatDeleteWorkspace: "excluir o workspace",
  whatArchiveWorkspace: "arquivar o workspace",
  whatRestoreWorkspace: "restaurar o workspace",
  whatChangeCover: "trocar a capa",
  whatRemoveCover: "remover a capa",
  mcpOn: "MCP em /mcp",
  disconnectedShort: "desconectado",
  openingWorkspace: "Abrindo workspace…",
  loadingWorkspace: "Carregando workspace…",
  connectingServer: "Conectando ao servidor Paprika…",
  openWorkspaceFail: (err) => `Não foi possível abrir o workspace: ${err}`,
  allWorkspaces: "Todos os workspaces",
  pagesAndLayers: "Páginas e camadas",
  properties: "Propriedades",
  rightPanel: "Painel da direita",
  teamTab: "Time",
  layersPanelWidth: "Largura do painel de camadas",
  propsPanelWidth: "Largura do painel de propriedades",
  showLayersPanel: "Mostrar painel de camadas",
  showPropsPanel: "Mostrar painel de propriedades",
  tools: "Ferramentas",
  toolSelect: "Selecionar",
  toolRect: "Retângulo",
  toolEllipse: "Elipse",
  toolText: "Texto",
  toolPen: "Caneta (bezier)",
  toolShape: "Caixa de diagrama",
  toolDiamond: "Decisão (losango)",
  toolTriangle: "Triângulo",
  toolNote: "Nota adesiva",
  toolConnector: "Seta (prende nas formas)",
  toolPin: "Apontar para a IA (clique num elemento ou arraste uma área)",
  pinsTitle: "Apontamentos",
  pinsOpenCount: (n) => (n === 1 ? "1 apontamento aberto" : `${n} apontamentos abertos`),
  pinsToggle: "Apontamentos para a IA (Shift+I)",
  pinsFilterOpen: (n) => `Abertos ${n}`,
  pinsFilterResolved: (n) => `Resolvidos ${n}`,
  pinsFilterAll: "Todos",
  pinsEmpty: "Nenhum apontamento aqui. Aperte I, clique num elemento ou arraste uma área e escreva o que a IA deve fazer.",
  pinsHint: "Clique num item para levar o canvas até o pino. Os resolvidos somem do canvas, mas ficam aqui.",
  pinToolHint: "clique num elemento ou arraste uma área",
  pinTarget: "Alvo",
  pinArea: (w, h) => `área ${w}×${h}`,
  pinTo: "Para",
  pinAnyAgent: "Qualquer agente",
  pinPlaceholder: "O que a IA deve fazer aqui?",
  pinSend: "Enviar para a IA",
  pinSendKeys: "envia",
  pinCancelKeys: "cancela",
  pinStatusOpen: "Aberto",
  pinStatusClaimed: (agent) => agent,
  pinStatusResolved: "Resolvido",
  pinWorking: (agent) => `${agent} está trabalhando nisto`,
  pinReplied: (agent) => `${agent} respondeu`,
  pinResolvedBy: (agent) => `resolvido por ${agent}`,
  pinReopen: "Reabrir",
  pinResolve: "Marcar resolvido",
  pinDelete: "Apagar apontamento",
  pinShow: "Ver no canvas",
  pinNodeGone: "elemento apagado",
  pinBadge: (n) => `Apontamento ${n}`,
  pinComposer: "Novo apontamento para a IA",
  pinSaveFail: (err) => `Não deu para salvar o apontamento: ${err}`,
  undo: "Desfazer",
  redo: "Refazer",
  undoHint: "Desfazer (Ctrl+Z)",
  redoHint: "Refazer (Ctrl+Shift+Z)",
  exportSvg: "Exportar SVG",
  exportSvgHint: "Exportar SVG (seleção, ou a página)",
  exportSvgMissing: "o servidor não devolveu o SVG",
  exportSvgWarn: (w) => `SVG exportado com avisos: ${w}`,
  exportSvgFail: (err) => `Falha ao exportar SVG: ${err}`,
  toolbarDrag: "Arrastar barra de ferramentas",
  toolbarDragHint: "Arrastar para ancorar",
  toolbarMenu: "Menu da barra de ferramentas",
  toolbarPosition: "Posição da barra",
  toolbarDockLabel: "Ancorar barra",
  dockTop: "Topo",
  dockLeft: "Esquerda",
  dockRight: "Direita",
  dockBottom: "Fundo",
  pages: "Páginas",
  newPage: "Nova página",
  pageName: "Nome da página",
  pageN: (n) => `Página ${n}`,
  renamePageHint: "Duplo clique ou F2 para renomear",
  deletePageHint: "Apagar página (desfazer com Ctrl+Z)",
  deletePageAria: (name) => `Apagar página ${name}`,
  pagesPlaceholderHint: "Workspace sem páginas: o primeiro + cria a página 1. Duplo clique ou F2 para renomear.",
  createPageLabel: "criar página",
  renamePageLabel: "renomear página",
  deletePageLabel: "apagar página",
  layers: "Camadas",
  layerName: "Nome da camada",
  hideLayer: (name) => `Ocultar ${name}`,
  showLayer: (name) => `Mostrar ${name}`,
  renameLayerHint: "Duplo clique ou F2 para renomear",
  layerMenu: "Camadas sob o cursor",
  zoomIn: "Aumentar zoom",
  zoomOut: "Diminuir zoom",
  zoomFit: "Enquadrar",
  zoomFitHint: "Enquadrar (Shift+1)",
  rendererWasmUnavailable: "Renderizador WASM não compilado (pnpm build com Rust instalado).",
  rendererWasmHint: (backend) => `Renderizador WASM (${backend}). Clique para voltar ao DOM.`,
  rendererDomHint: "Renderizador DOM. Clique para tentar WASM.",
  pasteFail: (err) => `Não deu para colar: ${err}`,
  nothingToPaste: "nada para colar",
  ratioLock: "Proporção · Shift",
  renameFrameHint: "Duplo clique para renomear",
  resizeCorner: (corner) => `Redimensionar canto ${corner}`,
  rotate: "Girar",
  rotateHint: "Arraste para girar. Shift trava em 15°.",
  cornerTl: "superior esquerdo",
  cornerTr: "superior direito",
  cornerBl: "inferior esquerdo",
  cornerBr: "inferior direito",
  agentsInWorkspace: "Agentes no workspace",
  otherPage: "outra página",
  goToAgentCursor: (name) => `Ir até o cursor de ${name}`,
  goToAgentOnPage: (name, page) => `Ir até ${name} na página ${page}`,
  noEditsYet: "Nenhuma edição ainda.",
  historyPosition: "Posição atual no histórico",
  editSingular: "edição",
  editPlural: "edições",
  nodeSingular: "nó",
  nodePlural: "nós",
  pageSingular: "página",
  pagePlural: "páginas",
  imageSingular: "imagem",
  imagePlural: "imagens",
  connectorSingular: "conector",
  connectorPlural: "conectores",
  relativeNow: "agora",
  untitled: "Sem título",
  noticeDeleted: (name) => `apagou o workspace “${name}”`,
  noticeOpened: (name) => `abriu o workspace “${name}”`,
  noticeRenamed: (name) => `renomeou o workspace para “${name}”`,
  noticeEdits: (n) => (n === 1 ? "1 edição no histórico" : `${n} edições no histórico`),
  viewWorkspaces: "Ver workspaces",
  dismissNotice: "Dispensar aviso",
  invalidResponse: (path) => `resposta inválida de ${path}`,
  offline: "sem conexão com o servidor",
  colorRecent: "Recentes",
  colorTokens: "Tokens do documento",
  colorSatBri: "Saturação e brilho",
  colorHue: "Matiz",
  connectorLabel: "Rótulo da seta",
  confirmCancel: "Cancelar",
  typeToConfirmBefore: "Digite ",
  typeToConfirmAfter: " para confirmar",
  numericUseNumber: "Use um número.",
  numericBetween: (min, max) => `Use um número entre ${min} e ${max}.`,
  numericMin: (min) => `Use um número ≥ ${min}.`,
  numericMax: (max) => `Use um número ≤ ${max}.`,
  themeMode: "Modo de tema",
  selectedNodes: (n) => `${n} nós selecionados`,
  groupNodes: "Agrupar",
  ungroupNodes: "Desagrupar",
  arrange: "Ordem",
  bringForward: "Avançar",
  sendBackward: "Recuar",
  bringToFront: "Trazer para frente",
  sendToBack: "Enviar para fundo",
  opacity: "Opacidade",
  fill: "Preenchimento",
  stroke: "Traço",
  radius: "Raio",
  rotation: "Rotação",
  position: "Posição",
  size: "Tamanho",
  width: "L",
  height: "A",
  text: "Texto",
  font: "Fonte",
  weight: "Peso",
  lineHeight: "Altura da linha",
  letterSpacing: "Espaçamento",
  align: "Alinhamento",
  notes: "Notas",
  activity: "Atividade",
  instanceOf: "Instância de",
  scale: "Escala",
  detach: "Desanexar",
  component: "Componente",
  makeComponent: "Tornar componente",
  lockSize: "Travar tamanho",
  autoLayout: "Layout automático",
  gap: "Espaço",
  clip: "Recortar",
  visible: "Visível",
  locked: "Travado",
  name: "Nome",
  type: "Tipo",
  label: "Rótulo",
  route: "Rota",
  dashed: "Tracejado",
  startArrow: "Seta início",
  endArrow: "Seta fim",
  shapeKind: "Forma",
  fit: "Encaixe",
  alt: "Texto alternativo",
  src: "Origem",
  shadow: "Sombra",
  noSelection: "Nada selecionado",
  multiSelectionHint: "Edite propriedades compartilhadas ou agrupe a seleção.",
  teamTitle: "Time: pessoas, agentes e sincronização",
  teamChipHint: "Sync do time",
  teamEmpty: "Este Paprika ainda não está em um time. Crie um e convide as pessoas, ou entre com um link de convite.",
  teamCreate: "Criar time",
  teamNamePlaceholder: "Estúdio Norte",
  teamPeople: "Pessoas e agentes",
  teamSync: "Conexão e sync",
  teamShare: "Compartilhar este workspace",
  teamShared: "Sincronizado",
  teamLocalOnly: "Só neste dispositivo agora",
  teamNotShared: "Workspace não compartilhado",
  teamInvite: "Convidar",
  teamJoin: "Entrar em um time",
  teamKeys: "Chaves do time",
  teamInviteTitle: (name) => `Convidar para ${name}`,
  teamInviteLead: "Quem abrir o link entra no time com a própria chave. O link vale uma vez e expira.",
  teamCopyLink: "Copiar link",
  teamExpires: "Expira em",
  teamJoinTitle: "Entrar em um time",
  teamJoinLead: "Cole o link ou leia o QR de quem convidou.",
  teamJoinFail: "Não deu para entrar",
  teamJoinOk: "Você entrou no time. Os workspaces compartilhados aparecem na página inicial.",
  teamJoinExpired: (mins) => `Convite expirado há ${mins} min`,
  teamJoinExpiredBody: "Peça um novo link. Nada foi alterado no seu Paprika.",
  teamLeft: "Você não está mais neste time",
  teamLeftBody: "Suas mudanças ficam só neste dispositivo. Para voltar, peça um convite novo.",
  teamKeysTitle: "Chaves do time",
  teamKeysLead: "Só operações assinadas por estas chaves entram nos workspaces do time.",
  teamRemoveMember: "Remover",
  teamRemoveConfirm: (name, fp) =>
    `A chave de ${name} (ed25519 ${fp}) e as dos agentes dela deixam de sincronizar. O que já foi mudado continua nos workspaces; mudanças novas assinadas por essa chave são recusadas.`,
  teamRotate: "Trocar chave",
  teamRotateConfirm: "Gerar nova chave?",
  teamRotateLead: "Use se esta máquina ou a chave vazou. A chave nova assina a troca junto com a antiga e o time passa a aceitar só a nova.",
  teamConnecting: "Conectando ao sidecar do time…",
  teamPublicKey: "Chave pública",
  teamFounder: "fundador(a)",
  teamPerson: "pessoa",
  teamAgent: "agente",
  teamSoon: "em breve",
  teamThisDevice: "este dispositivo",
  teamEnter: "Entrar",
  teamState: "Estado",
  teamWho: "Quem",
  teamSince: "Desde",
  teamDelegated: "Delegada por",
  teamGenerateKey: "Gerar nova chave",
  teamRemoving: "Removendo…",
  teamRotating: "Trocando…",
  verbOutline: "lendo o documento",
  verbGuide: "lendo o guia",
  verbHistory: "lendo o histórico",
  verbCreatePage: "criando página",
  verbCreateComponent: "criando componente",
  verbImportSvg: "importando SVG",
  verbImportHtml: "importando HTML",
  verbTokens: "ajustando tokens",
  verbPath: "medindo caminho",
  verbGeneric: "trabalhando",
};

export const catalogs: Record<Locale, Messages> = { en, "pt-BR": pt };

/** Unused helper type kept so Plural stays available for future message shapes. */
export type _Plural = Plural;
