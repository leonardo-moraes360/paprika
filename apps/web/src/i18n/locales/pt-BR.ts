import type { Translation } from "../resources";

export const ptBR: Translation = {
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
    sidePanel: {
      region: "Painel de {{name}}",
      resize: "Redimensionar painel de {{name}}",
      show: "Mostrar painel de {{name}}",
      hide: "Esconder painel de {{name}}",
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
  },
};
