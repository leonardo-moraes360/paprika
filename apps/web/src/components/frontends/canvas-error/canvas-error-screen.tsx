import { Copy } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { SectionHeader } from "@/components/ui/section-header";
import { StatusIcon } from "@/components/ui/status-icon";
import { copyText } from "@/lib/copy-text";
import { buildIssueUrl } from "@/lib/issue-url";
import { cn } from "@/lib/utils";
import { describeError } from "./details";
import type { CanvasErrorReport, CanvasErrorScreenProps } from "./types";

export function CanvasErrorScreen({ error, onReload, issueUrl, issue, environment, className }: CanvasErrorScreenProps) {
  const { t } = useTranslation();
  const [include, setInclude] = useState(true);
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");
  const details = describeError(error);

  const report = (): CanvasErrorReport => {
    const body = [
      t("frontends.canvasError.reportDoing"),
      environment ? t("frontends.canvasError.reportEnvironment", { value: environment }) : "",
      include ? t("frontends.canvasError.reportError", { value: details }) : "",
    ]
      .filter(Boolean)
      .join("\n");
    return { error, details, environment, includeDetails: include, title: t("frontends.canvasError.reportTitle"), body };
  };

  const href = (() => {
    if (typeof issueUrl === "function") return issueUrl(report());
    if (issueUrl) return issueUrl;
    if (!issue) return null;
    const { title, body } = report();
    return buildIssueUrl({ ...issue, title, body });
  })();

  const copy = async () => {
    setCopied((await copyText(environment ? `${details}\n${environment}` : details)) ? "done" : "failed");
  };

  return (
    <div className={cn("flex size-full items-center justify-center bg-canvas p-4", className)}>
      <div
        role="alert"
        className="flex w-110 max-w-full flex-col gap-4 rounded-dialog border border-line bg-popover p-6 text-fg shadow-dialog forced-colors:border-2"
      >
        <div className="flex items-center gap-3">
          <StatusIcon status="warning" size="lg" />
          <h2 className="min-w-0 flex-1 text-[17px] leading-[1.3] font-bold">{t("frontends.canvasError.title")}</h2>
        </div>
        <p className="text-base leading-normal text-muted">{t("frontends.canvasError.body")}</p>
        <SectionHeader
          variant="inspector"
          headingLevel={3}
          title={t("frontends.canvasError.details")}
          defaultOpen={false}
          className="rounded-lg border border-line bg-bg"
        >
          <div className="flex flex-col gap-2.5 px-3 pb-3">
            <pre className="font-mono text-xs leading-normal break-words whitespace-pre-wrap text-fg">{details}</pre>
            {environment ? <p className="text-xs leading-[1.45] text-muted">{environment}</p> : null}
            <div className="flex items-center gap-3">
              <Button variant="secondary" size="sm" onClick={copy}>
                <Copy aria-hidden="true" />
                {t("frontends.canvasError.copy")}
              </Button>
              {href ? <Checkbox label={t("frontends.canvasError.include")} checked={include} onCheckedChange={(next) => setInclude(next === true)} /> : null}
            </div>
            {copied !== "idle" ? (
              <p role="status" className="text-xs text-muted">
                {copied === "done" ? t("frontends.canvasError.copied") : t("frontends.canvasError.copyFail")}
              </p>
            ) : null}
          </div>
        </SectionHeader>
        <div className="flex items-center gap-2">
          {href ? (
            <Button variant="secondary" render={<a href={href} target="_blank" rel="noopener noreferrer" />}>
              {t("frontends.canvasError.report")}
            </Button>
          ) : null}
          <span className="flex-1" />
          <Button autoFocus onClick={onReload}>
            {t("frontends.canvasError.reload")}
          </Button>
        </div>
      </div>
    </div>
  );
}
