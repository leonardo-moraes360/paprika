import { zoomBarEn } from "./frontends/zoomBar";
import { toolbarEn } from "./frontends/toolbar";
import { layersPanelEn } from "./frontends/layersPanel";
import { editorHeaderEn } from "./frontends/editorHeader";
import { fontPickerEn } from "./frontends/fontPicker";
import { propertiesPanelEn } from "./frontends/propertiesPanel";

import { activityEn } from "./frontends/activity";
import { workspaceNoticeEn } from "./frontends/workspaceNotice";
import { historyPanelEn } from "./frontends/historyPanel";
import { teamEn } from "./frontends/team";
import { agentsEn } from "./frontends/agents";
import { pinsEn } from "./frontends/pins";
import { overviewEn } from "./frontends/overview";
import { importDialogEn } from "./frontends/importDialog";
import { exportDialogEn } from "./frontends/exportDialog";
import { canvasErrorEn } from "./frontends/canvasError";

export const en = {
  home: {
    title: "Paprika",
    tagline: "A design tool your AI agents can draw on.",
    start: "Get started",
  },
  common: {
    working: "Working",
  },
  notifications: {
    label: "Notifications",
    close: "Close notification",
  },
  notFound: {
    title: "Page not found",
    home: "Back to home",
  },
  theme: {
    label: "Theme",
    system: "System",
    light: "Light",
    dark: "Dark",
  },
  language: {
    label: "Language",
    en: "English",
    "pt-BR": "Português (Brasil)",
  },
  frontends: {
    fontPicker: fontPickerEn,
    propertiesPanel: propertiesPanelEn,
    agents: agentsEn,
    pins: pinsEn,
    team: teamEn,
    historyPanel: historyPanelEn,
    workspaceNotice: workspaceNoticeEn,
    activity: activityEn,
    editorLayout: {
      left: {
        region: "Layers panel",
        resize: "Resize layers panel",
        show: "Show layers panel",
        hide: "Hide layers panel",
      },
      right: {
        region: "Properties panel",
        resize: "Resize properties panel",
        show: "Show properties panel",
        hide: "Hide properties panel",
      },
    },
    pagesPanel: {
      title: "Pages",
      newPage: "New page",
      pageList: "Pages",
      empty: "No pages yet.",
      renamePage: "Page name",
      deletePage: "Delete page {{name}}",
      agentsOnPage_one: "{{count}} active agent on this page",
      agentsOnPage_other: "{{count}} active agents on this page",
      deleteTitle: "Delete page “{{name}}”?",
      deleteDescription: "The page and everything on it will be removed.",
      deleteConfirm: "Delete page",
      deleteCancel: "Cancel",
    },
    editorHeader: editorHeaderEn,
    layersPanel: layersPanelEn,
    toolbar: toolbarEn,
    zoomBar: zoomBarEn,
    importDialog: importDialogEn,
    exportDialog: exportDialogEn,
    canvasError: canvasErrorEn,
    overview: overviewEn,
  },
} as const;
