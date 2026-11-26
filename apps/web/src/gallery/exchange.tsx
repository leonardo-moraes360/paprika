import { useState } from "react";
import { EmptyIllustration, type EmptyIllustrationKind } from "@/components/ui/empty-illustration";
import { ExportCode } from "@/components/ui/export-code";
import { ExportImage } from "@/components/ui/export-image";
import { ImportDropzone } from "@/components/ui/import-dropzone";
import { ImportedFile } from "@/components/ui/imported-file";
import { Cell, Grid, Specimen, type GalleryMeta } from "./_kit";

export const meta: GalleryMeta = { title: "Import, export and empty states", order: 310 };

const formats = ["png", "jpeg", "webp", "avif", "pdf", "svg"].map((value) => ({ value, label: value.toUpperCase() }));
const scales = ["1x", "2x", "3x", "4x"].map((value) => ({ value, label: value }));
const codeFormats = [
  { value: "react", label: "React" },
  { value: "html", label: "HTML" },
];
const snippets: Record<string, string> = {
  react: `export function Cover() {\n  return (\n    <section className="cover">\n      <h1>Paprika</h1>\n    </section>\n  );\n}`,
  html: `<section class="cover">\n  <h1>Paprika</h1>\n</section>`,
};
const imageLabels = { format: "Format", scale: "Scale", file: "File", vectorNote: "Vector: no scale, text stays text.", exportAction: "Export", pendingAnnouncement: "Exporting" };
const codeLabels = { format: "Format", tokens: "Tokens as CSS variables", code: "Generated code", copy: "Copy", download: "Download", pendingAnnouncement: "Working" };

const kinds: ReadonlyArray<{ kind: EmptyIllustrationKind; label: string; tone: string }> = [
  { kind: "first-use", label: "first use", tone: "positive" },
  { kind: "all-done", label: "all done", tone: "positive" },
  { kind: "no-results", label: "no results", tone: "negative" },
  { kind: "offline", label: "offline", tone: "negative" },
];

