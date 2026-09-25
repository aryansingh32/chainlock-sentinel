import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Archive, ArrowUpRight, Ban, CheckCheck, Radio, ShieldAlert, Siren } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  escalate,
  hms,
  killAgent,
  latestCheckpoint,
  nowMs,
  revoke,
  setAlertStatus,
  store,
  useApp,
} from "@/lib/app";
import { cryptoCore } from "@/lib/engine/crypto-core";
import { checkpointMessage, proofFor, requestDigest, verifyChain } from "@/lib/engine/ledger";
import { leafHash, verifyInclusion } from "@/lib/engine/merkle";
import type { Alert } from "@/lib/engine/model";
import { cn } from "@/lib/utils";
import { Badge, Empty, Metric, Mono, PageHeader, Panel, type Tone } from "@/components/cl/ui";
import { fmtAgo, useNow } from "@/components/cl/hooks";

const sevTone = (s: Alert["severity"]): Tone =>
  s === "CRITICAL" ? "bad" : s === "HIGH" ? "warn" : s === "MEDIUM" ? "navy" : "neutral";

export function SocPage() {
  const alerts = useApp((s) => s.alerts);
  const officers = useApp((s) => s.officers);
  const relays = useApp((s) => s.relays);
  const mesh = useApp((s) => s.mesh);
  const socLog = useApp((s) => s.socLog);
  const ledger = useApp((s) => s.ledger);
  const checkpoints = useApp((s) => s.checkpoints);
  const documents = useApp((s) => s.documents);
  const now = useNow(1000);
  const [sel, setSel] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"OPEN" | "ALL">("ALL");
  const shown = alerts.filter((a) => statusFilter === "ALL" || a.status === "OPEN");
  const alert =
    alerts.find((a) => a.id === sel) ??
    alerts.find((a) => a.severity === "CRITICAL" && a.status === "OPEN") ??
    alerts[0];
  const open = alerts.filter((a) => a.status === "OPEN");
  const chain = useMemo(() => verifyChain(ledger, checkpoints), [ledger, checkpoints]);
  const cp = latestCheckpoint(store.get());
  const alive = officers.filter((o) => o.agent === "ALIVE").length;
  const relaysUp = relays.filter((r) => r.status !== "OFFLINE").length;

  // Auto-appending live telemetry (heartbeats arrive every ~5 s per device).
  const [live, setLive] = useState<{ t: number; text: string }[]>([]);
  useEffect(() => {
    const id = setInterval(() => {
      const s = store.get();
      const up = s.officers.filter((o) => o.agent === "ALIVE" && o.status === "ACTIVE");
      if (!up.length) return;
      const o = up[Math.floor(Math.random() * up.length)]!;
      const seq = o.seq + Math.floor((nowMs(s) - s.clock.scenarioStart) / 5000);
      setLive((l) =>
        [
          { t: nowMs(s), text: `HEARTBEAT ${o.device} seq 0x${seq.toString(16)} · sig ✓` },
          ...l,
        ].slice(0, 12),
      );
    }, 3000);
    return () => clearInterval(id);
  }, []);

  const layers: [string, string, Tone][] = [
    [
      "Canary tokens (HTTP + DNS)",
      `${alerts.filter((a) => a.kind === "CANARY").length} fired`,
      alerts.some((a) => a.kind === "CANARY" && a.status === "OPEN") ? "bad" : "good",
    ],
    [
      "pHash / PDQ monitor",
      `${alerts.filter((a) => a.kind === "PHASH").length} matches · ${documents.length * 10} pages registered`,
      alerts.some((a) => a.kind === "PHASH" && a.status === "OPEN") ? "warn" : "good",
    ],
    [
      "Phrase monitor (Layer 4)",
      documents.some((d) => d.layer4) ? "active on prose docs" : "idle — Layer 4 disabled",
      "neutral",
    ],
    [
      "Heartbeat watch",
      `${alive}/${officers.length} agents reporting`,
      alive < officers.length ? "warn" : "good",
    ],
    [
      "Sequence-gap watch",
      `${alerts.filter((a) => a.kind === "SEQ_GAP").length} gaps`,
      alerts.some((a) => a.kind === "SEQ_GAP" && a.status === "OPEN") ? "bad" : "good",
    ],
    ["Print gateway", `${ledger.filter((r) => r.type === "PRINT").length} jobs ledgered`, "good"],
    [
      "MFP scan hook (simulated)",
      `${alerts.filter((a) => a.kind === "SCAN").length} matches`,
      "neutral",
    ],
    [
      "Ledger integrity audit",
      chain.ok ? "all roots witnessed" : "FAILED",
      chain.ok ? "good" : "bad",
    ],
  ];

  return (
    <>
      <PageHeader
        eyebrow="SENTINEL / security operations · Zone 2"
        title="SOC Dashboard"
        sub="Receives one-way from the enclave through the data diode. It can alert and advise — it can never send anything back into Zone 1."
        actions={<Badge tone="good">Data diode · one-way in · Zone 1 → Zone 2</Badge>}
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Metric
          label="Open alerts"
          value={open.length}
          tone={open.some((a) => a.severity === "CRITICAL") ? "bad" : open.length ? "warn" : "good"}
          sub={`${open.filter((a) => a.severity === "CRITICAL").length} critical`}
        />
        <Metric
          label="Monitored devices"
          value={`${alive}/${officers.length}`}
          tone={alive < officers.length ? "warn" : "good"}
          sub="Tier A · agent heartbeat"
        />
        <Metric
          label="Relay nodes"
          value={`${relaysUp}/${relays.length}`}
          tone={relaysUp < relays.length ? "warn" : "good"}
          sub="IN865 · transmit-only"
        />
        <Metric
          label="Bundles received"
          value={mesh.filter((m) => !m.dropped).length}
          sub={`${mesh.filter((m) => m.dropped).length} lost in transit`}
        />
        <Metric
          label="Checkpoint lag"
          value={`${ledger.length - (cp?.size ?? 0)} rec`}
          tone={chain.ok ? "good" : "bad"}
          sub={chain.ok ? "witnessed 3/3" : "integrity failure"}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)_300px]">
        <Panel
          pad={false}
          title="Live alert feed"
          right={
            <div className="flex gap-1">
              {(["ALL", "OPEN"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setStatusFilter(f)}
                  className={cn(
                    "mono h-6 rounded px-2 text-[10px]",
                    statusFilter === f
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground",
                  )}
                >
                  {f}
                </button>
              ))}
            </div>
          }
        >
          <div className="max-h-[560px] overflow-auto">
            {shown.length === 0 && <Empty icon={<CheckCheck />} title="No open alerts" />}
            {shown.map((a) => (
              <button
                key={a.id}
                onClick={() => setSel(a.id)}
                className={cn(
                  "block w-full border-b px-4 py-3 text-left hover:bg-muted/40",
                  alert?.id === a.id && "bg-muted/60",
                  a.status !== "OPEN" && "opacity-60",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <Badge tone={sevTone(a.severity)}>{a.severity}</Badge>
                  <Mono className="text-muted-foreground">{hms(a.time)}Z</Mono>
                </div>
                <div className="mt-1.5 text-[13px] font-semibold">{a.title}</div>
                <div className="text-[12px] text-muted-foreground">{a.detail}</div>
                <div className="mono mt-1 text-[10px] text-muted-foreground">
                  {a.id} · {a.kind} · {a.status}
                </div>
              </button>
            ))}
          </div>
        </Panel>

        <div className="grid content-start gap-4">
          {alert ? (
            <AlertDetail key={alert.id} a={alert} />
          ) : (
            <Panel>
              <Empty icon={<Siren />} title="No alerts" />
            </Panel>
          )}
        </div>

        <div className="grid content-start gap-4">
          <Panel title="Detection layers">
            <div className="grid gap-2">
              {layers.map(([a, b, t]) => (
                <div key={a} className="flex items-start justify-between gap-2 text-[12.5px]">
                  <div>
                    <div className="font-medium">{a}</div>
                    <div className="text-[11.5px] text-muted-foreground">{b}</div>
                  </div>
                  <span
                    className={cn(
                      "mt-1.5 size-2 shrink-0 rounded-full",
                      t === "good"
                        ? "bg-success"
                        : t === "bad"
                          ? "pulse bg-destructive"
                          : t === "warn"
                            ? "bg-warning"
                            : "bg-muted-foreground",
                    )}
                  />
                </div>
              ))}
            </div>
          </Panel>
          <Panel title="Control tiers — §5.1">
            {[
              ["A · Managed", "Workstations, handsets, relays — live telemetry via agent + mesh"],
              ["B · Semi-managed", "Printers, MFPs — print gateway & scan hook"],
              ["C · Unmanaged", "Personal phones — no telemetry; caught when the copy surfaces"],
            ].map(([a, b]) => (
              <div key={a} className="border-b py-1.5 text-[12px] last:border-0">
                <b>{a}</b>
                <div className="text-muted-foreground">{b}</div>
              </div>
            ))}
          </Panel>
        </div>
      </div>

      <Panel
        className="mt-4"
        title="Event log (auto-appending)"
        right={<Mono className="text-muted-foreground">{hms(new Date(now).toISOString())}Z</Mono>}
      >
        <div className="terminal max-h-[260px] text-[11.5px]">
          {live.map((l, i) => (
            <div key={`l${l.t}${i}`} className="dim fade-in">
              {hms(new Date(l.t).toISOString())} MESH {l.text}
            </div>
          ))}
          {socLog.map((l, i) => (
            <div key={i}>
              <span className="dim">{hms(l.time)}</span>{" "}
              <span
                className={
                  l.tone === "bad"
                    ? "bad"
                    : l.tone === "good"
                      ? "ok"
                      : l.tone === "warn"
                        ? "text-[#e0b030]"
                        : ""
                }
              >
                {l.source.padEnd(9)}
              </span>{" "}
              {l.text}
            </div>
          ))}
        </div>
      </Panel>
    </>
  );
}

