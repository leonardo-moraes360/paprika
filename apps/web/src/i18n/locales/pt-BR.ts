import { appPtBR } from "./app";
import { activityPtBR } from "./frontends/activity";
import { workspaceNoticePtBR } from "./frontends/workspaceNotice";
import { historyPanelPtBR } from "./frontends/historyPanel";
import { teamPtBR } from "./frontends/team";
import { agentsPtBR } from "./frontends/agents";
import { pinsPtBR } from "./frontends/pins";
import type { Translation } from "../resources";
import { zoomBarPtBR } from "./frontends/zoomBar";
import { toolbarPtBR } from "./frontends/toolbar";
import { layersPanelPtBR } from "./frontends/layersPanel";
import { editorHeaderPtBR } from "./frontends/editorHeader";
import { fontPickerPtBR } from "./frontends/fontPicker";
import { propertiesPanelPtBR } from "./frontends/propertiesPanel";
import { overviewPtBR } from "./frontends/overview";
import { importDialogPtBR } from "./frontends/importDialog";
import { exportDialogPtBR } from "./frontends/exportDialog";
import { canvasErrorPtBR } from "./frontends/canvasError";
import { canvasSelectPtBR } from "./frontends/canvasSelect";

export const ptBR: Translation = {
  app: appPtBR,
  home: {
    title: "Paprika",
    tagline: "Uma ferramenta de design em que seus agentes de IA desenham.",
    start: "Começar",
  },
  common: {
    working: "Processando",
  },
  notifications: {
    label: "Notificações",
    close: "Fechar notificação",
  },
  notFound: {
    title: "Página não encontrada",
    home: "Voltar ao início",
  },
  theme: {
    label: "Tema",
    system: "Sistema",
    light: "Claro",
    dark: "Escuro",
  },
  language: {
    label: "Idioma",
    en: "English",
    "pt-BR": "Português (Brasil)",
  },
  frontends: {
    fontPicker: fontPickerPtBR,
    propertiesPanel: propertiesPanelPtBR,
    agents: agentsPtBR,
    pins: pinsPtBR,
    team: teamPtBR,
    historyPanel: historyPanelPtBR,
    workspaceNotice: workspaceNoticePtBR,
    activity: activityPtBR,
    editorLayout: {
      left: {
        region: "Painel de camadas",
        resize: "Redimensionar painel de camadas",
        show: "Mostrar painel de camadas",
        hide: "Esconder painel de camadas",
      },
      right: {
        region: "Painel de propriedades",
        resize: "Redimensionar painel de propriedades",
        show: "Mostrar painel de propriedades",
        hide: "Esconder painel de propriedades",
      },
    },
    pagesPanel: {
      title: "Páginas",
      newPage: "Nova página",
      pageList: "Páginas",
      empty: "Nenhuma página ainda.",
      renamePage: "Nome da página",
      deletePage: "Excluir página {{name}}",
      agentsOnPage_one: "{{count}} agente ativo nesta página",
      agentsOnPage_other: "{{count}} agentes ativos nesta página",
      deleteTitle: "Excluir a página “{{name}}”?",
      deleteDescription: "A página e tudo o que está nela serão removidos.",
      deleteConfirm: "Excluir página",
      deleteCancel: "Cancelar",
    },
    editorHeader: editorHeaderPtBR,
    layersPanel: layersPanelPtBR,
    toolbar: toolbarPtBR,
    zoomBar: zoomBarPtBR,
    importDialog: importDialogPtBR,
    exportDialog: exportDialogPtBR,
    canvasError: canvasErrorPtBR,
    canvas: { select: canvasSelectPtBR },
    overview: overviewPtBR,
  },
};
