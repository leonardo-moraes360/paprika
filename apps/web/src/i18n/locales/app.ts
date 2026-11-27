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
  collab: {
    pins: { loadFailed: "Could not load the pins." },
    export: {
      scopeSelection: "Selection",
      scopePage: "Page",
      scopeCanvas: "Whole canvas",
      noFrame: "Select a frame, or open a page with a frame, to export its code.",
      codeFailed: "Could not generate the code.",
    },
    import: {
      destination: "{{name}}",
      noPage: "the canvas",
      fig: "{{name}}: .fig files are not imported. Export SVG from that tool and import the SVG.",
      pdf: "{{name}}: PDF files are not imported.",
      paprika: "{{name}}: a .paprika.json is a whole document, so it cannot be placed on a page here. Import it from the command line.",
      unsupported: "Unsupported format: {{name}}",
      tooLarge: "{{name}}: image too large ({{size}} bytes, the limit is {{limit}}).",
      dataUri: "{{name}}: the image data passes {{limit}} characters.",
      invalidImage: "{{name}}: not a valid image.",
      nothing: "Nothing to import in {{name}}.",
      failed: "Could not import {{name}}: {{reason}}",
      someFailed: "{{count}} file(s) could not be imported.",
      warnings: "Imported with warnings: {{warnings}}",
      offline: "Offline: the import was not sent.",
      label: "import {{count}} file(s)",
    },
    boundary: {
      environment: "Paprika web app · renderer {{renderer}} · {{agent}}",
    },
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
  collab: {
    pins: { loadFailed: "Não foi possível carregar os apontamentos." },
    export: {
      scopeSelection: "Seleção",
      scopePage: "Página",
      scopeCanvas: "Canvas inteiro",
      noFrame: "Selecione um frame, ou abra uma página com um frame, para exportar o código.",
      codeFailed: "Não foi possível gerar o código.",
    },
    import: {
      destination: "{{name}}",
      noPage: "o canvas",
      fig: "{{name}}: arquivos .fig não são importados. Exporte SVG dessa ferramenta e importe o SVG.",
      pdf: "{{name}}: arquivos PDF não são importados.",
      paprika: "{{name}}: um .paprika.json é um documento inteiro e não cabe numa página aqui. Importe pela linha de comando.",
      unsupported: "Formato não suportado: {{name}}",
      tooLarge: "{{name}}: imagem grande demais ({{size}} bytes, o limite é {{limit}}).",
      dataUri: "{{name}}: os dados da imagem passam de {{limit}} caracteres.",
      invalidImage: "{{name}}: imagem inválida.",
      nothing: "Nada para importar em {{name}}.",
      failed: "Não foi possível importar {{name}}: {{reason}}",
      someFailed: "{{count}} arquivo(s) não puderam ser importados.",
      warnings: "Importado com avisos: {{warnings}}",
      offline: "Sem conexão: a importação não foi enviada.",
      label: "importar {{count}} arquivo(s)",
    },
    boundary: {
      environment: "App web do Paprika · renderizador {{renderer}} · {{agent}}",
    },
  },
  connection: {
    lost: "Conexão perdida. As alterações não podem ser enviadas até ela voltar.",
  },
};
