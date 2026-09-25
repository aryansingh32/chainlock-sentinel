import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import {
  Camera,
  ChevronLeft,
  ChevronRight,
  Download,
  FingerprintPattern,
  Flashlight,
  Lock,
  LockKeyhole,
  Printer,
  RotateCcw,
  ShieldCheck,
  TriangleAlert,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  OPEN_STEPS,
  hms,
  openDocument,
  printDocument,
  useApp,
  useSession,
  type OpenedSession,
  type StepState,
} from "@/lib/app";
import { codewordHash } from "@/lib/engine/tardos";
import {
  blueTorch,
  degrade,
  renderPageCanvas,
  stackPages,
  type DocMeta,
} from "@/lib/engine/render";
import { cn } from "@/lib/utils";
import {
  Badge,
  CanvasView,
  Hash,
  Kv,
  Mono,
  PageHeader,
  Panel,
  PieceGrid,
  canvasToBlob,
  classificationTone,
  download,
} from "@/components/cl/ui";

const PURPOSES = [
  "operational briefing",
  "planning cell review",
  "watch handover",
  "readiness review",
];

export function ViewerPage() {
  const { docId } = useParams({ strict: false }) as { docId?: string };
  const session = useSession();
  const docs = useApp((s) => s.documents);
  const officers = useApp((s) => s.officers);
  const doc = docs.find((d) => d.id === docId) ?? docs[0]!;
  const me = officers.find((o) => o.id === session.officerId);
  const [purpose, setPurpose] = useState(PURPOSES[0]!);
  const [steps, setSteps] = useState<StepState[]>(() =>
    OPEN_STEPS.map(() => ({ status: "pending", lines: [] })),
  );
  const [sess, setSess] = useState<OpenedSession | null>(null);
  const [running, setRunning] = useState(false);
  const [page, setPage] = useState(0);
  const [filled, setFilled] = useState(0);
  const [pattern, setPattern] = useState<number[] | undefined>(undefined);
  const [printOut, setPrintOut] = useState<{
    canvas: HTMLCanvasElement;
    recordIndex: number;
    dotIndex: string;
    time: string;
    codeword: number[];
  } | null>(null);
  const [torch, setTorch] = useState(false);
  const started = useRef<string | null>(null);
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
  const failed = steps.some((s) => s.status === "failed");
  const current = steps.findIndex((s) => s.status === "running");

  const start = async () => {
    if (!me) return;
    setRunning(true);
    setSess(null);
    setFilled(0);
    setPattern(undefined);
    setSteps(OPEN_STEPS.map(() => ({ status: "pending", lines: [] })));
    const res = await openDocument(doc.id, me.id, purpose, (i, st) =>
      setSteps((prev) => prev.map((p, k) => (k === i ? st : p))),
    );
    if (res) {
      setPattern(res.codeword);
      // animate the 320 A/B key pieces
      for (let f = 0; f <= 320; f += 16) {
        setFilled(f);
        await new Promise((r) => setTimeout(r, 22));
      }
      setSess(res);
      setPage(0);
      toast.success(`${doc.id} opened · ledger record #${res.recordIndex}`, {
        description: "Personalised copy rendered in memory",
      });
    } else toast.error("Access denied — document remains locked");
    setRunning(false);
  };

  useEffect(() => {
    if (started.current === doc.id || !me) return;
    started.current = doc.id;
    void start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.id, me?.id]);

  // Close wipes the in-memory session when leaving the page.
  useEffect(() => () => setSess(null), []);

  const pageCanvas = useMemo(
    () => (sess ? renderPageCanvas(meta, page, sess.codeword) : null),
    [sess, page, meta],
  );

  const close = () => {
    setSess(null);
    setSteps(OPEN_STEPS.map(() => ({ status: "pending", lines: [] })));
    setFilled(0);
    setPattern(undefined);
    started.current = doc.id;
    toast.success("Session closed · keys zeroised · render buffer wiped", {
      description: "Nothing was written to disk.",
    });
  };

  const print = async () => {
    if (!sess) return;
    try {
      const r = await printDocument(sess);
      const canvas = renderPageCanvas(meta, 2, r.codeword, {
        dotIndex: parseInt(r.dotIndex, 16),
        mic: {
          serial: "00654321",
          hh: Number(r.time.slice(11, 13)),
          mm: Number(r.time.slice(14, 16)),
          day: 24,
          month: 9,
          year: 2026,
        },
      });
      setPrintOut({
        canvas,
        recordIndex: r.record.index,
        dotIndex: r.dotIndex,
        time: r.time,
        codeword: r.codeword,
      });
      toast.success(`PRINT committed · ledger #${r.record.index}`, {
        description: "Fresh mark variant + microdot index for this physical copy",
      });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const exportLeak = async (kind: "pdf" | "photo") => {
    if (!sess) return;
    const pages =
      kind === "pdf"
        ? Array.from({ length: 10 }, (_, p) => renderPageCanvas(meta, p, sess.codeword))
        : [renderPageCanvas(meta, 2, sess.codeword)];
    const img =
      kind === "pdf"
        ? stackPages(pages)
        : degrade(pages[0]!, { noise: 18, blur: 0.6, tint: [6, 2, -8], scale: 0.9 });
    const blob = await canvasToBlob(img, kind === "pdf" ? "image/png" : "image/jpeg", 0.92);
    download(`leak-${doc.id}-${sess.officer}-${kind}.${kind === "pdf" ? "png" : "jpg"}`, blob);
    toast.message("Leak simulation exported", {
      description: "Drop this file into Trace a Leak to test attribution.",
    });
  };

  return (
    <>
      <PageHeader
        eyebrow={`Officer / controlled viewer / ${doc.id}`}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {doc.title}{" "}
            <Badge tone={classificationTone(doc.classification)}>{doc.classification}</Badge>
          </span>
        }
        sub={`${doc.sender} · ${doc.pages} pages · 320 segments · package ${doc.packageHash.slice(0, 12)}…`}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/inbox">
                <ChevronLeft /> Inbox
              </Link>
            </Button>
            <Button variant="outline" onClick={() => void start()} disabled={running}>
              <RotateCcw /> New session
            </Button>
            <Button variant="outline" onClick={print} disabled={!sess}>
              <Printer /> Print via gateway
            </Button>
            <Button variant="destructive" onClick={close} disabled={!sess}>
              <X /> Close & wipe
            </Button>
          </>
        }
      />

      <div className="mb-4 flex items-center gap-3 rounded-[10px] border border-destructive/40 bg-destructive/8 px-4 py-2.5 text-[14px] font-semibold text-destructive">
        <LockKeyhole className="size-4.5 shrink-0" /> No ledger record → no keys → no document.
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(340px,0.9fr)]">
        <Panel
          title="Access protocol — handbook §4.3 / §4.4"
          right={
            <div className="flex items-center gap-2">
              <select
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                className="h-7 rounded-md border bg-background px-2 text-[12px]"
                disabled={running}
              >
                {PURPOSES.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </div>
          }
        >
          <ol className="grid gap-2">
            {OPEN_STEPS.map((st, i) => {
              const s = steps[i]!;
              return (
                <li
                  key={st.title}
                  className={cn(
                    "rounded-lg border px-3 py-2.5 transition-colors",
                    s.status === "running" && "border-primary bg-primary/5",
                    s.status === "done" && "border-success/40",
                    s.status === "failed" && "border-destructive bg-destructive/8",
                  )}
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={cn(
                        "grid size-6 shrink-0 place-items-center rounded-full border text-[11px] font-bold",
                        s.status === "done" && "border-success bg-success text-white",
                        s.status === "running" &&
                          "pulse border-primary bg-primary text-primary-foreground",
                        s.status === "failed" && "border-destructive bg-destructive text-white",
                      )}
                    >
                      {s.status === "done" ? "✓" : s.status === "failed" ? "✕" : i + 1}
                    </span>
                    <div className="min-w-0">
                      <div className="text-[13.5px] font-semibold">{st.title}</div>
                      <div className="text-[12px] text-muted-foreground">{st.sub}</div>
                    </div>
                  </div>
                  {s.lines.length > 0 && (
                    <div className="mono mt-2 grid gap-0.5 pl-9 text-[11.5px] text-muted-foreground">
                      {s.lines.map((l, k) => (
                        <div
                          key={k}
                          className={cn(
                            "fade-in break-all",
                            s.status === "failed" &&
                              k === s.lines.length - 1 &&
                              "font-semibold text-destructive",
                          )}
                        >
                          {l}
                        </div>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
          {!me?.id || !doc.recipients.includes(me.id) ? (
            <div className="mt-3 text-[12.5px] text-muted-foreground">
              {me?.id} is not a recipient of {doc.id}. The chaincode will reject the request — try
              it to see the refusal.
            </div>
          ) : null}
        </Panel>

        <div className="grid content-start gap-4">
          <Panel
            title="Key pieces released — this session’s A/B pattern"
            right={<Mono className="text-muted-foreground">{Math.min(filled, 320)}/320</Mono>}
          >
            <PieceGrid bits={pattern} filled={failed ? 0 : filled} />
            <div className="mt-2 flex items-center gap-4 text-[11.5px] text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <i className="inline-block size-2.5 rounded-[2px] bg-[#1f4e79]" /> variant A
              </span>
              <span className="flex items-center gap-1.5">
                <i className="inline-block size-2.5 rounded-[2px] bg-[#e8792b]" /> variant B
              </span>
              <span>640 locked · 320 openable · pattern = fingerprint</span>
            </div>
          </Panel>
          <Panel title="Session control">
            <Kv
              rows={[
                ["Officer", me ? `${me.id} · ${me.rank} ${me.name}` : "—"],
                ["Device", <Mono key="d">{me?.device}</Mono>],
                ["Purpose", purpose],
                ["Session nonce", sess ? <Mono key="n">0x{sess.nonce}</Mono> : "—"],
                [
                  "Ledger record",
                  sess ? (
                    <Link key="l" to="/ledger" className="text-primary underline">
                      #{sess.recordIndex} · checkpoint {sess.checkpointSize}
                    </Link>
                  ) : (
                    "—"
                  ),
                ],
                [
                  "Signature",
                  sess ? (
                    <Mono key="s">
                      {sess.sigAlg.split(" ")[0]} · {sess.sigBytes.toLocaleString()} B
                    </Mono>
                  ) : (
                    "—"
                  ),
                ],
                [
                  "Codeword hash",
                  sess ? <Hash key="c" value={codewordHash(sess.codeword)} /> : "—",
                ],
                ["Canary token", sess ? <Mono key="t">{sess.canary}</Mono> : "—"],
                [
                  "Storage",
                  <Badge key="r" tone="good">
                    RAM only
                  </Badge>,
                ],
              ]}
            />
            <div className="mt-3 flex gap-2.5 rounded-lg bg-muted/60 p-3 text-[12.5px]">
              <FingerprintPattern className="mt-0.5 size-4 shrink-0 text-primary" />
              <div>
                <b>The decryption itself is the watermark.</b> This device only ever holds the key
                to one of two variants per segment, so no unmarked copy exists here — not even for a
                microsecond. Four layers carry the pattern: line shift, word shift, background
                micro-pattern
                {doc.layer4
                  ? ", lexical variants (prose only)"
                  : " (lexical layer disabled for orders)"}
                .
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={!sess}
                onClick={() => void exportLeak("pdf")}
              >
                <Download /> Simulate leak (10-page PNG)
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!sess}
                onClick={() => void exportLeak("photo")}
              >
                <Camera /> Simulate phone photo p3
              </Button>
            </div>
          </Panel>
        </div>
      </div>

      <Panel
        className="mt-4"
        title={sess ? `Rendered copy — page ${page + 1} of 10 (memory buffer)` : "Document"}
        right={
          sess && (
            <div className="flex items-center gap-1">
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                aria-label="Previous page"
              >
                <ChevronLeft />
              </Button>
              {Array.from({ length: 10 }, (_, i) => (
                <button
                  key={i}
                  onClick={() => setPage(i)}
                  className={cn(
                    "mono size-7 rounded-md text-[11px]",
                    i === page ? "bg-primary text-primary-foreground" : "hover:bg-muted",
                  )}
                >
                  {i + 1}
                </button>
              ))}
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setPage((p) => Math.min(9, p + 1))}
                aria-label="Next page"
              >
                <ChevronRight />
              </Button>
            </div>
          )
        }
      >
        {sess && pageCanvas ? (
          <div
            className="mx-auto max-w-[840px] overflow-hidden rounded-md border shadow-sm select-none"
            onContextMenu={(e) => e.preventDefault()}
          >
            <CanvasView canvas={pageCanvas} alt={`${doc.id} page ${page + 1}`} />
          </div>
        ) : failed ? (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <Lock className="size-10 text-destructive" />
            <div className="text-[15px] font-semibold text-destructive">DOCUMENT LOCKED</div>
            <div className="max-w-md text-[13px] text-muted-foreground">
              {steps.find((s) => s.status === "failed")?.lines.at(-1)}
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 py-16 text-center text-muted-foreground">
            {running ? (
              <ShieldCheck className="pulse size-10 text-primary" />
            ) : (
              <Lock className="size-10" />
            )}
            <div className="text-[13px]">
              {running
                ? `Step ${current + 1} of 6 — ${OPEN_STEPS[Math.max(0, current)]?.title}`
                : "Closed. Start a new session to request access."}
            </div>
          </div>
        )}
      </Panel>

      <Dialog open={!!printOut} onOpenChange={(o) => !o && setPrintOut(null)}>
        <DialogContent className="max-w-[760px]">
          <DialogHeader>
            <DialogTitle>Printed via SENTINEL print gateway</DialogTitle>
            <DialogDescription>
              Ledger record #{printOut?.recordIndex} at {printOut ? hms(printOut.time) : ""}Z ·
              fresh session variant · microdot ledger index 0x{printOut?.dotIndex} · printer serial
              00654321
            </DialogDescription>
          </DialogHeader>
          {printOut && (
            <>
              <div className="max-h-[52vh] overflow-auto rounded-md border">
                <CanvasView
                  canvas={torch ? blueTorch(printOut.canvas) : printOut.canvas}
                  alt="printed page 3"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant={torch ? "default" : "outline"} onClick={() => setTorch((t) => !t)}>
                  <Flashlight /> {torch ? "Torch off" : "Shine blue torch"}
                </Button>
                <Button
                  variant="outline"
                  onClick={async () => {
                    const scan = degrade(printOut.canvas, {
                      noise: 14,
                      blur: 0.4,
                      tint: [4, 4, -4],
                    });
                    download(`scan-printout-${doc.id}-p3.png`, await canvasToBlob(scan));
                    toast.message("Scan of printout exported", {
                      description: "Drop into Trace a Leak — both microdot grids decode.",
                    });
                  }}
                >
                  <Download /> Export scan of printout
                </Button>
              </div>
              <div className="flex items-start gap-2 text-[12px] text-muted-foreground">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" /> Yellow dots top margin: our
                opaque ledger index (meaningless without ledger access, unforgeable). Bottom margin:
                simulated manufacturer MIC (serial + time).
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
