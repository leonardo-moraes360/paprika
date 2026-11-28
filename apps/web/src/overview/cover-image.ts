/** Same limits as the old app: a PNG/JPEG/WebP/GIF of at most 2 MiB goes as it is; anything else becomes a 960 px wide WebP. */
export const maxCoverBytes = 2 * 1024 * 1024;
export const coverTypes = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const maxWidth = 960;

export type CoverDeps = {
  decode: (file: Blob) => Promise<{ width: number; height: number; draw: (canvas: HTMLCanvasElement) => void; close: () => void }>;
  makeCanvas: () => HTMLCanvasElement;
};

const browserDeps: CoverDeps = {
  decode: async (file) => {
    const bitmap = await createImageBitmap(file);
    return {
      width: bitmap.width,
      height: bitmap.height,
      draw: (canvas) => canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height),
      close: () => bitmap.close(),
    };
  },
  makeCanvas: () => document.createElement("canvas"),
};

/** The body to send as the cover. Rejects with `failMessage` when the image cannot be converted. */
export async function coverBody(file: File, failMessage: string, deps: CoverDeps = browserDeps): Promise<Blob> {
  if (file.size <= maxCoverBytes && coverTypes.includes(file.type)) return file;
  let image;
  try {
    image = await deps.decode(file);
  } catch {
    throw new Error(failMessage);
  }
  const scale = Math.min(1, maxWidth / image.width);
  const canvas = deps.makeCanvas();
  canvas.width = Math.round(image.width * scale);
  canvas.height = Math.round(image.height * scale);
  image.draw(canvas);
  image.close();
  const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, "image/webp", 0.85));
  if (!blob) throw new Error(failMessage);
  return blob;
}
