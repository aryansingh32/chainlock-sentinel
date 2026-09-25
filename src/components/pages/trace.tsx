import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Archive,
  Camera,
  Check,
  Crop,
  FileImage,
  Flashlight,
  Loader2,
  Merge,
  Printer,
  ScanLine,
  ShieldCheck,
  TriangleAlert,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { hms, latestCheckpoint, store, useApp } from "@/lib/app";
import { cryptoCore } from "@/lib/engine/crypto-core";
import { canvasFromFile, type ExtractResult } from "@/lib/engine/forensics";
import { checkpointMessage, hashBody, bodyOf, proofFor, requestDigest } from "@/lib/engine/ledger";
import { leafHash, verifyInclusion } from "@/lib/engine/merkle";
import { blueTorch } from "@/lib/engine/render";
import type { TraceResult } from "@/lib/engine/trace";
import {
  SAMPLES,
  createCase,
  makeSample,
  runExtraction,
  runTrace,
  type SampleId,
} from "@/lib/investigate";
import { cn } from "@/lib/utils";
import {
  Badge,
  Callout,
  CanvasView,
  Kv,
  Mono,
  PageHeader,
  Panel,
  PieceGrid,
} from "@/components/cl/ui";

const PHASES = [
  "Normalise artefact",
  "Identify page (pHash)",
  "Extract mark layers",
  "Decode microdots",
  "Tardos accusation",
  "Ledger cross-reference",
];
const ICONS = { pdf: FileImage, print: Printer, merged: Merge, photo: Camera, crop: Crop };

type Check = { label: string; ok: boolean | null };

