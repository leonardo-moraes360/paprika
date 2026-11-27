/** Texts of the containers (routes, overview, editor): never inside `frontends.*`. */
export const appEn = {
  workspaces: "Workspaces",
  untitled: "Untitled",
  offline: "Offline. Reconnecting…",
  stage: "Canvas",
  open: {
    title: "Opening workspace",
    description: "Loading the document from the server.",
    failedTitle: "Could not open the workspace",
    failedFallback: "The server did not open it.",
    deleted: "This workspace was deleted.",
    back: "Back to workspaces",
  },
  overview: {
    loadFailed: "Could not load the workspaces.",
    openFailed: "Could not open the workspace.",
  },
  connection: {
    lost: "Connection lost. Changes cannot be sent until it is back.",
  },
};

export const appPtBR: typeof appEn = {
  workspaces: "Workspaces",
  untitled: "Sem título",
  offline: "Sem conexão. Reconectando…",
  stage: "Canvas",
  open: {
    title: "Abrindo workspace",
    description: "Carregando o documento do servidor.",
    failedTitle: "Não foi possível abrir o workspace",
    failedFallback: "O servidor não o abriu.",
    deleted: "Este workspace foi excluído.",
    back: "Voltar aos workspaces",
  },
  overview: {
    loadFailed: "Não foi possível carregar os workspaces.",
    openFailed: "Não foi possível abrir o workspace.",
  },
  connection: {
    lost: "Conexão perdida. As alterações não podem ser enviadas até ela voltar.",
  },
};
