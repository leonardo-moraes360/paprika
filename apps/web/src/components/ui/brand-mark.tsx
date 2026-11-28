import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const stem = "M47 0.899 H53 Q56.5 0.899 56.5 4.399 V10.399 Q56.5 13.899 53 13.899 H47 Q43.5 13.899 43.5 10.399 V4.399 Q43.5 0.899 47 0.899 Z";
const yellow = "M19 16.4 H19 Q25.5 16.4 25.5 22.9 V22.9 Q25.5 29.4 19 29.4 H19 Q12.5 29.4 12.5 22.9 V22.9 Q12.5 16.4 19 16.4 Z M16 31.9 H22 Q25.5 31.9 25.5 35.4 V41.4 Q25.5 44.9 22 44.9 H16 Q12.5 44.9 12.5 41.4 V35.4 Q12.5 31.9 16 31.9 Z M16 47.4 H22 Q25.5 47.4 25.5 50.9 V56.9 Q25.5 60.4 22 60.4 H16 Q12.5 60.4 12.5 56.9 V50.9 Q12.5 47.4 16 47.4 Z M16 62.9 H22 Q25.5 62.9 25.5 66.4 V72.4 Q25.5 75.9 22 75.9 H16 Q12.5 75.9 12.5 72.4 V66.4 Q12.5 62.9 16 62.9 Z M19 78.4 H19 Q25.5 78.4 25.5 84.9 V84.9 Q25.5 91.4 19 91.4 H19 Q12.5 91.4 12.5 84.9 V84.9 Q12.5 78.4 19 78.4 Z";
const red = "M31.5 16.4 H37.5 Q41 16.4 41 19.9 V25.9 Q41 29.4 37.5 29.4 H31.5 Q28 29.4 28 25.9 V19.9 Q28 16.4 31.5 16.4 Z M47 16.4 H53 Q56.5 16.4 56.5 19.9 V25.9 Q56.5 29.4 53 29.4 H47 Q43.5 29.4 43.5 25.9 V19.9 Q43.5 16.4 47 16.4 Z M62.5 16.4 H68.5 Q72 16.4 72 19.9 V25.9 Q72 29.4 68.5 29.4 H62.5 Q59 29.4 59 25.9 V19.9 Q59 16.4 62.5 16.4 Z M47 31.9 H53 Q56.5 31.9 56.5 35.4 V41.4 Q56.5 44.9 53 44.9 H47 Q43.5 44.9 43.5 41.4 V35.4 Q43.5 31.9 47 31.9 Z M62.5 31.9 H68.5 Q72 31.9 72 35.4 V41.4 Q72 44.9 68.5 44.9 H62.5 Q59 44.9 59 41.4 V35.4 Q59 31.9 62.5 31.9 Z M31.5 47.4 H37.5 Q41 47.4 41 50.9 V56.9 Q41 60.4 37.5 60.4 H31.5 Q28 60.4 28 56.9 V50.9 Q28 47.4 31.5 47.4 Z M47 47.4 H53 Q56.5 47.4 56.5 50.9 V56.9 Q56.5 60.4 53 60.4 H47 Q43.5 60.4 43.5 56.9 V50.9 Q43.5 47.4 47 47.4 Z M62.5 47.4 H68.5 Q72 47.4 72 50.9 V56.9 Q72 60.4 68.5 60.4 H62.5 Q59 60.4 59 56.9 V50.9 Q59 47.4 62.5 47.4 Z M31.5 62.9 H37.5 Q41 62.9 41 66.4 V72.4 Q41 75.9 37.5 75.9 H31.5 Q28 75.9 28 72.4 V66.4 Q28 62.9 31.5 62.9 Z M47 62.9 H53 Q56.5 62.9 56.5 66.4 V72.4 Q56.5 75.9 53 75.9 H47 Q43.5 75.9 43.5 72.4 V66.4 Q43.5 62.9 47 62.9 Z M62.5 62.9 H68.5 Q72 62.9 72 66.4 V72.4 Q72 75.9 68.5 75.9 H62.5 Q59 75.9 59 72.4 V66.4 Q59 62.9 62.5 62.9 Z M50 78.4 H50 Q56.5 78.4 56.5 84.9 V84.9 Q56.5 91.4 50 91.4 H50 Q43.5 91.4 43.5 84.9 V84.9 Q43.5 78.4 50 78.4 Z";
const green = "M81 16.4 H81 Q87.5 16.4 87.5 22.9 V22.9 Q87.5 29.4 81 29.4 H81 Q74.5 29.4 74.5 22.9 V22.9 Q74.5 16.4 81 16.4 Z M78 31.9 H84 Q87.5 31.9 87.5 35.4 V41.4 Q87.5 44.9 84 44.9 H78 Q74.5 44.9 74.5 41.4 V35.4 Q74.5 31.9 78 31.9 Z M78 47.4 H84 Q87.5 47.4 87.5 50.9 V56.9 Q87.5 60.4 84 60.4 H78 Q74.5 60.4 74.5 56.9 V50.9 Q74.5 47.4 78 47.4 Z M78 62.9 H84 Q87.5 62.9 87.5 66.4 V72.4 Q87.5 75.9 84 75.9 H78 Q74.5 75.9 74.5 72.4 V66.4 Q74.5 62.9 78 62.9 Z M81 78.4 H81 Q87.5 78.4 87.5 84.9 V84.9 Q87.5 91.4 81 91.4 H81 Q74.5 91.4 74.5 84.9 V84.9 Q74.5 78.4 81 78.4 Z";
const glow = "M31.5 31.9 H37.5 Q41 31.9 41 35.4 V41.4 Q41 44.9 37.5 44.9 H31.5 Q28 44.9 28 41.4 V35.4 Q28 31.9 31.5 31.9 Z";
const frame = "M8.5 12.399 H91.5 Q91.5 12.399 91.5 12.399 V95.4 Q91.5 95.4 91.5 95.4 H8.5 Q8.5 95.4 8.5 95.4 V12.399 Q8.5 12.399 8.5 12.399 Z";
const handles = "M6.5 9.399 H10.5 Q11.5 9.399 11.5 10.399 V14.399 Q11.5 15.399 10.5 15.399 H6.5 Q5.5 15.399 5.5 14.399 V10.399 Q5.5 9.399 6.5 9.399 Z M89.5 9.399 H93.5 Q94.5 9.399 94.5 10.399 V14.399 Q94.5 15.399 93.5 15.399 H89.5 Q88.5 15.399 88.5 14.399 V10.399 Q88.5 9.399 89.5 9.399 Z M6.5 92.4 H10.5 Q11.5 92.4 11.5 93.4 V97.4 Q11.5 98.4 10.5 98.4 H6.5 Q5.5 98.4 5.5 97.4 V93.4 Q5.5 92.4 6.5 92.4 Z M89.5 92.4 H93.5 Q94.5 92.4 94.5 93.4 V97.4 Q94.5 98.4 93.5 98.4 H89.5 Q88.5 98.4 88.5 97.4 V93.4 Q88.5 92.4 89.5 92.4 Z";
const wordmark = "M0 0 L0 150 M0 50 A50 50 0 1 0 100 50 A50 50 0 1 0 0 50 Z M154 50 A50 50 0 1 0 254 50 A50 50 0 1 0 154 50 Z M254 0 L254 100 M308 0 L308 150 M308 50 A50 50 0 1 0 408 50 A50 50 0 1 0 308 50 Z M462 100 L462 0 M462 55 Q462 0 517 0 M560.2 0 L560.2 100 M614.2 -50 L614.2 100 M684.2 0 L614.2 62 M636.2 42 L686.2 100 M740.2 50 A50 50 0 1 0 840.2 50 A50 50 0 1 0 740.2 50 Z M840.2 0 L840.2 100";
const dot = "M554.2 -64 H566.2 Q578.2 -64 578.2 -52 V-40 Q578.2 -28 566.2 -28 H554.2 Q542.2 -28 542.2 -40 V-52 Q542.2 -64 554.2 -64 Z";

