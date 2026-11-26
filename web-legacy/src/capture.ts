export interface CaptureParams {
  id: string;
  page: string | null;
}

export function captureParams(): CaptureParams | null {
  const q = new URLSearchParams(location.search);
  const id = q.get("capture");
  if (!id) return null;
  return { id, page: q.get("page") };
}
