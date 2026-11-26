import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ErrorBanner } from "@/components/ui/error-banner";
import { ExportCode } from "@/components/ui/export-code";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@/components/ui/tabs";
import { copyText } from "@/lib/copy-text";
import { asBlob, asText, downloadBlob, errorText, imageExtension, imageFileName } from "./download";
import { currentSize, ImagePanel, type ImageState } from "./image-panel";
import type { ExportCodeFormat, ExportDialogProps, ExportImageFormat, ExportMode } from "./types";

const defaultModes: readonly ExportMode[] = ["image", "code"];
const defaultImageFormats: readonly ExportImageFormat[] = [{ value: "png", label: "PNG", transparent: true }];
const defaultCodeFormats: readonly ExportCodeFormat[] = [
  { value: "react", label: "React", extension: ".tsx" },
  { value: "html", label: "HTML", extension: ".html" },
];
const defaultScales: readonly number[] = [1, 2, 3, 4];

type Code = { status: "idle" | "loading" | "ready" | "error"; text: string };
type Failure = { kind: "code" | "export"; reason: string } | { kind: "copy" };

export function ExportDialog({
  open,
  onOpenChange,
  onRequestExport,
  fileName,
  mode: controlledMode,
  defaultMode = "image",
  onModeChange,
  modes = defaultModes,
  imageFormats = defaultImageFormats,
  defaultImageFormat,
  scales = defaultScales,
  scopes = [],
  size,
  codeFormats = defaultCodeFormats,
  defaultCodeFormat,
}: ExportDialogProps) {
  const { t } = useTranslation();
  const [innerMode, setInnerMode] = useState<ExportMode>(defaultMode);
  const mode = controlledMode ?? innerMode;
  const [image, setImage] = useState<ImageState>(() => ({
    format: defaultImageFormat ?? imageFormats[0]?.value ?? "png",
    scale: scales[0] ?? 1,
    custom: null,
    keepRatio: true,
    transparent: false,
    scope: null,
  }));
  const [codeFormat, setCodeFormat] = useState(() => defaultCodeFormat ?? codeFormats[0]?.value ?? "react");
  const [tokens, setTokens] = useState(true);
  const [code, setCode] = useState<Code>({ status: "idle", text: "" });
  const [failure, setFailure] = useState<Failure | null>(null);
  const [copied, setCopied] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const latest = useRef(0);
  const request = useRef(onRequestExport);
  const requested = useRef<string | null>(null);
  const openRef = useRef(open);

  useEffect(() => {
    request.current = onRequestExport;
    openRef.current = open;
  });

  useEffect(() => {
    if (!open || mode !== "code") return;
    const key = `${codeFormat}|${tokens}|${attempt}`;
    if (requested.current === key) return;
    requested.current = key;
    const ticket = ++latest.current;
    setCode({ status: "loading", text: "" });
    setCopied(false);
    request.current({ kind: "code", format: codeFormat, tokens })
      .then(asText)
      .then((text) => {
        if (ticket === latest.current) setCode({ status: "ready", text });
      })
      .catch((reason: unknown) => {
        if (ticket !== latest.current) return;
        setCode({ status: "error", text: "" });
        setFailure({ kind: "code", reason: errorText(reason) });
      });
  }, [open, mode, codeFormat, tokens, attempt]);

  useEffect(() => {
    if (open) return;
    latest.current += 1;
    requested.current = null;
    setFailure(null);
    setCopied(false);
    setCode({ status: "idle", text: "" });
  }, [open]);

  const changeMode = (next: ExportMode | null) => {
    if (!next) return;
    if (controlledMode === undefined) setInnerMode(next);
    if (next !== mode) onModeChange?.(next);
    setFailure(null);
  };

  const exportImage = async () => {
    const format = imageFormats.find((option) => option.value === image.format);
    const vector = format?.vector === true;
    const shown = vector ? null : currentSize(image, size);
    const scale = image.custom && size ? image.custom.width / size.width : image.scale;
    try {
      const out = await onRequestExport({
        kind: "image",
        format: image.format,
        scale: vector ? 1 : scale,
        scope: image.scope ?? scopes[0]?.value ?? null,
        width: shown?.width ?? null,
        height: shown?.height ?? null,
        transparent: format?.transparent === true && image.transparent,
      });
      if (!openRef.current) return;
      downloadBlob(asBlob(out, image.format === "svg" ? "image/svg+xml" : `image/${imageExtension(image.format)}`), imageFileName(fileName, image.format, image.scale, !vector && !image.custom));
      setFailure(null);
    } catch (reason) {
      if (openRef.current) setFailure({ kind: "export", reason: errorText(reason) });
    }
  };

  const format = codeFormats.find((option) => option.value === codeFormat);
  const extension = format?.extension ?? ".txt";

  const copyCode = async () => {
    if (code.status !== "ready") return;
    if (await copyText(code.text)) {
      setCopied(true);
      setFailure(null);
    } else {
      setFailure({ kind: "copy" });
    }
  };

  const downloadCode = () => {
    if (code.status !== "ready") return;
    downloadBlob(new Blob([code.text], { type: "text/plain" }), `${fileName}${extension.startsWith(".") ? extension : `.${extension}`}`);
  };

  const imagePanel = (
    <ImagePanel
      state={image}
      formats={imageFormats}
      scales={scales}
      scopes={scopes}
      size={size}
      fileName={fileName}
      onChange={(patch) => setImage((current) => ({ ...current, ...patch }))}
      onExport={exportImage}
    />
  );
  const codePanel = (
    <ExportCode
      className="w-full"
      formats={codeFormats}
      format={codeFormat}
      onFormatChange={setCodeFormat}
      tokens={tokens}
      onTokensChange={setTokens}
      code={code.status === "loading" ? t("frontends.exportDialog.code.generating") : code.text}
      onCopy={copyCode}
      onDownload={downloadCode}
      labels={{
        format: t("frontends.exportDialog.code.format"),
        tokens: t("frontends.exportDialog.code.tokens"),
        code: t("frontends.exportDialog.code.code"),
        copy: t("frontends.exportDialog.code.copy"),
        download: t("frontends.exportDialog.code.download", { extension }),
        pendingAnnouncement: t("frontends.exportDialog.pending"),
      }}
    />
  );

  const available = modes.filter((value) => value === "image" || value === "code");
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      pendingAnnouncement={t("common.working")}
      title={t("frontends.exportDialog.title")}
      closeLabel={t("frontends.exportDialog.close")}
    >
      {available.length > 1 ? (
        <Tabs value={mode} onValueChange={changeMode}>
          <TabsList aria-label={t("frontends.exportDialog.modeList")}>
            {available.map((value) => (
              <TabsTab key={value} value={value}>
                {t(`frontends.exportDialog.modes.${value}`)}
              </TabsTab>
            ))}
          </TabsList>
          {available.map((value) => (
            <TabsPanel key={value} value={value} className="mt-3">
              {value === "image" ? imagePanel : codePanel}
            </TabsPanel>
          ))}
        </Tabs>
      ) : available[0] === "code" ? (
        codePanel
      ) : (
        imagePanel
      )}
      {failure ? (
        <ErrorBanner action={mode === "code" && code.status === "error" ? <Button size="sm" variant="secondary" onClick={() => { setFailure(null); setAttempt((n) => n + 1); }}>{t("frontends.exportDialog.code.retry")}</Button> : undefined}>
          {failure.kind === "copy" ? t("frontends.exportDialog.failures.copy") : t(`frontends.exportDialog.failures.${failure.kind}`, { reason: failure.reason })}
        </ErrorBanner>
      ) : null}
      {copied ? (
        <p role="status" className="sr-only">
          {t("frontends.exportDialog.code.copied")}
        </p>
      ) : null}
    </Dialog>
  );
}
