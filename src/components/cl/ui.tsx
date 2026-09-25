import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type Tone = "good" | "warn" | "bad" | "navy" | "neutral";

export function Badge({
  tone = "neutral",
  children,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return <span className={cn("badge", `badge-${tone}`, className)}>{children}</span>;
}

export function PageHeader({
  eyebrow,
  title,
  sub,
  actions,
}: {
  eyebrow: string;
  title: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <div className="eyebrow">{eyebrow}</div>
        <h1 className="mt-1 text-[22px] font-semibold tracking-tight">{title}</h1>
        {sub && <p className="mt-1 max-w-3xl text-[13px] text-muted-foreground">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Panel({
  title,
  right,
  children,
  className,
  pad = true,
}: {
  title?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  pad?: boolean;
}) {
  return (
    <section className={cn("panel min-w-0", className)}>
      {(title || right) && (
        <div className="flex items-center justify-between gap-3 border-b px-4 py-2.5">
          <div className="eyebrow">{title}</div>
          {right}
        </div>
      )}
      <div className={cn(pad && "p-4")}>{children}</div>
    </section>
  );
}

export function Metric({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: Tone;
}) {
  const col =
    tone === "good"
      ? "text-success"
      : tone === "bad"
        ? "text-destructive"
        : tone === "warn"
          ? "text-warning"
          : tone === "navy"
            ? "text-primary"
            : "";
  return (
    <div className="panel px-4 py-3">
      <div className="eyebrow">{label}</div>
      <div className={cn("mt-1 text-[22px] font-semibold tabular-nums", col)}>{value}</div>
      {sub && <div className="mt-0.5 text-[12px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

export function Mono({
  children,
  className,
  title,
}: {
  children: ReactNode;
  className?: string | undefined;
  title?: string | undefined;
}) {
  return (
    <span className={cn("mono", className)} title={title}>
      {children}
    </span>
  );
}

export function Hash({
  value,
  n = 10,
  className,
}: {
  value: string | undefined;
  n?: number;
  className?: string;
}) {
  if (!value) return <Mono className="text-muted-foreground">—</Mono>;
  return (
    <Mono className={className} title={value}>
      {value.length > n * 2 ? `${value.slice(0, n)}…${value.slice(-4)}` : value}
    </Mono>
  );
}

export function Kv({ rows, className }: { rows: [ReactNode, ReactNode][]; className?: string }) {
  return (
    <dl
      className={cn(
        "grid grid-cols-[minmax(110px,auto)_1fr] gap-x-4 gap-y-1.5 text-[13px]",
        className,
      )}
    >
      {rows.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="min-w-0 break-words">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Empty({
  icon,
  title,
  sub,
  action,
}: {
  icon?: ReactNode;
  title: string;
  sub?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      {icon && <div className="text-muted-foreground [&_svg]:size-8">{icon}</div>}
      <div className="font-medium">{title}</div>
      {sub && <div className="max-w-md text-[13px] text-muted-foreground">{sub}</div>}
      {action}
    </div>
  );
}

export function Callout({
  tone = "navy",
  icon,
  title,
  children,
  className,
}: {
  tone?: Tone;
  icon?: ReactNode;
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const border =
    tone === "bad"
      ? "border-l-destructive"
      : tone === "good"
        ? "border-l-success"
        : tone === "warn"
          ? "border-l-warning"
          : "border-l-primary";
  return (
    <div className={cn("panel flex gap-3 border-l-4 px-4 py-3 text-[13px]", border, className)}>
      {icon && <div className="mt-0.5 shrink-0 [&_svg]:size-4.5">{icon}</div>}
      <div className="min-w-0">
        {title && <div className="font-semibold">{title}</div>}
        {children && <div className="text-muted-foreground">{children}</div>}
      </div>
    </div>
  );
}

/** 320 squares — A (navy) / B (saffron) — optionally highlighting diffs or erasures. */
export function PieceGrid({
  bits,
  filled = 320,
  diff,
  className,
  erasedAsX,
}: {
  bits?: number[] | undefined;
  filled?: number;
  diff?: boolean[] | undefined;
  className?: string;
  erasedAsX?: boolean;
}) {
  return (
    <div
      className={cn("pieces", className)}
      role="img"
      aria-label={`${Math.min(filled, 320)} of 320 segments`}
    >
      {Array.from({ length: 320 }, (_, i) => {
        const b = bits?.[i];
        const cls =
          i >= filled
            ? ""
            : b === undefined
              ? "a"
              : b < 0
                ? erasedAsX
                  ? "x"
                  : "erased"
                : b
                  ? "b"
                  : "a";
        return <i key={i} className={cn(cls, diff?.[i] && "diff")} />;
      })}
    </div>
  );
}

/** Mount an existing canvas element into the React tree. */
export function CanvasView({
  canvas,
  className,
  alt,
}: {
  canvas: HTMLCanvasElement | null;
  className?: string;
  alt?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !canvas) return;
    canvas.style.width = "100%";
    canvas.style.height = "auto";
    canvas.style.display = "block";
    canvas.setAttribute("aria-label", alt ?? "document page");
    el.replaceChildren(canvas);
  }, [canvas, alt]);
  return <div ref={ref} className={cn("doc-sheet", className)} />;
}

export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="flex flex-wrap items-center gap-2">
      {steps.map((s, i) => (
        <li key={s} className="flex items-center gap-2">
          <span
            className={cn(
              "grid size-6 place-items-center rounded-full border text-[11px] font-semibold",
              i < current
                ? "border-success bg-success text-white"
                : i === current
                  ? "border-primary bg-primary text-primary-foreground"
                  : "text-muted-foreground",
            )}
          >
            {i + 1}
          </span>
          <span
            className={cn("text-[13px]", i === current ? "font-semibold" : "text-muted-foreground")}
          >
            {s}
          </span>
          {i < steps.length - 1 && <span className="mx-1 h-px w-8 bg-border" />}
        </li>
      ))}
    </ol>
  );
}

export function download(name: string, data: Blob | string, type = "application/json") {
  const blob = typeof data === "string" ? new Blob([data], { type }) : data;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function canvasToBlob(c: HTMLCanvasElement, type = "image/png", q?: number): Promise<Blob> {
  return new Promise((res, rej) =>
    c.toBlob((b) => (b ? res(b) : rej(new Error("encode failed"))), type, q),
  );
}

export const classificationTone = (c: string): Tone =>
  c === "SECRET" ? "bad" : c === "CONFIDENTIAL" ? "navy" : "neutral";
