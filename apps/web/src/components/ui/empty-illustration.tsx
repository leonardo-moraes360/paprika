import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export type EmptyIllustrationKind = "first-use" | "all-done" | "no-results" | "offline";

export type EmptyIllustrationProps = Omit<ComponentProps<"svg">, "children"> & {
  kind: EmptyIllustrationKind;
  scale?: number;
  title?: string;
};

const W = 160;
const H = 120;

function Px({ x, y, s = 14, className, rotate = 0 }: { x: number; y: number; s?: number; className: string; rotate?: number }) {
  return (
    <rect
      x={x}
      y={y}
      width={s}
      height={s}
      rx={s >= 14 ? 3.5 : 2.5}
      className={className}
      transform={rotate ? `rotate(${rotate} ${x + s / 2} ${y + s / 2})` : undefined}
    />
  );
}

const neutral = "fill-surface stroke-field [stroke-width:1]";

function Scene({ kind }: { kind: EmptyIllustrationKind }) {
  if (kind === "first-use") {
    return (
      <>
        <rect x={32} y={20} width={96} height={72} rx={8} className="fill-surface stroke-field [stroke-dasharray:6_4] [stroke-width:1.5]" />
        <Px x={73} y={31} className="fill-red" />
        <Px x={55} y={49} className="fill-red" />
        <Px x={73} y={49} className="fill-glow" />
        <Px x={91} y={49} className="fill-red" />
        <Px x={73} y={67} className="fill-red" />
        <Px x={136} y={10} s={10} className="fill-yellow" />
        <Px x={146} y={28} s={8} className="fill-green" />
        <Px x={16} y={96} s={8} className="fill-select-brand" />
      </>
    );
  }
  if (kind === "all-done") {
    return (
      <>
        <circle cx={80} cy={56} r={32} className="fill-green" />
        <path d="M68 56l7.5 7.5L92 47" fill="none" strokeWidth={4.5} strokeLinecap="round" strokeLinejoin="round" className="stroke-on-green" />
        <Px x={26} y={26} s={10} rotate={18} className="fill-red" />
        <Px x={126} y={18} s={12} rotate={-14} className="fill-yellow" />
        <Px x={128} y={88} s={8} rotate={30} className="fill-glow" />
        <Px x={30} y={88} s={8} className="fill-select-brand" />
        <Px x={144} y={56} s={6} className="fill-stem" />
      </>
    );
  }
  if (kind === "no-results") {
    return (
      <>
        <rect x={100} y={66} width={12} height={36} rx={6} transform="rotate(-45 106 84)" className="fill-muted" />
        <circle cx={72} cy={48} r={29} className="fill-surface stroke-muted [stroke-width:6]" />
        <Px x={55} y={43} s={10} className="fill-field" />
        <Px x={67} y={43} s={10} className="fill-field" />
        <Px x={79} y={43} s={10} className="fill-field" />
        <Px x={20} y={92} s={10} rotate={16} className="fill-red" />
        <Px x={132} y={22} s={8} className={neutral} />
      </>
    );
  }
  const cells: ReadonlyArray<readonly [number, number]> = [
    [0, 0],
    [1, 0],
    [2, 0],
    [0, 1],
    [1, 1],
    [0, 2],
    [1, 2],
    [2, 2],
  ];
  return (
    <>
      {cells.map(([gx, gy]) => (
        <Px key={`${gx}-${gy}`} x={41 + gx * 26} y={14 + gy * 26} s={22} className={neutral} />
      ))}
      <rect x={93} y={40} width={22} height={22} rx={3.5} className="fill-none stroke-field [stroke-dasharray:4_3] [stroke-width:1.5]" />
      <Px x={112} y={92} s={22} rotate={24} className="fill-red" />
      <Px x={140} y={76} s={8} rotate={12} className="fill-yellow" />
    </>
  );
}

export function EmptyIllustration({ kind, scale = 1, title, className, ...props }: EmptyIllustrationProps) {
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width={W * scale}
      height={H * scale}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      data-kind={kind}
      className={cn("shrink-0 forced-color-adjust-none", className)}
      {...props}
    >
      <Scene kind={kind} />
    </svg>
  );
}
