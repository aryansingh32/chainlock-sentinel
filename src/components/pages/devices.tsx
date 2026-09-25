import { useState } from "react";
import { KeyRound, Power, RefreshCcw, ShieldX } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { killAgent, nowMs, reenrol, revoke, useApp } from "@/lib/app";
import { sha3 } from "@/lib/engine/sha3";
import type { PublicKeys } from "@/lib/engine/crypto-core";
import { Badge, Callout, Mono, PageHeader, Panel } from "@/components/cl/ui";
import { fmtAgo, useNow } from "@/components/cl/hooks";

function Fp({ k }: { k: PublicKeys[keyof PublicKeys] | undefined }) {
  if (!k) return <Mono className="text-muted-foreground">—</Mono>;
  return (
    <span className="grid">
      <Mono title={k.pk}>{sha3(k.pk).slice(0, 16).match(/.{4}/g)?.join(":")}</Mono>
      <span className="mono text-[10px] text-muted-foreground">
        {k.alg.split(" ")[0]} · {k.bytes.toLocaleString()} B
      </span>
    </span>
  );
}

export function DevicesPage() {
  const officers = useApp((s) => s.officers);
  const orgs = useApp((s) => s.orgs);
  const witnesses = useApp((s) => s.witnesses);
  const logKeys = useApp((s) => s.logKeys);
  const senderKeys = useApp((s) => s.senderKeys);
  const socKeys = useApp((s) => s.socKeys);
  const now = useNow(1000);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [reason, setReason] = useState("suspected leak — SOC containment");
  const [busy, setBusy] = useState<string | null>(null);
  const target = officers.find((o) => o.id === confirm);

  return (
    <>
      <PageHeader
        eyebrow="SENTINEL / key authority"
        title="Devices & Public Keys"
        sub="Only public keys and revocation records are visible here. Revocation is a ledger event: key-release nodes consult it before every share."
      />
      <Callout
        tone="navy"
        icon={<KeyRound className="text-primary" />}
        title="Private keys never leave the device"
        className="mb-4"
      >
        Each officer’s ML-DSA-65 signing key and ML-KEM-768 decryption key were generated on their
        own workstation (hardware token where available) at in-person enrolment. Nobody — including
        this console — can sign or decrypt on their behalf.
      </Callout>
      <Panel pad={false} title="Officers & workstations">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b text-left">
                {[
                  "Officer",
                  "Device",
                  "Signing key (pk fingerprint)",
                  "KEM key",
                  "Status",
                  "Heartbeat",
                  "Control",
                ].map((h) => (
                  <th key={h} className="eyebrow px-4 py-2.5">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {officers.map((o) => {
                const age =
                  o.agent === "ALIVE"
                    ? ((now / 1000 + Number(o.id.slice(-1)) * 1.7) % 5) * 1000
                    : nowMs() - o.lastHeartbeat;
                return (
                  <tr key={o.id} className="border-b last:border-0">
                    <td className="px-4 py-3">
                      <div className="font-medium">
                        {o.rank} {o.name}
                      </div>
                      <Mono className="text-muted-foreground">{o.id}</Mono>
                    </td>
                    <td className="px-4 py-3">
                      <Mono>{o.device}</Mono>
                      <div className="mono text-[10px] text-muted-foreground">
                        seq 0x{o.seq.toString(16)}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Fp k={o.keys.sig} />
                    </td>
                    <td className="px-4 py-3">
                      <Fp k={o.keys.kem} />
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={o.status === "REVOKED" ? "bad" : "good"}>{o.status}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      {o.agent === "ALIVE" ? (
                        <span className="text-success">● {fmtAgo(age)}</span>
                      ) : (
                        <span className="pulse text-warning">● silent {fmtAgo(age)}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        {o.status === "ACTIVE" ? (
                          <Button size="sm" variant="destructive" onClick={() => setConfirm(o.id)}>
                            <ShieldX /> Revoke
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy === o.id}
                            onClick={async () => {
                              setBusy(o.id);
                              await reenrol(o.id);
                              setBusy(null);
                              toast.success(
                                `${o.id} re-enrolled · new keys certified · ENROL block committed`,
                              );
                            }}
                          >
                            <RefreshCcw /> Re-enrol
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => killAgent(o.id, o.agent === "KILLED")}
                          title={o.agent === "ALIVE" ? "Stop agent (demo)" : "Restore agent"}
                        >
                          <Power /> {o.agent === "ALIVE" ? "Kill agent" : "Restore"}
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel title="Infrastructure identities">
          <div className="grid gap-2 text-[13px]">
            {[
              ...orgs.map(
                (o) =>
                  [
                    `${o.name} · ${o.id}`,
                    o.keys.sig,
                    "Ledger endorsement + key-release node",
                  ] as const,
              ),
              ["HQ Sender", senderKeys.sig, "Signs REGISTER transactions"] as const,
              ["Transparency log signer", logKeys.slh, "Signs checkpoints (hash-based)"] as const,
              ...witnesses.map((w) => [w.name, w.keys.slh, "Co-signs checkpoints"] as const),
              ["SENTINEL SOC", socKeys.kem, "Receives mesh bundles (only it can decrypt)"] as const,
            ].map(([name, k, role]) => (
              <div
                key={name}
                className="flex items-start justify-between gap-3 border-b pb-2 last:border-0"
              >
                <div>
                  <div className="font-medium">{name}</div>
                  <div className="text-[11.5px] text-muted-foreground">{role}</div>
                </div>
                <Fp k={k} />
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="Key inventory — handbook §4.1">
          <table className="w-full text-[12.5px]">
            <tbody>
              {[
                ["Root key", "ML-DSA-65", "Offline, in a safe", "Certifying all identities"],
                [
                  "Officer signing key",
                  "ML-DSA-65",
                  "Officer device only",
                  "Decryption requests (R5)",
                ],
                [
                  "Officer KEM key",
                  "ML-KEM-768",
                  "Officer device only",
                  "Receiving wrapped shares",
                ],
                ["Org keys ×3", "ML-DSA-65", "Sec / Audit / Command", "Endorsing transactions"],
                ["Witness keys ×3", "SLH-DSA", "Independent nodes", "Co-signing checkpoints"],
                ["Segment keys", "AES-256-GCM", "Per document", "640 variants"],
              ].map((r) => (
                <tr key={r[0]} className="border-b last:border-0">
                  {r.map((c, i) => (
                    <td key={i} className={i === 1 ? "mono py-1.5 text-[11px]" : "py-1.5"}>
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>

      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent className="sentinel border-border bg-card text-foreground">
          <DialogHeader>
            <DialogTitle>Revoke {target?.id}?</DialogTitle>
            <DialogDescription>
              {target?.rank} {target?.name} · {target?.device}. A REVOKE record is committed with ≥
              2 office endorsements. Every key-release node will refuse further shares for this
              device.
            </DialogDescription>
          </DialogHeader>
          <label className="text-[12px] text-muted-foreground">
            Reason (recorded on the ledger)
          </label>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="h-9 rounded-md border bg-background px-3"
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                if (!confirm) return;
                await revoke(confirm, reason);
                toast.error(`${confirm} revoked · REVOKE block committed`);
                setConfirm(null);
              }}
            >
              <ShieldX /> Confirm revocation
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