export default function ExchangeSection() {
  const [format, setFormat] = useState("png");
  const [scale, setScale] = useState("2x");
  const [codeFormat, setCodeFormat] = useState("react");
  const [tokens, setTokens] = useState(true);
  const [picked, setPicked] = useState<string[]>([]);
  const [copied, setCopied] = useState(0);
  const vector = format === "svg" || format === "pdf";
  return (
    <>
      <Grid>
        <Specimen
          label="Export image · live"
          note="280 wide column, gap 8. Format rail 28 high (2 px inset, radius 6, active option on the panel with a field border); scale buttons 28 high with a field border, the active one a 2 px select border on the field background; file row 36 high; export is the primary Button. Vector formats drop the scale and show the note. Arrow keys move through the options."
        >
          <ExportImage
            formats={formats}
            format={format}
            onFormatChange={setFormat}
            vector={vector}
            scales={scales}
            scale={scale}
            onScaleChange={setScale}
            fileName={vector ? `Cover.${format}` : `Cover@${scale}.${format}`}
            dimensions={vector ? undefined : "3200 × 1800"}
            onExport={() => undefined}
            labels={imageLabels}
          />
        </Specimen>
        <Specimen
          label="Export image · fixed states"
          note="Raster png at 2x and a vector svg, shown at the same time."
        >
          <ExportImage formats={formats} format="png" onFormatChange={() => undefined} scales={scales} scale="2x" onScaleChange={() => undefined} fileName="Cover@2x.png" dimensions="3200 × 1800" onExport={() => undefined} labels={imageLabels} />
          <ExportImage formats={formats} format="svg" vector onFormatChange={() => undefined} scales={scales} scale="2x" onScaleChange={() => undefined} fileName="Cover.svg" onExport={() => undefined} labels={imageLabels} />
        </Specimen>
        <Specimen
          label="Export code · live"
          note={`Format field 36 high, checkbox 18 with the action fill, code block 150 high in 12 px mono (scrolls, focusable), Copy secondary and Download primary 36 high. Copy pressed ${copied} times.`}
        >
          <ExportCode
            formats={codeFormats}
            format={codeFormat}
            onFormatChange={setCodeFormat}
            tokens={tokens}
            onTokensChange={setTokens}
            code={snippets[codeFormat] ?? ""}
            onCopy={() => setCopied((n) => n + 1)}
            onDownload={() => undefined}
            labels={{ ...codeLabels, download: codeFormat === "react" ? "Download .tsx" : "Download .html" }}
          />
        </Specimen>
        <Specimen label="Import dropzone · states" note="280 × 124, radius 10. Rest: dashed 1.5 px field outline on the field background. Dragging: 2 px select border on a select tint. Error: red soft with a dashed red outline. The live one takes drops, pastes and a click or Enter on the zone.">
          <Cell label="rest">
            <ImportDropzone prompt="Drop files or paste with Ctrl V" draggingPrompt="Drop to import into Cover" formats="PNG, JPEG, WebP, AVIF, GIF, SVG, HTML" browseLabel="Choose files" />
          </Cell>
          <Cell label="dragging">
            <ImportDropzone state="dragging" prompt="Drop files or paste with Ctrl V" draggingPrompt="Drop to import into Cover" formats="PNG, JPEG, WebP, AVIF, GIF, SVG, HTML" browseLabel="Choose files" />
          </Cell>
          <Cell label="error">
            <ImportDropzone state="error" prompt="Drop files or paste with Ctrl V" draggingPrompt="Drop to import into Cover" errorPrompt="This file type is not supported" formats="PNG, JPEG, WebP, AVIF, GIF, SVG, HTML" browseLabel="Choose files" />
          </Cell>
          <Cell label={`live${picked.length ? ` · ${picked.join(", ")}` : ""}`}>
            <ImportDropzone
              multiple
              accept={["image/*", ".html"]}
              prompt="Drop files or paste with Ctrl V"
              draggingPrompt="Drop to import into Cover"
              errorPrompt="This file type is not supported"
              formats="PNG, JPEG, WebP, AVIF, GIF, SVG, HTML"
              browseLabel="Choose files"
              onValueChange={(files) => setPicked(files.map((f) => f.name))}
            />
          </Cell>
        </Specimen>
      </Grid>
      <Specimen label="Imported file · states" note="280 × 52, radius 6, 32 px type tile with a field border, name 13/600 and detail 12 muted, state at the right: percentage while uploading (a progressbar), 20 px check, warning or cross.">
        <Cell label="uploading">
          <ImportedFile status="uploading" name="hero.png" detail="PNG · 2400 × 1350" progress={62} statusLabel="Uploading" progressLabel="Uploading hero.png" />
        </Cell>
        <Cell label="done">
          <ImportedFile status="done" name="logo.svg" detail="SVG · 14 layers" statusLabel="Imported" />
        </Cell>
        <Cell label="warning">
          <ImportedFile status="warning" name="landing.html" detail="2 warnings: script ignored" statusLabel="Imported with warnings" />
        </Cell>
        <Cell label="error">
          <ImportedFile status="error" name="briefing.pdf" detail="PDF is not imported" statusLabel="Failed" />
        </Cell>
      </Specimen>
      <Specimen label="Empty illustration · cases and scales" note="160 × 120 in brand pixels (radius 3.5). Positive cases in full colour, negative ones neutral with one stray coloured pixel. Scales 1, 0.75 and 0.5 shown for each.">
        {kinds.map(({ kind, label, tone }) => (
          <div key={kind} className="flex flex-col gap-3 rounded-lg border border-line bg-bg p-4">
            <span className="text-sm font-semibold">{label} · {tone}</span>
            <div className="flex items-end gap-6">
              {[1, 0.75, 0.5].map((s) => (
                <Cell key={s} label={`${160 * s} × ${120 * s}`}>
                  <EmptyIllustration kind={kind} scale={s} title={s === 1 ? label : undefined} />
                </Cell>
              ))}
            </div>
          </div>
        ))}
      </Specimen>
    </>
  );
}
