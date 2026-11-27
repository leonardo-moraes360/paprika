/** Strings of the canvas' selection and transform batch: `frontends.canvas.select.*`. The history labels are the old canvas' wording, said in the language of the app. */
export const canvasSelectEn = {
  labels: {
    move: "move",
    moveMany: "move {{count}} nodes",
    reorder: "reorder",
    reparent: "reparent",
    resize: "resize",
    rotate: "rotate",
  },
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
} as const;

export const canvasSelectPtBR = {
  labels: {
    move: "mover",
    moveMany: "mover {{count}} nós",
    reorder: "reordenar",
    reparent: "reparentear",
    resize: "redimensionar",
    rotate: "girar",
  },
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
} as const;
