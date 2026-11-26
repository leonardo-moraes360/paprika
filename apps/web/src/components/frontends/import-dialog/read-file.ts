const textExtension = /\.(svg|html?|json)$/i;

export function isTextFile(file: File): boolean {
  return textExtension.test(file.name) || file.type.startsWith("text/") || file.type === "image/svg+xml" || file.type === "application/json";
}

export function fileKind(file: File): string {
  if (/\.paprika\.json$/i.test(file.name)) return "PAPRIKA";
  const dot = file.name.lastIndexOf(".");
  return dot > 0 ? file.name.slice(dot + 1).toUpperCase() : "";
}

export function readText(file: File, onProgress: (ratio: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(event.loaded / event.total);
    };
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error ?? new Error("read"));
    reader.readAsText(file);
  });
}
