import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Eye, EyeOff, Merge } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useApp } from "@/lib/app";
import { LINES_PER_PAGE } from "@/lib/engine/content";
import {
  PAGE_H,
  PAGE_W,
  bandTop,
  makeCanvas,
  pageBits,
  renderPageCanvas,
  type DocMeta,
} from "@/lib/engine/render";
import { fullCodeword } from "@/lib/engine/trace";
import { cn } from "@/lib/utils";
import { Badge, CanvasView, Mono, PageHeader, Panel, PieceGrid } from "@/components/cl/ui";

function diffCanvas(a: HTMLCanvasElement, b: HTMLCanvasElement) {
  const c = makeCanvas(PAGE_W, PAGE_H);
  const ctx = c.getContext("2d")!;
  const da = a.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, PAGE_W, PAGE_H);
  const db = b
    .getContext("2d", { willReadFrequently: true })!
    .getImageData(0, 0, PAGE_W, PAGE_H).data;
  const out = ctx.createImageData(PAGE_W, PAGE_H);
  let changed = 0;
  for (let i = 0; i < da.data.length; i += 4) {
    const d =
      Math.abs(da.data[i]! - db[i]!) +
      Math.abs(da.data[i + 1]! - db[i + 1]!) +
      Math.abs(da.data[i + 2]! - db[i + 2]!);
    const g = 0.3 * da.data[i]! + 0.59 * da.data[i + 1]! + 0.11 * da.data[i + 2]!;
    if (d > 24) {
      changed++;
      out.data[i] = 220;
      out.data[i + 1] = 30;
      out.data[i + 2] = 30;
    } else {
      const v = 255 - (255 - g) * 0.22;
      out.data[i] = v;
      out.data[i + 1] = v;
      out.data[i + 2] = v;
    }
    out.data[i + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);
  return { canvas: c, changed };
}