export function TracePage() {
  const nav = useNavigate();
  const ledger = useApp((s) => s.ledger);
  const [sample, setSample] = useState<SampleId | "upload" | null>(null);
  const [artefact, setArtefact] = useState<{ canvas: HTMLCanvasElement; kind: string } | null>(
    null,
  );
  const [phase, setPhase] = useState(-1);
  const [ex, setEx] = useState<ExtractResult | null>(null);
  const [tr, setTr] = useState<TraceResult | null>(null);
  const [checks, setChecks] = useState<Record<string, Check[]>>({});
  const [torch, setTorch] = useState(false);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);

  const analyse = async (c: HTMLCanvasElement, kind: string, id: SampleId | "upload") => {
    setSample(id);
    setArtefact({ canvas: c, kind });
    setEx(null);
    setTr(null);
    setChecks({});
    setTorch(false);
    setBusy(true);
    setPhase(0);
    await tick(350);
    const result = runExtraction(c);
    for (let p = 1; p <= 3; p++) {
      setPhase(p);
      if (p === 2) setEx(result);
      await tick(420);
    }
    const t = runTrace(result);
    setPhase(4);
    setTr(t);
    await tick(450);
    setPhase(5);
    if (t) await crossReference(t);
    setPhase(6);
    setBusy(false);
    if (!result.docId) toast.error("No protected page recognised in this artefact");
  };

  const crossReference = async (t: TraceResult) => {
    const s = store.get();
    const cp = latestCheckpoint(s);
    const out: Record<string, Check[]> = {};
    const targets = [
      ...t.sessions.map((x) => ({ officer: x.officer, index: x.recordIndex })),
      ...(t.microdotRecord
        ? [{ officer: `${t.microdotRecord.actor} (microdots)`, index: t.microdotRecord.index }]
        : []),
    ];
    for (const { officer, index } of targets) {
      const rec = s.ledger[index - 1]!;
      const off = s.offchain[index];
      const list: Check[] = [
        { label: `Record #${index} hash recomputes`, ok: hashBody(bodyOf(rec)) === rec.hash },
      ];
      if (cp && cp.size >= index) {
        list.push({
          label: `Merkle inclusion in checkpoint ${cp.size}`,
          ok: verifyInclusion(
            index - 1,
            cp.size,
            leafHash(rec.hash),
            proofFor(s.ledger, index - 1, cp.size),
            cp.root,
          ),
        });
        const msg = checkpointMessage(cp.size, cp.root, cp.time);
        let n = 0;
        for (const c of cp.cosigs)
          if (
            await cryptoCore
              .verify(
                c.alg,
                s.witnesses.find((w) => w.id === c.witness)?.keys.slh?.pk ?? "",
                msg,
                c.sig,
              )
              .catch(() => false)
          )
            n++;
        list.push({ label: `Witness co-signatures ${n}/3`, ok: n >= 2 });
      } else list.push({ label: "Not yet checkpointed — will be sealed in bundle", ok: null });
      if (off?.sig && off.request) {
        const v = await cryptoCore
          .verify(off.sig.alg, off.pk ?? "", requestDigest(off.request), off.sig.sig)
          .catch(() => false);
        list.push({ label: `${off.sig.alg.split(" ")[0]} signature by ${rec.actor}`, ok: v });
      }
      out[officer] = list;
      setChecks({ ...out });
    }
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (!f.type.startsWith("image/")) {
      toast.error(
        "Prototype extractor accepts images (PNG/JPG). PDFs are rendered at 600 dpi in production.",
      );
      return;
    }
    const c = await canvasFromFile(f);
    void analyse(c, `Uploaded ${f.name}`, "upload");
  };

  const toCase = async () => {
    if (!ex || !tr || !artefact) return;
    setBusy(true);
    try {
      const c = await createCase({
        ex,
        tr,
        canvas: artefact.canvas,
        kind: artefact.kind,
        sample: sample ?? "upload",
      });
      toast.success(`${c.id} created · evidence bundle sealed`);
      nav({ to: "/evidence/$caseId", params: { caseId: c.id } });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const preview = useMemo(
    () => (artefact ? (torch ? blueTorch(artefact.canvas) : artefact.canvas) : null),
    [artefact, torch],
  );
  const chart =
    tr?.scores.map((s) => ({
      name: s.id,
      score: Number(s.score.toFixed(1)),
      accused: s.accused,
    })) ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Investigation / attribution"
        title="Trace a Leak"
        sub="Feed in a leaked artefact. The extractor reads the hidden pattern from the pixels, scores every recipient, names those above the threshold and states the chance of a mistake."
      />
      <div className="grid gap-4 xl:grid-cols-[minmax(300px,0.8fr)_minmax(0,1.6fr)]">
        <div className="grid content-start gap-4">
          <Panel title="Leaked artefact">
            <label
              onDragOver={(e) => {
                e.preventDefault();
                setDrag(true);
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDrag(false);
                void onFile(e.dataTransfer.files[0]);
              }}
              className={cn(
                "flex cursor-pointer flex-col items-center gap-2 rounded-[10px] border-2 border-dashed px-4 py-7 text-center",
                drag ? "border-primary bg-primary/5" : "hover:border-primary",
              )}
            >
              <Upload className="size-7 text-primary" />
              <div className="text-[13px] font-medium">Drop a leaked image here</div>
              <div className="text-[11.5px] text-muted-foreground">
                PNG / JPG — e.g. exported from the viewer’s “Simulate leak”
              </div>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => void onFile(e.target.files?.[0])}
              />
            </label>
            <div className="eyebrow mt-4 mb-2">Or run a sample</div>
            <div className="grid gap-2">
              {SAMPLES.map((s) => {
                const Icon = ICONS[s.id];
                return (
                  <button
                    key={s.id}
                    disabled={busy}
                    onClick={() => {
                      const m = makeSample(s.id);
                      void analyse(m.canvas, m.kind, s.id);
                    }}
                    className={cn(
                      "flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors hover:border-primary disabled:opacity-60",
                      sample === s.id && "border-primary bg-primary/5",
                    )}
                  >
                    <Icon className="size-4.5 shrink-0 text-primary" />
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-medium">{s.title}</div>
                      <div className="text-[11.5px] text-muted-foreground">{s.sub}</div>
                    </div>
                    <Badge tone="neutral">{s.channel}</Badge>
                  </button>
                );
              })}
            </div>
          </Panel>
          {preview && (
            <Panel
              title="Artefact preview"
              right={
                sample === "print" || ex?.microdots ? (
                  <Button
                    size="sm"
                    variant={torch ? "default" : "outline"}
                    onClick={() => setTorch((t) => !t)}
                  >
                    <Flashlight /> Blue torch
                  </Button>
                ) : undefined
              }
            >
              <div className="max-h-[420px] overflow-auto rounded-md border bg-muted">
                <CanvasView canvas={preview} />
              </div>
              <div className="mono mt-2 text-[11px] text-muted-foreground">
                {artefact?.kind} · {artefact?.canvas.width}×{artefact?.canvas.height}px
              </div>
            </Panel>
          )}
        </div>

        <div className="grid content-start gap-4">
          <Panel title="Forensic pipeline — handbook §4.7">
            <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
              {PHASES.map((p, i) => (
                <div
                  key={p}
                  className={cn(
                    "rounded-lg border px-2.5 py-2 text-[12px]",
                    phase > i && "border-success/50 bg-success/5",
                    phase === i && "border-primary bg-primary/5",
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    {phase > i ? (
                      <Check className="size-3.5 text-success" />
                    ) : phase === i ? (
                      <Loader2 className="size-3.5 animate-spin text-primary" />
                    ) : (
                      <span className="mono text-muted-foreground">{i + 1}</span>
                    )}
                    <span className="font-medium">{p}</span>
                  </div>
                </div>
              ))}
            </div>
            {phase < 0 && (
              <div className="mt-4 text-[13px] text-muted-foreground">
                Choose a sample or drop an image to begin. Every result below is computed from the
                pixels — nothing is looked up by file name.
              </div>
            )}
            {ex && (
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <Kv
                  rows={[
                    [
                      "Pages detected",
                      `${ex.pagesDetected}${ex.unidentified ? ` (${ex.unidentified} unidentified)` : ""}`,
                    ],
                    ["Document", ex.docId ?? <span className="text-destructive">no match</span>],
                    [
                      "pHash matches",
                      <span key="p" className="mono text-[11px]">
                        {ex.pages
                          .slice(0, 4)
                          .map((p) => `p${p.page + 1}:Δ${p.phashDistance}`)
                          .join("  ")}
                        {ex.pages.length > 4 ? " …" : ""}
                      </span>,
                    ],
                    ["Recovered", `${ex.recoveredCount} of 320 positions`],
                    ["Erased (not guessed)", `${320 - ex.recoveredCount}`],
                    ["Extraction time", `${ex.ms} ms`],
                  ]}
                />
                <div>
                  <div className="mb-1.5 text-[12px] text-muted-foreground">
                    Recovered pattern (hatched = erased)
                  </div>
                  <PieceGrid bits={ex.recovered} />
                  <div className="mt-2 flex flex-wrap gap-1 text-[11px]">
                    <Badge tone="good">L1 line shift · measured</Badge>
                    <Badge tone="neutral">L2 glyph · prototype</Badge>
                    <Badge tone="neutral">L3 pattern · prototype</Badge>
                  </div>
                </div>
              </div>
            )}
          </Panel>

          {phase >= 3 && ex && (ex.microdots || ex.mic) && (
            <Panel title="Two independent attributions from one sheet of paper">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-lg border-l-4 border-l-primary bg-muted/50 p-3">
                  <div className="eyebrow">ChainLock microdots (top margin)</div>
                  {ex.microdots ? (
                    <>
                      <div className="mono mt-1 text-[15px] font-semibold">
                        index 0x{ex.microdots.index.toString(16).padStart(6, "0")}
                      </div>
                      <div className="text-[12.5px] text-muted-foreground">
                        checksum {ex.microdots.checksumOk ? "OK" : "FAIL"} · {ex.microdots.tiles}/4
                        tiles ·{" "}
                        {tr?.microdotRecord
                          ? `→ PRINT #${tr.microdotRecord.index} by ${tr.microdotRecord.actor} at ${hms(tr.microdotRecord.time)}Z`
                          : "no ledger match"}
                      </div>
                    </>
                  ) : (
                    <div className="text-[12.5px] text-muted-foreground">not present</div>
                  )}
                </div>
                <div className="rounded-lg border-l-4 border-l-warning bg-muted/50 p-3">
                  <div className="eyebrow">Manufacturer MIC (bottom margin)</div>
                  {ex.mic ? (
                    <>
                      <div className="mono mt-1 text-[15px] font-semibold">
                        serial {ex.mic.serial}
                      </div>
                      <div className="text-[12.5px] text-muted-foreground">
                        printed {ex.mic.year}-{String(ex.mic.month).padStart(2, "0")}-
                        {String(ex.mic.day).padStart(2, "0")} {String(ex.mic.hh).padStart(2, "0")}:
                        {String(ex.mic.mm).padStart(2, "0")} · parity{" "}
                        {ex.mic.parityOk ? "OK" : "FAIL"}
                      </div>
                    </>
                  ) : (
                    <div className="text-[12.5px] text-muted-foreground">not present</div>
                  )}
                </div>
              </div>
              {tr?.microdotRecord && ex.mic && (
                <div className="mt-3 text-[13px]">
                  “Our own mark says this page was printed by <b>{tr.microdotRecord.actor}</b> at{" "}
                  <b>{hms(tr.microdotRecord.time).slice(0, 5)}</b>. Independently, the printer’s own
                  code says serial <b>{ex.mic.serial}</b> printed a page at{" "}
                  <b>
                    {String(ex.mic.hh).padStart(2, "0")}:{String(ex.mic.mm).padStart(2, "0")}
                  </b>
                  .”
                </div>
              )}
            </Panel>
          )}

          {phase >= 4 && tr && (
            <Panel
              title="Tardos accusation scores"
              right={
                <Badge
                  tone={
                    tr.confidence === "HIGH"
                      ? "good"
                      : tr.confidence === "MODERATE"
                        ? "warn"
                        : "bad"
                  }
                >
                  {tr.confidence} confidence
                </Badge>
              }
            >
              <div className="h-[230px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chart} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis
                      dataKey="name"
                      tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                      axisLine={false}
                      tickLine={false}
                      width={40}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "var(--card)",
                        border: "1px solid var(--border)",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                    />
                    <ReferenceLine
                      y={Number(tr.threshold.toFixed(1))}
                      stroke="#C0392B"
                      strokeDasharray="5 4"
                      label={{
                        value: `threshold Z = ${tr.threshold.toFixed(1)}`,
                        fill: "#C0392B",
                        fontSize: 11,
                        position: "insideTopRight",
                      }}
                    />
                    <Bar dataKey="score" radius={[4, 4, 0, 0]}>
                      {chart.map((c) => (
                        <Cell key={c.name} fill={c.accused ? "#C0392B" : "#1F4E79"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-2 grid gap-2 text-[12.5px] md:grid-cols-3">
                <div className="rounded-md bg-muted/60 px-3 py-2">
                  <div className="eyebrow">Positions used</div>
                  <div className="font-semibold">{tr.m} of 256 Tardos</div>
                </div>
                <div className="rounded-md bg-muted/60 px-3 py-2">
                  <div className="eyebrow">False-accusation bound</div>
                  <div className="font-semibold">≤ {tr.bound.toExponential(1)}</div>
                </div>
                <div className="rounded-md bg-muted/60 px-3 py-2">
                  <div className="eyebrow">Accused</div>
                  <div className="font-semibold">
                    {tr.accused.length ? tr.accused.join(" + ") : "none"}
                  </div>
                </div>
              </div>
              <Callout
                tone={tr.confidence === "LOW" ? "warn" : tr.accused.length > 1 ? "bad" : "good"}
                icon={
                  tr.confidence === "LOW" ? (
                    <TriangleAlert className="text-warning" />
                  ) : (
                    <ShieldCheck className="text-success" />
                  )
                }
                className="mt-3"
              >
                {tr.note}
              </Callout>
            </Panel>
          )}

          {phase >= 5 && tr && Object.keys(checks).length > 0 && (
            <Panel
              title="Evidence validation"
              right={
                <Button
                  onClick={() => void toCase()}
                  disabled={busy || phase < 6}
                  className="bg-saffron text-white hover:bg-saffron/90"
                >
                  <Archive /> Seal evidence bundle
                </Button>
              }
            >
              <div className="grid gap-3 md:grid-cols-2">
                {Object.entries(checks).map(([officer, list]) => {
                  const sess = tr.sessions.find((s) => s.officer === officer);
                  return (
                    <div key={officer} className="rounded-lg border p-3">
                      <div className="flex items-center justify-between">
                        <div className="font-semibold">{officer}</div>
                        {sess && (
                          <Badge tone="navy">
                            {sess.type} #{sess.recordIndex} · {hms(sess.time)}Z
                          </Badge>
                        )}
                      </div>
                      {sess && (
                        <div className="mono mt-1 text-[11px] text-muted-foreground">
                          session bits agree {sess.agree}/{sess.total}
                        </div>
                      )}
                      <ul className="mt-2 grid gap-1 text-[12.5px]">
                        {list.map((c) => (
                          <li key={c.label} className="flex items-center gap-2">
                            {c.ok === true ? (
                              <Check className="size-3.5 text-success" />
                            ) : c.ok === false ? (
                              <X className="size-3.5 text-destructive" />
                            ) : (
                              <ScanLine className="size-3.5 text-muted-foreground" />
                            )}
                            {c.label}
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
              <div className="mt-3 text-[12px] text-muted-foreground">
                Ledger has {ledger.length} records. The bundle carries every proof needed to
                re-check this result offline with <Mono>python backend/verifier.py</Mono>.
              </div>
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));