function AlertDetail({ a }: { a: Alert }) {
  const nav = useNavigate();
  const ledger = useApp((s) => s.ledger);
  const officers = useApp((s) => s.officers);
  const off = officers.find((o) => o.id === a.officer);
  const rec = a.ledgerIndex ? ledger[a.ledgerIndex - 1] : undefined;
  const [v, setV] = useState<{ sig: boolean | null; incl: boolean | null; cos: number | null }>({
    sig: null,
    incl: null,
    cos: null,
  });

  useEffect(() => {
    if (!rec) return;
    void (async () => {
      const s = store.get();
      const offc = s.offchain[rec.index];
      const cp = latestCheckpoint(s);
      const sig =
        offc?.sig && offc.request
          ? await cryptoCore
              .verify(offc.sig.alg, offc.pk ?? "", requestDigest(offc.request), offc.sig.sig)
              .catch(() => false)
          : null;
      const incl =
        cp && cp.size >= rec.index
          ? verifyInclusion(
              rec.index - 1,
              cp.size,
              leafHash(rec.hash),
              proofFor(s.ledger, rec.index - 1, cp.size),
              cp.root,
            )
          : null;
      let cos: number | null = null;
      if (cp) {
        cos = 0;
        const msg = checkpointMessage(cp.size, cp.root, cp.time);
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
            cos++;
      }
      setV({ sig, incl, cos });
    })();
  }, [rec]);

  const elapsed = rec ? new Date(a.time).getTime() - new Date(rec.time).getTime() : 0;
  const fmt = (b: boolean | null) => (b === null ? "n/a" : b ? "VALID" : "INVALID");
  const freeze = async () => {
    if (!a.officer) return;
    await revoke(a.officer, `SOC freeze on ${a.id}`);
    setAlertStatus(a.id, "CONTAINED");
    toast.error(`${a.officer} frozen — REVOKE block committed`, {
      description: "Quorum nodes now refuse every key release for this device.",
    });
  };

  return (
    <>
      <Panel
        title={`${a.id} · ${a.kind}`}
        right={
          <Badge tone={sevTone(a.severity)}>
            {a.severity} · {a.status}
          </Badge>
        }
      >
        <div className="text-[18px] font-semibold">{a.title}</div>
        <div className="mt-1 text-[13px] text-muted-foreground">{a.detail}</div>
        {a.kind === "CANARY" && rec ? (
          <pre className="terminal mt-4 text-[12px] whitespace-pre-wrap">
            {`SENTINEL ALERT  --  Document ${a.docId}
---------------------------------------------------------------
Trigger       : ${a.data?.["trigger"] ?? "Canary token fired"}
Detected at   : ${a.time.slice(0, 10)}  ${hms(a.time)} UTC
Source IP     : ${a.data?.["sourceIp"] ?? "—"}
Reader        : ${a.data?.["reader"] ?? "—"}
Token id      : ${a.data?.["token"] ?? "—"}  ->  Recipient ${a.officer}
---------------------------------------------------------------
Ledger entry  : #${rec.index} ${rec.type} at ${hms(rec.time)} UTC, signed by ${rec.actor}
                ${(rec.algoId ?? "").split(" ")[0]} signature .............. `}
            <span className={v.sig ? "ok" : v.sig === false ? "bad" : "dim"}>{fmt(v.sig)}</span>
            {`
                Merkle inclusion proof ........... `}
            <span className={v.incl ? "ok" : v.incl === false ? "bad" : "dim"}>{fmt(v.incl)}</span>
            {`
                Checkpoint witness co-signatures . `}
            <span className={(v.cos ?? 0) >= 2 ? "ok" : "bad"}>
              {v.cos === null ? "…" : `${v.cos} of 3`}
            </span>
            {`
Elapsed       : ${Math.floor(elapsed / 3600000)} h ${Math.floor((elapsed % 3600000) / 60000)} m from decryption to internet exposure
---------------------------------------------------------------`}
          </pre>
        ) : (
          <div className="mt-4 grid gap-1.5 text-[13px]">
            {a.device && (
              <div>
                Device: <Mono>{a.device}</Mono> {off && `· ${off.id} ${off.rank} ${off.name}`}
              </div>
            )}
            {a.docId && <div>Document: {a.docId}</div>}
            {a.data &&
              Object.entries(a.data).map(([k, val]) => (
                <div key={k}>
                  {k}: <Mono>{val}</Mono>
                </div>
              ))}
            {a.kind === "HEARTBEAT" && (
              <div className="text-muted-foreground">
                Silence is a signal: either the agent was tampered with or the machine was moved.
                Both are incidents.
              </div>
            )}
            {a.kind === "SEQ_GAP" && (
              <div className="text-muted-foreground">
                Sequence numbers are monotonic — a relay cannot silently drop a bundle without the
                gap being seen here.
              </div>
            )}
            {a.kind === "PHASH" && (
              <div className="text-muted-foreground">
                The perceptual hash survives print → photograph → upload, where a canary token
                cannot. Use Trace a Leak on the recovered image to attribute it.
              </div>
            )}
            {a.kind === "TAMPER" && (
              <div className="text-muted-foreground">
                Checkpoint verification failed. See the Ledger Explorer.
              </div>
            )}
          </div>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          {a.officer && (
            <Button
              variant="destructive"
              onClick={() => void freeze()}
              disabled={off?.status === "REVOKED"}
            >
              <Ban /> {off?.status === "REVOKED" ? `${a.officer} frozen` : "Freeze access"}
            </Button>
          )}
          {(a.kind === "CANARY" || a.kind === "PHASH") && (
            <Button
              onClick={() =>
                nav({
                  to: a.kind === "CANARY" ? "/evidence/$caseId" : "/trace",
                  params: { caseId: "CASE-071" } as never,
                })
              }
              className="bg-saffron text-white hover:bg-saffron/90"
            >
              <Archive /> {a.kind === "CANARY" ? "Export evidence" : "Attribute image"}
            </Button>
          )}
          {a.kind === "TAMPER" && (
            <Button asChild variant="outline">
              <Link to="/ledger">Open ledger</Link>
            </Button>
          )}
          {a.kind === "HEARTBEAT" && a.officer && (
            <Button
              variant="outline"
              onClick={() => {
                killAgent(a.officer!, true);
                setAlertStatus(a.id, "ACK");
                toast.success("Duty officer dispatched · agent restored");
              }}
            >
              <Radio /> Dispatch & restore agent
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() => {
              void escalate(a.id);
              toast.warning(`${a.id} escalated to CO / Board of Inquiry`);
            }}
            disabled={a.status === "ESCALATED"}
          >
            <ArrowUpRight /> Escalate
          </Button>
          <Button
            variant="ghost"
            onClick={() => setAlertStatus(a.id, "ACK")}
            disabled={a.status !== "OPEN"}
          >
            <CheckCheck /> Acknowledge
          </Button>
        </div>
      </Panel>
      {off && (
        <Panel title="Subject device">
          <div className="grid gap-2 text-[13px] sm:grid-cols-3">
            <div>
              <div className="eyebrow">Officer</div>
              {off.id} · {off.rank} {off.name}
            </div>
            <div>
              <div className="eyebrow">Device</div>
              <Mono>{off.device}</Mono>
            </div>
            <div>
              <div className="eyebrow">Status</div>
              <Badge tone={off.status === "REVOKED" ? "bad" : "good"}>{off.status}</Badge>{" "}
              <Badge tone={off.agent === "ALIVE" ? "good" : "warn"}>
                agent {off.agent.toLowerCase()}
              </Badge>
            </div>
          </div>
          <div className="mt-2 text-[12px] text-muted-foreground">
            Last heartbeat{" "}
            {off.agent === "ALIVE" ? "< 5 s ago" : `${fmtAgo(nowMs() - off.lastHeartbeat)} ago`} ·{" "}
            <ShieldAlert className="inline size-3" /> Zone 2 cannot revoke directly: the freeze is
            committed by the Command office in Zone 1.
          </div>
        </Panel>
      )}
    </>
  );
}