export function ComparePage() {
  const docs = useApp((s) => s.documents);
  const ledger = useApp((s) => s.ledger);
  const officers = useApp((s) => s.officers);
  const [docId, setDocId] = useState("DOC-007");
  const doc = docs.find((d) => d.id === docId) ?? docs[0]!;
  const [left, setLeft] = useState("OFF-002");
  const [right, setRight] = useState("OFF-004");
  const [page, setPage] = useState(2);
  const [reveal, setReveal] = useState(false);
  const meta: DocMeta = useMemo(
    () => ({
      id: doc.id,
      title: doc.title,
      classification: doc.classification,
      layer4: doc.layer4,
      customText: doc.customText,
    }),
    [doc],
  );

  const cw = (officer: string) => {
    const s = [...ledger]
      .reverse()
      .find((r) => r.docId === doc.id && r.actor === officer && r.type === "DECRYPT");
    return { cw: fullCodeword(doc, officer, s?.sessionNonce ?? "0000000000000000"), rec: s?.index };
  };
  const L = useMemo(() => cw(left), [left, doc, ledger]); // eslint-disable-line react-hooks/exhaustive-deps
  const R = useMemo(() => cw(right), [right, doc, ledger]); // eslint-disable-line react-hooks/exhaustive-deps
  const ca = useMemo(() => renderPageCanvas(meta, page, L.cw), [meta, page, L]);
  const cb = useMemo(() => renderPageCanvas(meta, page, R.cw), [meta, page, R]);
  const diff = useMemo(() => (reveal ? diffCanvas(ca, cb) : null), [reveal, ca, cb]);
  const diffs = L.cw.map((b, i) => b !== R.cw[i]);
  const nDiff = diffs.filter(Boolean).length;
  const bitsL = pageBits(doc.id, page, L.cw);
  const bitsR = pageBits(doc.id, page, R.cw);
  const pageDiff = bitsL.filter((b, i) => b !== bitsR[i]).length;

  const select = (v: string, set: (s: string) => void) => (
    <select
      value={v}
      onChange={(e) => set(e.target.value)}
      className="h-8 rounded-md border bg-background px-2 text-[13px]"
    >
      {doc.recipients.map((r) => {
        const o = officers.find((x) => x.id === r);
        return (
          <option key={r} value={r}>
            {r} · {o?.name}
          </option>
        );
      })}
    </select>
  );

  return (
    <>
      <PageHeader
        eyebrow="Investigation / copy differential"
        title="Compare Controlled Copies"
        sub="Two officers’ copies of the same page. Put them side by side — they look identical. The computer sees 32 marked segments per page."
        actions={
          <>
            <select
              value={docId}
              onChange={(e) => setDocId(e.target.value)}
              className="h-9 rounded-md border bg-background px-2 text-[13px]"
            >
              {docs.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.id} · {d.title}
                </option>
              ))}
            </select>
            <Button onClick={() => setReveal((v) => !v)} variant={reveal ? "default" : "outline"}>
              {reveal ? <EyeOff /> : <Eye />} {reveal ? "Hide" : "Reveal"} machine differences
            </Button>
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-[12px] text-muted-foreground">Page</span>
        {Array.from({ length: 10 }, (_, i) => (
          <button
            key={i}
            onClick={() => setPage(i)}
            className={cn(
              "mono size-7 rounded-md border text-[11px]",
              i === page ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted",
            )}
          >
            {i + 1}
          </button>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {[
          { label: "A", who: left, set: setLeft, c: ca, rec: L.rec, bits: bitsL },
          { label: "B", who: right, set: setRight, c: cb, rec: R.rec, bits: bitsR },
        ].map((x, side) => (
          <Panel key={x.label} title={`Copy ${x.label}`} right={select(x.who, x.set)}>
            <div className="relative mx-auto max-w-[560px] overflow-hidden rounded-md border">
              <CanvasView canvas={reveal && side === 1 && diff ? diff.canvas : x.c} />
              {reveal &&
                Array.from({ length: LINES_PER_PAGE }, (_, j) => (
                  <span
                    key={j}
                    className={cn(
                      "mono absolute left-1 rounded px-1 text-[8px] font-bold text-white",
                      x.bits[j] ? "bg-saffron" : "bg-navy",
                      x.bits[j] !== (side ? bitsL : bitsR)[j] && "ring-2 ring-destructive",
                    )}
                    style={{ top: `${((bandTop(j) + 8) / PAGE_H) * 100}%` }}
                  >
                    {x.bits[j] ? "B" : "A"}
                  </span>
                ))}
            </div>
            <div className="mt-2 flex items-center justify-between text-[12px] text-muted-foreground">
              <span>
                session from ledger {x.rec ? `#${x.rec}` : "— (no session yet; Tardos part only)"}
              </span>
              {reveal && side === 1 && diff && (
                <Mono>{diff.changed.toLocaleString()} px differ (amplified red)</Mono>
              )}
            </div>
          </Panel>
        ))}
      </div>
      <div className="my-5 text-center text-[20px] font-semibold tracking-tight">
        Identical to people. <span className="text-saffron">Unique to the computer.</span>
      </div>
      <Panel
        title="320-segment fingerprints"
        right={
          <Badge tone="navy">
            {nDiff} of 320 positions differ · {pageDiff}/32 on this page
          </Badge>
        }
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <div className="mb-1.5 text-[12.5px] font-medium">A · {left}</div>
            <PieceGrid bits={L.cw} diff={reveal ? diffs : undefined} />
          </div>
          <div>
            <div className="mb-1.5 text-[12.5px] font-medium">B · {right}</div>
            <PieceGrid bits={R.cw} diff={reveal ? diffs : undefined} />
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/60 p-3 text-[12.5px]">
          <span>
            <b>Collusion:</b> if these two officers compare copies they learn where the marks are
            and can splice them — the Tardos code still names both.
          </span>
          <Button asChild size="sm" variant="outline">
            <Link to="/trace">
              <Merge /> Try the merged-copy attack
            </Link>
          </Button>
        </div>
      </Panel>
    </>
  );
}
