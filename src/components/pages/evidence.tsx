import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { Download, FileWarning, Gavel, Loader2, Play, Scale, TerminalSquare } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { hms, useApp } from "@/lib/app";
import { cryptoCore } from "@/lib/engine/crypto-core";
import type { EvidenceBundle } from "@/lib/engine/model";
import { bundleDigest, verifyBundle, type VerifyLine } from "@/lib/engine/trace";
import { createCase, makeSample, runExtraction, runTrace } from "@/lib/investigate";
import { cn } from "@/lib/utils";
import { Badge, Callout, Empty, Hash, Kv, Mono, PageHeader, Panel } from "@/components/cl/ui";
import { download } from "@/components/cl/ui";

export function EvidencePage() {
  const { caseId } = useParams({ strict: false }) as { caseId?: string };
  const nav = useNavigate();
  const cases = useApp((s) => s.cases);
  const c = caseId ? cases[caseId] : undefined;
  const [generating, setGenerating] = useState(false);
  const [lines, setLines] = useState<VerifyLine[]>([]);
  const [running, setRunning] = useState(false);
  const [tampered, setTampered] = useState(false);
  const gen = useRef(false);

  // CASE-071 is the canonical demo case: generate it from the leaked-PDF sample on first visit.
  useEffect(() => {
    if (c || caseId !== "CASE-071" || gen.current) return;
    gen.current = true;
    setGenerating(true);
    setTimeout(async () => {
      try {
        const s = makeSample("pdf");
        const ex = runExtraction(s.canvas);
        const tr = runTrace(ex);
        if (tr)
          await createCase({
            ex,
            tr,
            canvas: s.canvas,
            kind: s.kind,
            sample: "pdf",
            caseId: "CASE-071",
          });
      } finally {
        setGenerating(false);
      }
    }, 50);
  }, [c, caseId]);

  useEffect(() => {
    setLines([]);
    setTampered(false);
  }, [caseId]);

  const run = async (bundle: EvidenceBundle) => {
    setRunning(true);
    setLines([]);
    const verifier = async (alg: string, pk: string, msg: string, sig: string) => {
      if (alg.startsWith("SIMULATED")) return cryptoCore.verify(alg, pk, msg, sig);
      if (cryptoCore.mode !== "LIVE") return null;
      return cryptoCore.verify(alg, pk, msg, sig).catch(() => false);
    };
    for await (const l of verifyBundle(bundle, verifier)) {
      setLines((v) => [...v, l]);
      await new Promise((r) => setTimeout(r, 110));
    }
    setRunning(false);
  };

  if (!c)
    return (
      <>
        <PageHeader eyebrow="Investigation / evidence" title={caseId ?? "Evidence"} />
        <Panel>
          {generating ? (
            <Empty
              icon={<Loader2 className="animate-spin" />}
              title="Building CASE-071 from the leaked DOC-007 export…"
              sub="Rendering the artefact, extracting marks, scoring recipients and sealing proofs."
            />
          ) : (
            <Empty
              icon={<FileWarning />}
              title={`${caseId} not found`}
              sub="Create a case from Trace a Leak."
              action={
                <div className="mt-2 flex flex-wrap justify-center gap-2">
                  {Object.keys(cases).map((id) => (
                    <Link
                      key={id}
                      to="/evidence/$caseId"
                      params={{ caseId: id }}
                      className="text-primary underline"
                    >
                      {id}
                    </Link>
                  ))}
                  <Link to="/trace" className="text-primary underline">
                    Trace a Leak
                  </Link>
                </div>
              }
            />
          )}
        </Panel>
      </>
    );

  const b = c.bundle;
  const bundle: EvidenceBundle = tampered
    ? {
        ...b,
        sessions: b.sessions.map((s, i) =>
          i === 0 ? { ...s, record: { ...s.record, actor: "OFF-001" } } : s,
        ),
        scores: b.scores.map((s, i) => (i === 0 ? { ...s, score: s.score + 40 } : s)),
      }
    : b;
  const okCount = lines.filter((l) => l.ok === true).length;
  const failCount = lines.filter((l) => l.ok === false).length;

  return (
    <>
      <PageHeader
        eyebrow="Investigation / evidence bundle"
        title={
          <span className="flex flex-wrap items-center gap-3">
            {c.id}{" "}
            <Badge tone={c.accused.length ? "bad" : "warn"}>
              {c.accused.length ? `accused: ${c.accused.join(" + ")}` : "no accusation"}
            </Badge>
          </span>
        }
        sub={`${b.docId} · ${b.artefact.kind} · created ${hms(c.createdAt)}Z`}
        actions={
          <>
            <select
              value={c.id}
              onChange={(e) => nav({ to: "/evidence/$caseId", params: { caseId: e.target.value } })}
              className="h-9 rounded-md border bg-background px-2 text-[13px]"
            >
              {Object.keys(cases).map((id) => (
                <option key={id}>{id}</option>
              ))}
            </select>
            <Button
              variant="outline"
              onClick={() => {
                download(`evidence-${c.id}.json`, JSON.stringify(bundle, null, 2));
                toast.success("Evidence bundle exported", {
                  description: `python backend/verifier.py evidence-${c.id}.json`,
                });
              }}
            >
              <Download /> Export JSON bundle
            </Button>
          </>
        }
      />
      <div className="grid gap-4 xl:grid-cols-[1fr_1.15fr]">
        <div className="grid content-start gap-4">
          <Panel title="Case">
            <Kv
              rows={[
                ["Document", b.docId],
                ["Artefact SHA3-256", <Hash key="a" value={b.artefact.sha3} n={14} />],
                [
                  "Artefact",
                  `${b.artefact.pages} page(s) · ${b.artefact.width}×${b.artefact.height}px`,
                ],
                [
                  "Recovered",
                  `${b.recovered_pattern.recovered}/320 positions · ${b.recovered_pattern.erased} erased`,
                ],
                [
                  "Threshold Z",
                  `${b.tardos_parameters.threshold.toFixed(2)} (ε = ${b.tardos_parameters.epsilon}, n = ${b.tardos_parameters.n}, m = ${b.tardos_parameters.m})`,
                ],
                [
                  "False-accusation bound",
                  `≤ ${b.tardos_parameters.falseAccusationBound.toExponential(2)}`,
                ],
                [
                  "Checkpoint",
                  `size ${b.checkpoint.size} · root ${b.checkpoint.root.slice(0, 14)}… · ${b.checkpoint.cosigs.length} co-signatures`,
                ],
                ["Bundle digest", <Hash key="d" value={bundleDigest(bundle)} n={14} />],
              ]}
            />
          </Panel>
          <Panel title="Recipient scores (all recipients, not just the accused)" pad={false}>
            <table className="w-full text-[13px]">
              <tbody>
                {b.scores.map((s) => (
                  <tr key={s.id} className="border-b last:border-0">
                    <td className="px-4 py-2 font-medium">{s.id}</td>
                    <td className="px-4 py-2">
                      <Mono>{s.score.toFixed(2)}</Mono>
                    </td>
                    <td className="px-4 py-2">
                      <Hash value={s.commitment} n={8} />
                    </td>
                    <td className="px-4 py-2 text-right">
                      {s.accused ? (
                        <Badge tone="bad">accused</Badge>
                      ) : (
                        <Badge tone="neutral">cleared</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
          <Panel title="Bundle contents">
            <ul className="mono grid gap-1 text-[11.5px]">
              {[
                ["recovered_pattern", `${b.recovered_pattern.recovered} symbols + erasures`],
                ["scores", `${b.scores.length} recipients`],
                ["tardos_parameters", "bias vector P revealed for audit + salt"],
                ["register", `REGISTER #${b.register.record.index} + inclusion proof`],
                [
                  "sessions",
                  b.sessions.map((s) => `${s.record.type} #${s.record.index}`).join(", ") || "—",
                ],
                ["officer signature", b.sessions[0]?.signature?.alg ?? "—"],
                [
                  "checkpoint + cosigs",
                  `${b.checkpoint.log.alg.split(" ")[0]} × ${1 + b.checkpoint.cosigs.length}`,
                ],
                [
                  "microdots / MIC",
                  `${b.microdots ? "0x" + b.microdots.index : "—"} / ${b.mic ? b.mic.serial : "—"}`,
                ],
                ["verifier", "python backend/verifier.py (standalone)"],
              ].map(([k, v]) => (
                <li key={k} className="flex justify-between gap-4 border-b py-1 last:border-0">
                  <span>{k}</span>
                  <span className="truncate text-muted-foreground">{v}</span>
                </li>
              ))}
            </ul>
          </Panel>
          <Callout
            tone="navy"
            icon={<Scale className="text-primary" />}
            title="Designed to support Section 63, Bharatiya Sakshya Adhiniyam 2023"
          >
            The bundle is structured to support the electronic-records certificate that replaced
            Section 65B. Not legal advice — confirm requirements with counsel before claiming
            admissibility.
          </Callout>
        </div>

        <div className="grid content-start gap-4">
          <Panel
            title="Offline verifier"
            right={
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant={tampered ? "destructive" : "outline"}
                  onClick={() => setTampered((t) => !t)}
                >
                  <Gavel /> {tampered ? "Tampered copy" : "Tamper a copy"}
                </Button>
                <Button size="sm" onClick={() => void run(bundle)} disabled={running}>
                  {running ? <Loader2 className="animate-spin" /> : <Play />} Run verifier
                </Button>
              </div>
            }
          >
            <div className="terminal min-h-[420px]">
              <div className="dim">$ python backend/verifier.py evidence-{c.id}.json --offline</div>
              <div className="dim">
                ChainLock evidence verifier v1 · trusts nothing but this file · crypto:{" "}
                {cryptoCore.mode === "LIVE"
                  ? "ML-DSA-65 / SLH-DSA via liboqs-compatible core"
                  : "hash checks local; PQC signatures need backend/verifier.py"}
              </div>
              {lines.map((l, i) => (
                <div key={i} className="fade-in">
                  <span className={cn(l.ok === true ? "ok" : l.ok === false ? "bad" : "dim")}>
                    {l.ok === true ? "[OK]  " : l.ok === false ? "[FAIL]" : "[ -- ]"}
                  </span>{" "}
                  {l.text}
                </div>
              ))}
              {running && <div className="caret" />}
              {!running && lines.length > 0 && (
                <div className={cn("mt-2 font-bold", failCount ? "bad" : "ok")}>
                  {failCount
                    ? `VERIFICATION FAILED — ${failCount} check(s) failed. This bundle must not be relied on.`
                    : `ALL ${okCount} CHECKS PASSED — evidence independently verified.`}
                </div>
              )}
              {!lines.length && !running && <div className="dim mt-2">Press “Run verifier”.</div>}
            </div>
            <div className="mt-3 flex gap-2.5 rounded-lg bg-muted/60 p-3 text-[12.5px]">
              <TerminalSquare className="mt-0.5 size-4 shrink-0 text-primary" />
              <div>
                <b>Demo it with the server switched off.</b> Export the bundle, stop the ChainLock
                app, and run <Mono>python backend/verifier.py evidence-{c.id}.json</Mono>. A board
                of inquiry re-checks every claim without trusting our system.
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}
