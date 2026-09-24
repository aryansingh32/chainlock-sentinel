import { useMemo, useState } from "react";
import {
  Check,
  Loader2,
  RotateCcw,
  Search,
  ShieldCheck,
  Stamp,
  TriangleAlert,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ensureCheckpoint, hms, restore, setOrgOnline, tamper, useApp } from "@/lib/app";
import { cryptoCore } from "@/lib/engine/crypto-core";
import {
  checkpointMessage,
  proofFor,
  verifyChain,
  type LedgerRecord,
  type RecordType,
} from "@/lib/engine/ledger";
import { leafHash, verifyInclusion } from "@/lib/engine/merkle";
import { cn } from "@/lib/utils";
import {
  Badge,
  Callout,
  Hash,
  Kv,
  Metric,
  Mono,
  PageHeader,
  Panel,
  type Tone,
} from "@/components/cl/ui";

const TYPES: ("ALL" | RecordType)[] = [
  "ALL",
  "REGISTER",
  "DECRYPT",
  "PRINT",
  "BEACON",
  "REVOKE",
  "ENROL",
  "EXPORT",
  "GENESIS",
];
const typeTone = (t: string): Tone =>
  t === "DECRYPT"
    ? "navy"
    : t === "PRINT"
      ? "warn"
      : t === "REVOKE"
        ? "bad"
        : t === "REGISTER"
          ? "good"
          : "neutral";