export type BrandMarkProps = Omit<ComponentProps<"svg">, "children" | "viewBox" | "width" | "height"> & {
  variant?: "lockup" | "symbol";
  height?: number;
  selection?: boolean;
  label?: string;
};

export function BrandMark({ className, variant = "lockup", height = 24, selection, label, ...props }: BrandMarkProps) {
  const lockup = variant === "lockup";
  const width = lockup ? (height * 505.55) / 128 : height;
  const showSelection = selection ?? height >= 32;
  return (
    <svg
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      viewBox={lockup ? "0 0 505.55 128" : "0 0 128 128"}
      width={width}
      height={height}
      className={cn("shrink-0", className)}
      {...props}
    >
      <g transform="scale(1.28)">
        <path d={stem} className="fill-stem" />
        <path d={yellow} className="fill-yellow" />
        <path d={red} className="fill-red" />
        <path d={green} className="fill-green" />
        <path d={glow} className="fill-glow" />
        {showSelection ? (
          <>
            <path d={frame} fill="none" strokeWidth={1.6} strokeLinejoin="round" className="stroke-select-brand" />
            <path d={handles} strokeWidth={1.4} strokeLinejoin="round" className="fill-panel stroke-select-brand" />
          </>
        ) : null}
      </g>
      {lockup ? (
        <g transform="translate(151.26 43.31) scale(0.413793)">
          <path d={wordmark} fill="none" strokeWidth={24} strokeLinecap="round" strokeLinejoin="round" className="stroke-fg" />
          <path d={dot} className="fill-yellow" />
        </g>
      ) : null}
    </svg>
  );
}
