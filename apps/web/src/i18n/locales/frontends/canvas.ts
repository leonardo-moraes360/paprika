/**
 * Strings of the canvas frontend (`frontends.canvas.*`), by subject:
 * - `history`: the label of every step a gesture or an editor sends to the history, in the language of the app (the old canvas' wording);
 * - `names`: the name a new node gets;
 * - `select`: the selection handles, the size badge and the layers menu;
 * - `text`, `editors`: the editors drawn over the canvas (rich text, a shape's text, an arrow's label, a frame's name);
 * - `vector`: the handles of paths, arrows, gradients and spacing.
 * What the owner container says on its own (paste and drop, agents, pins, the order of layers) is `app.canvas.*`.
 */
export const canvasEn = {
  history: {
    move: "move",
    moveMany: "move {{count}} nodes",
    reorder: "reorder",
    reparent: "reparent",
    resize: "resize",
    rotate: "rotate",
    create: "create {{name}}",
    editText: "edit text",
    editLabel: "edit label",
    renameFrame: "rename frame",
  },
  names: {
    frame: "Frame",
    rect: "Rectangle",
    ellipse: "Ellipse",
    text: "Text",
    shape: "Box",
    diamond: "Decision",
    triangle: "Triangle",
    cylinder: "Cylinder",
    parallelogram: "Parallelogram",
    cloud: "Cloud",
    note: "Note",
  },
  select: {
    size: "Selection size",
    corner: {
      nw: "Resize top left corner",
      ne: "Resize top right corner",
      sw: "Resize bottom left corner",
      se: "Resize bottom right corner",
    },
    rotate: "Rotate",
    rotateHint: "Drag to rotate. Shift snaps to 15°.",
    ratioLock: "Aspect · Shift",
    ratioLockAlt: "1:1 · Shift+Alt",
    menu: {
      label: "Layers under the cursor",
      center: "Center content",
      convert: "Convert to path",
    },
  },
  text: {
    field: "Text",
    toolbar: "Text format",
    bold: "Bold",
    italic: "Italic",
    size: "Size",
    color: "Color",
    link: "Link",
    applyLink: "Apply link",
  },
  editors: {
    shapeText: "Shape text",
    connectorLabel: "Arrow label",
    frameName: "Frame name",
    renameHint: "Double-click to rename",
  },
};

export const canvasPtBR: typeof canvasEn = {
  history: {
    move: "mover",
    moveMany: "mover {{count}} nós",
    reorder: "reordenar",
    reparent: "reparentear",
    resize: "redimensionar",
    rotate: "girar",
    create: "criar {{name}}",
    editText: "editar texto",
    editLabel: "editar rótulo",
    renameFrame: "renomear frame",
  },
  names: {
    frame: "Frame",
    rect: "Retângulo",
    ellipse: "Elipse",
    text: "Texto",
    shape: "Caixa",
    diamond: "Decisão",
    triangle: "Triângulo",
    cylinder: "Cilindro",
    parallelogram: "Paralelogramo",
    cloud: "Nuvem",
    note: "Nota",
  },
  select: {
    size: "Tamanho da seleção",
    corner: {
      nw: "Redimensionar canto superior esquerdo",
      ne: "Redimensionar canto superior direito",
      sw: "Redimensionar canto inferior esquerdo",
      se: "Redimensionar canto inferior direito",
    },
    rotate: "Girar",
    rotateHint: "Arraste para girar. Shift trava em 15°.",
    ratioLock: "Proporção · Shift",
    ratioLockAlt: "1:1 · Shift+Alt",
    menu: {
      label: "Camadas sob o cursor",
      center: "Centralizar conteúdo",
      convert: "Converter em caminho",
    },
  },
  text: {
    field: "Texto",
    toolbar: "Formato do texto",
    bold: "Negrito",
    italic: "Itálico",
    size: "Tamanho",
    color: "Cor",
    link: "Link",
    applyLink: "Aplicar link",
  },
  editors: {
    shapeText: "Texto da forma",
    connectorLabel: "Rótulo da seta",
    frameName: "Nome do frame",
    renameHint: "Duplo clique para renomear",
  },
};