export function LedgerPage() {
  const ledger = useApp((s) => s.ledger);
  const checkpoints = useApp((s) => s.checkpoints);
  const orgs = useApp((s) => s.orgs);
  const witnesses = useApp((s) => s.witnesses);
  const offchain = useApp((s) => s.offchain);
  const tamperState = useApp((s) => s.tamper);
  const [filter, setFilter] = useState<(typeof TYPES)[number]>("ALL");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<LedgerRecord | null>(null);
  const [target, setTarget] = useState(7);
  const [sigCheck, setSigCheck] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const report = useMemo(() => verifyChain(ledger, checkpoints), [ledger, checkpoints]);
  const latest = [...checkpoints].sort((a, b) => b.size - a.size)[0];
  const rows = ledger.filter(
    (r) =>
      (filter === "ALL" || r.type === filter) &&
      (!q || JSON.stringify(r).toLowerCase().includes(q.toLowerCase())),
  );
  const online = orgs.filter((o) => o.online).length;
  const pendingRecords = ledger.length - (latest?.size ?? 0);

  const verifySigs = async () => {
    setBusy(true);
    const out: Record<number, string> = {};
    for (const cp of checkpoints) {
      const msg = checkpointMessage(cp.size, cp.root, cp.time);
      let n = 0;
      for (const c of cp.cosigs)
        if (
          await cryptoCore
            .verify(
              c.alg,
              witnesses.find((w) => w.id === c.witness)?.keys.slh?.pk ?? "",
              msg,
              c.sig,
            )
            .catch(() => false)
        )
          n++;
      out[cp.size] = `${n}/${cp.cosigs.length}`;
    }
    setSigCheck(out);
    setBusy(false);
    toast.success("Checkpoint co-signatures verified", {
      description:
        cryptoCore.mode === "LIVE"
          ? "SLH-DSA verification by Crypto Core"
          : "Simulated signatures (start backend for SLH-DSA)",
    });
  };

  const openRec = open ? report.records.find((r) => r.index === open.index) : undefined;
  const openProof =
    open && latest && open.index <= latest.size
      ? proofFor(ledger, open.index - 1, latest.size)
      : null;
  const openIncl =
    open && latest && openProof
      ? verifyInclusion(open.index - 1, latest.size, leafHash(open.hash), openProof, latest.root)
      : null;

  return (
    <>
      <PageHeader
        eyebrow="Ledger / three-office consensus"
        title="Ledger Explorer"
        sub="Hash-chained records (SHA3-256) under an RFC 6962 Merkle log. Checkpoints are signed with hash-based SLH-DSA and co-signed by three independent witnesses."
        actions={
          <>
            <Button
              variant="outline"
              onClick={() =>
                report.ok
                  ? toast.success(
                      `Chain verified · ${ledger.length} records · ${checkpoints.length} checkpoints`,
                    )
                  : toast.error(`Verification failed from record #${report.firstBad}`)
              }
            >
              <ShieldCheck /> Verify chain
            </Button>
            <Button
              variant="outline"
              disabled={pendingRecords <= 0 || busy}
              onClick={async () => {
                setBusy(true);
                await ensureCheckpoint();
                setBusy(false);
                toast.success("Checkpoint published and co-signed");
              }}
            >
              <Stamp /> Publish checkpoint {pendingRecords > 0 ? `(+${pendingRecords})` : ""}
            </Button>
          </>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Metric label="Chain height" value={ledger.length} />
        <Metric
          label="Checkpoints"
          value={checkpoints.length}
          sub={latest ? `latest covers ${latest.size}` : undefined}
        />
        <Metric label="Latest root" value={<Hash value={latest?.root} n={6} />} />
        <Metric
          label="Verification"
          value={report.ok ? "VALID" : report.splitView ? "SPLIT VIEW" : "BROKEN"}
          tone={report.ok ? "good" : "bad"}
          sub={report.ok ? "all hashes + roots match" : `from record #${report.firstBad}`}
        />
        <Metric
          label="Endorsing offices"
          value={`${online}/3`}
          tone={online >= 2 ? "good" : "bad"}
          sub={online >= 2 ? "≥ 2 required" : "writes blocked"}
        />
      </div>

      {!report.ok && (
        <Callout
          tone="bad"
          icon={<TriangleAlert className="text-destructive" />}
          className="mb-4"
          title={
            report.splitView
              ? "Split-view attack detected"
              : `Record #${tamperState?.index ?? report.firstBad} was altered`
          }
        >
          {report.splitView
            ? "The attacker recomputed every hash after the edit, so the chain looks self-consistent — but its Merkle root no longer matches the checkpoints the witnesses already co-signed. Rewriting history would need co-signatures for a checkpoint the witnesses never saw."
            : "Its hash no longer recomputes, the next record’s link breaks, and every checkpoint covering it fails. A privileged administrator cannot quietly erase this."}{" "}
          <button className="font-semibold text-primary underline" onClick={restore}>
            Restore from witnessed replicas
          </button>
        </Callout>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Panel
          pad={false}
          title={`${rows.length} records`}
          right={
            <div className="relative">
              <Search className="absolute top-2 left-2 size-3.5 text-muted-foreground" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search…"
                className="h-7 w-44 rounded-md border bg-background pr-2 pl-7 text-[12px]"
              />
            </div>
          }
        >
          <div className="flex flex-wrap gap-1.5 border-b px-4 py-2.5">
            {TYPES.map((t) => (
              <button
                key={t}
                onClick={() => setFilter(t)}
                className={cn(
                  "mono h-6 rounded-md border px-2 text-[10.5px]",
                  filter === t
                    ? "border-primary bg-primary text-primary-foreground"
                    : "hover:bg-muted",
                )}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="max-h-[640px] overflow-auto">
            {rows.map((r) => {
              const chk = report.records[r.index - 1];
              const bad = chk && (!chk.hashOk || !chk.linkOk || chk.witnessed === false);
              const cpHere = checkpoints.find((c) => c.size === r.index);
              return (
                <div key={r.index}>
                  <button
                    onClick={() => setOpen(r)}
                    className={cn(
                      "grid w-full grid-cols-[46px_70px_92px_1fr_auto] items-center gap-3 border-b px-4 py-2 text-left text-[12.5px] hover:bg-muted/50 max-md:grid-cols-[40px_1fr_auto]",
                      bad && "bg-destructive/8",
                    )}
                  >
                    <Mono className="text-muted-foreground">#{r.index}</Mono>
                    <Mono className="max-md:hidden">{hms(r.time)}</Mono>
                    <span className="max-md:hidden">
                      <Badge tone={typeTone(r.type)}>{r.type}</Badge>
                    </span>
                    <div className="min-w-0">
                      <div className="truncate">
                        <b>{r.actor}</b>{" "}
                        {r.docId && <span className="text-muted-foreground">· {r.docId}</span>}{" "}
                        <span className="text-muted-foreground">· {r.detail}</span>
                      </div>
                      <div className="mono truncate text-[10.5px] text-muted-foreground">
                        prev {r.prevHash.slice(0, 10)}… → hash {r.hash.slice(0, 10)}… ·{" "}
                        {r.endorsements.map((e) => e.slice(4)).join("+")}
                      </div>
                    </div>
                    <span>
                      {chk && !chk.hashOk ? (
                        <Badge tone="bad">hash ✗</Badge>
                      ) : chk && !chk.linkOk ? (
                        <Badge tone="bad">link ✗</Badge>
                      ) : chk?.witnessed === false ? (
                        <Badge tone="bad">≠ witnessed</Badge>
                      ) : chk?.witnessed === null ? (
                        <Badge tone="warn">pending cp</Badge>
                      ) : (
                        <Check className="size-4 text-success" />
                      )}
                    </span>
                  </button>
                  {cpHere && (
                    <div className="flex items-center gap-2 border-b bg-muted/40 px-4 py-1.5 text-[11.5px]">
                      <Stamp className="size-3.5 text-primary" />
                      <Mono>
                        CHECKPOINT size {cpHere.size} · root {cpHere.root.slice(0, 12)}… ·{" "}
                        {cpHere.log.alg.split(" ")[0]} · {cpHere.cosigs.length}/3 witnesses
                      </Mono>
                      {report.checkpoints.find((c) => c.size === cpHere.size)?.rootOk === false && (
                        <Badge tone="bad">root mismatch</Badge>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Panel>

        <div className="grid content-start gap-4">
          <Panel title="Tamper demo (privileged admin)">
            <div className="text-[12.5px] text-muted-foreground">
              An administrator with storage access tries to reattribute a record — e.g. erase
              OFF-004’s 09:14 decryption.
            </div>
            <div className="mt-3 flex items-center gap-2">
              <label className="text-[12px]">Target</label>
              <select
                value={target}
                onChange={(e) => setTarget(Number(e.target.value))}
                className="h-8 flex-1 rounded-md border bg-background px-2 text-[12px]"
              >
                {(tamperState?.backup ?? ledger).map((r) => (
                  <option key={r.index} value={r.index}>
                    #{r.index} {r.type} {r.actor} {r.docId ?? ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button variant="destructive" size="sm" onClick={() => tamper("EDIT", target)}>
                <TriangleAlert /> Edit record
              </Button>
              <Button variant="destructive" size="sm" onClick={() => tamper("REWRITE", target)}>
                <TriangleAlert /> Rewrite history
              </Button>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="mt-2 w-full"
              onClick={restore}
              disabled={!tamperState}
            >
              <RotateCcw /> Restore chain
            </Button>
          </Panel>
          <Panel title="Endorsing offices (Fabric orgs + key-release quorum)">
            {orgs.map((o) => (
              <label
                key={o.id}
                className="flex items-center justify-between border-b py-2 text-[13px] last:border-0"
              >
                <div>
                  <div className="font-medium">{o.name}</div>
                  <Mono className="text-muted-foreground">
                    {o.id} · {o.keys.sig?.alg.split(" ")[0]}
                  </Mono>
                </div>
                <span className="flex items-center gap-2">
                  <Badge tone={o.online ? "good" : "bad"}>{o.online ? "online" : "offline"}</Badge>
                  <input
                    type="checkbox"
                    checked={o.online}
                    onChange={(e) => setOrgOnline(o.id, e.target.checked)}
                    aria-label={`${o.name} online`}
                  />
                </span>
              </label>
            ))}
            <div className="mt-2 text-[12px] text-muted-foreground">
              Writes need ≥ 2 of 3 endorsements. One compromised admin cannot write alone; take two
              offline and every decryption locks.
            </div>
          </Panel>
          <Panel
            title="Checkpoints & witnesses"
            right={
              <Button size="sm" variant="outline" onClick={() => void verifySigs()} disabled={busy}>
                {busy ? <Loader2 className="animate-spin" /> : <ShieldCheck />} Verify
              </Button>
            }
          >
            <div className="grid gap-2">
              {[...checkpoints].reverse().map((cp) => {
                const ok = report.checkpoints.find((c) => c.size === cp.size)?.rootOk;
                return (
                  <div key={cp.size} className="rounded-md border px-3 py-2 text-[12px]">
                    <div className="flex items-center justify-between">
                      <b>Size {cp.size}</b>
                      <Badge tone={ok ? "good" : "bad"}>{ok ? "root ✓" : "root ✗"}</Badge>
                    </div>
                    <Mono className="text-muted-foreground">
                      {hms(cp.time)}Z · {cp.root.slice(0, 16)}… · sig{" "}
                      {cp.log.bytes.toLocaleString()} B{" "}
                      {sigCheck[cp.size] ? `· cosigs ${sigCheck[cp.size]} ✓` : ""}
                    </Mono>
                  </div>
                );
              })}
            </div>
            <div className="mt-3 grid gap-1 text-[12px]">
              {witnesses.map((w) => (
                <div key={w.id} className="flex justify-between gap-2">
                  <span>{w.name}</span>
                  <Hash value={w.keys.slh?.pk} n={5} />
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>

      <Sheet open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-[560px]">
          {open && (
            <>
              <SheetHeader>
                <SheetTitle>
                  Record #{open.index} · {open.type}
                </SheetTitle>
                <SheetDescription>{open.detail}</SheetDescription>
              </SheetHeader>
              <div className="grid gap-4 px-4 pb-6">
                <Kv
                  rows={[
                    [
                      "Hash recomputes",
                      openRec?.hashOk ? (
                        <Badge key="h" tone="good">
                          yes
                        </Badge>
                      ) : (
                        <Badge key="h" tone="bad">
                          no
                        </Badge>
                      ),
                    ],
                    [
                      "Link to #" + (open.index - 1),
                      openRec?.linkOk ? (
                        <Badge key="l" tone="good">
                          intact
                        </Badge>
                      ) : (
                        <Badge key="l" tone="bad">
                          broken
                        </Badge>
                      ),
                    ],
                    [
                      "Merkle inclusion",
                      openIncl === null ? (
                        "not yet checkpointed"
                      ) : openIncl ? (
                        <Badge key="m" tone="good">
                          verified vs checkpoint {latest?.size}
                        </Badge>
                      ) : (
                        <Badge key="m" tone="bad">
                          fails
                        </Badge>
                      ),
                    ],
                    ["Proof length", openProof ? `${openProof.length} sibling hashes` : "—"],
                    [
                      "Off-chain signature",
                      offchain[open.index]?.sig ? (
                        <Mono key="s">
                          {offchain[open.index]!.sig!.alg} ·{" "}
                          {offchain[open.index]!.sig!.bytes.toLocaleString()} B
                        </Mono>
                      ) : (
                        "—"
                      ),
                    ],
                  ]}
                />
                <div>
                  <div className="eyebrow mb-1">On-chain record (JSON)</div>
                  <pre className="terminal max-h-[340px] text-[11px] whitespace-pre-wrap">
                    {JSON.stringify(open, null, 2)}
                  </pre>
                </div>
                {offchain[open.index]?.request && (
                  <div>
                    <div className="eyebrow mb-1">Off-chain request object (signed)</div>
                    <pre className="terminal text-[11px] whitespace-pre-wrap">
                      {JSON.stringify(offchain[open.index]!.request, null, 2)}
                    </pre>
                  </div>
                )}
                {openProof && (
                  <div>
                    <div className="eyebrow mb-1">Inclusion proof</div>
                    <div className="mono grid gap-0.5 text-[10.5px] text-muted-foreground">
                      {openProof.map((p, i) => (
                        <div key={i}>
                          {i}: {p}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <Button variant="outline" onClick={() => setOpen(null)}>
                  <X /> Close
                </Button>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
