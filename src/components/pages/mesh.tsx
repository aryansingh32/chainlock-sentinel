import { useEffect, useState } from "react";
import { Radio, Send, ShieldCheck, Unplug } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { armDrop, emitBundle, hms, setRadio, setRelayStatus, useApp } from "@/lib/app";
import type { MeshEvent } from "@/lib/engine/model";
import { cn } from "@/lib/utils";
import { Badge, Mono, PageHeader, Panel } from "@/components/cl/ui";

const WS_POS: Record<string, [number, number]> = {
  "WS-NAVAL-11": [80, 60],
  "WS-NAVAL-12": [80, 120],
  "WS-NAVAL-13": [80, 190],
  "WS-NAVAL-14": [80, 250],
  "WS-NAVAL-15": [80, 310],
};
const EVENTS = ["HEARTBEAT", "DECRYPT", "PRINT", "USB_INSERT", "SCREENSHOT_ATTEMPT"];

export function MeshPage() {
  const relays = useApp((s) => s.relays);
  const mesh = useApp((s) => s.mesh);
  const radio = useApp((s) => s.radio);
  const officers = useApp((s) => s.officers);
  const [device, setDevice] = useState("WS-NAVAL-14");
  const [event, setEvent] = useState("HEARTBEAT");
  const [anim, setAnim] = useState<{ route: string[]; hop: number; dropped?: boolean } | null>(
    null,
  );
  const [last, setLast] = useState<MeshEvent | null>(null);
  const [busy, setBusy] = useState(false);

  const pos = (id: string): [number, number] => {
    if (WS_POS[id]) return WS_POS[id]!;
    const r = relays.find((x) => x.id === id);
    if (r) return [r.id === "WS-NAVAL-14" ? 80 : r.x, r.id === "WS-NAVAL-14" ? 250 : r.y];
    if (id === "HANDSET-DUTY") return [420, 60];
    return [0, 0];
  };

  useEffect(() => {
    if (!anim || anim.hop >= anim.route.length - 1) return;
    const t = setTimeout(() => setAnim((a) => (a ? { ...a, hop: a.hop + 1 } : a)), 480);
    return () => clearTimeout(t);
  }, [anim]);

  const send = async () => {
    setBusy(true);
    const ev = await emitBundle(device, event, event === "HEARTBEAT" ? "—" : "DOC-007");
    setBusy(false);
    if (!ev) return;
    setLast(ev);
    setAnim({ route: ev.route, hop: 0, ...(ev.dropped ? { dropped: true } : {}) });
    if (ev.dropped)
      toast.warning(`Bundle seq 0x${ev.seq.toString(16)} dropped at ${ev.route.at(-1)}`, {
        description: "Send another — the SOC will detect the sequence gap.",
      });
    else
      toast.success(`Bundle delivered in ${ev.route.length - 1} hops`, {
        description: `${ev.alg} · signature verified at SOC`,
      });
  };

  const links: [string, string, "rf" | "wire" | "diode"][] = [
    ["WS-NAVAL-11", "GW-BRIDGE", "wire"],
    ["WS-NAVAL-12", "GW-BRIDGE", "wire"],
    ["WS-NAVAL-13", "RN-CORRIDOR-A", "rf"],
    ["WS-NAVAL-14", "RN-CORRIDOR-A", "rf"],
    ["WS-NAVAL-15", "RN-CORRIDOR-A", "rf"],
    ["RN-CORRIDOR-A", "RN-DECK2", "rf"],
    ["RN-CORRIDOR-A", "RN-DECK3", "rf"],
    ["RN-DECK2", "GW-BRIDGE", "rf"],
    ["RN-DECK3", "GW-BRIDGE", "rf"],
    ["GW-BRIDGE", "DIODE", "wire"],
    ["DIODE", "SOC", "diode"],
  ];
  const hopActive = (a: string, b: string) => {
    if (!anim) return false;
    const i = anim.route.indexOf(a);
    return i >= 0 && anim.route[i + 1] === b && i < anim.hop;
  };
  const dotAt = anim ? pos(anim.route[Math.min(anim.hop, anim.route.length - 1)]!) : null;

  return (
    <>
      <PageHeader
        eyebrow="SENTINEL / SENTINEL-MESH · Zone 3"
        title="Relay Mesh"
        sub="Small signed event bundles leave rooms that have no cabling — store-carry-forward (RFC 9171) over a private LoRa mesh. Every relay carries them; no relay can read, forge or silently drop them."
        actions={
          <>
            <select
              value={device}
              onChange={(e) => setDevice(e.target.value)}
              className="h-9 rounded-md border bg-background px-2 text-[13px]"
            >
              {officers.map((o) => (
                <option key={o.device}>{o.device}</option>
              ))}
            </select>
            <select
              value={event}
              onChange={(e) => setEvent(e.target.value)}
              className="h-9 rounded-md border bg-background px-2 text-[13px]"
            >
              {EVENTS.map((e) => (
                <option key={e}>{e}</option>
              ))}
            </select>
            <Button
              onClick={() => void send()}
              disabled={busy}
              className="bg-saffron text-white hover:bg-saffron/90"
            >
              <Send /> Send test beacon
            </Button>
          </>
        }
      />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_330px]">
        <Panel title="Station deck plan — radio topology" pad={false}>
          <div className="overflow-x-auto p-3">
            <svg
              viewBox="0 0 1010 360"
              className="min-w-[760px]"
              role="img"
              aria-label="Relay mesh topology"
            >
              <rect
                x="10"
                y="20"
                width="150"
                height="325"
                rx="10"
                fill="none"
                stroke="var(--destructive)"
                strokeDasharray="4 4"
              />
              <text
                x="20"
                y="38"
                fontSize="10.5"
                fill="var(--destructive)"
                fontFamily="var(--font-mono)"
              >
                ZONE 1 · AIR-GAPPED
              </text>
              <rect
                x="190"
                y="20"
                width="560"
                height="325"
                rx="10"
                fill="none"
                stroke="var(--border)"
              />
              <text
                x="200"
                y="38"
                fontSize="10.5"
                fill="var(--muted-foreground)"
                fontFamily="var(--font-mono)"
              >
                ZONE 3 · CORRIDORS & DECKS (IN865 LoRa, BLE)
              </text>
              <rect
                x="780"
                y="120"
                width="220"
                height="220"
                rx="10"
                fill="none"
                stroke="var(--success)"
                strokeDasharray="4 4"
              />
              <text
                x="790"
                y="138"
                fontSize="10.5"
                fill="var(--success)"
                fontFamily="var(--font-mono)"
              >
                ZONE 2 · SENTINEL SOC
              </text>
              {links.map(([a, b, kind]) => {
                const [x1, y1] = pos(a);
                const [x2, y2] = pos(b);
                const active = hopActive(a, b);
                const offline = relays.find(
                  (r) => (r.id === a || r.id === b) && r.status === "OFFLINE",
                );
                return (
                  <line
                    key={a + b}
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke={
                      active
                        ? "#E8792B"
                        : offline
                          ? "var(--destructive)"
                          : kind === "wire"
                            ? "var(--muted-foreground)"
                            : kind === "diode"
                              ? "var(--success)"
                              : "var(--primary)"
                    }
                    strokeOpacity={active ? 1 : offline ? 0.5 : 0.45}
                    strokeWidth={active ? 3 : 1.5}
                    strokeDasharray={kind === "rf" ? "5 5" : undefined}
                    className={active ? "hop-line" : undefined}
                  />
                );
              })}
              {[
                ...Object.keys(WS_POS),
                ...relays.filter((r) => r.kind !== "WORKSTATION").map((r) => r.id),
              ].map((id) => {
                const [x, y] = pos(id);
                const r = relays.find((z) => z.id === id);
                const onRoute = anim?.route.slice(0, anim.hop + 1).includes(id);
                const offline = r?.status === "OFFLINE";
                const o = officers.find((z) => z.device === id);
                const fill = offline
                  ? "var(--destructive)"
                  : onRoute
                    ? "#E8792B"
                    : r?.kind === "SOC"
                      ? "var(--success)"
                      : r?.kind === "DIODE"
                        ? "var(--success)"
                        : "var(--card)";
                return (
                  <g key={id}>
                    {r?.kind === "DIODE" ? (
                      <polygon
                        points={`${x - 14},${y - 14} ${x - 14},${y + 14} ${x + 14},${y}`}
                        fill={fill}
                        stroke="var(--success)"
                      />
                    ) : (
                      <rect
                        x={x - 16}
                        y={y - 12}
                        width="32"
                        height="24"
                        rx={r?.kind === "RELAY" || r?.kind === "GATEWAY" ? 12 : 4}
                        fill={fill}
                        stroke={o?.agent === "KILLED" ? "var(--warning)" : "var(--primary)"}
                        strokeWidth="1.5"
                      />
                    )}
                    <text
                      x={x}
                      y={y + 28}
                      textAnchor="middle"
                      fontSize="10"
                      fill="var(--foreground)"
                      fontFamily="var(--font-mono)"
                    >
                      {id}
                    </text>
                    {r && r.kind !== "WORKSTATION" && (
                      <text
                        x={x}
                        y={y + 40}
                        textAnchor="middle"
                        fontSize="8.5"
                        fill="var(--muted-foreground)"
                      >
                        {r.transport}
                      </text>
                    )}
                    {o?.agent === "KILLED" && (
                      <text
                        x={x + 22}
                        y={y + 4}
                        fontSize="9"
                        fill="var(--warning)"
                        fontFamily="var(--font-mono)"
                      >
                        silent
                      </text>
                    )}
                  </g>
                );
              })}
              {dotAt && (
                <circle
                  cx={dotAt[0]}
                  cy={dotAt[1]}
                  r="7"
                  fill={
                    anim?.dropped && anim.hop >= anim.route.length - 1
                      ? "var(--destructive)"
                      : "#E8792B"
                  }
                  className="pulse"
                />
              )}
              <text
                x="880"
                y="300"
                textAnchor="middle"
                fontSize="9.5"
                fill="var(--success)"
                fontFamily="var(--font-mono)"
              >
                one-way optical · no return path
              </text>
            </svg>
          </div>
          {last && (
            <div className="grid gap-3 border-t p-4 text-[12.5px] md:grid-cols-3">
              <div>
                <div className="eyebrow">Bundle</div>
                <Mono>
                  {last.event} · seq 0x{last.seq.toString(16)} · {last.bytes} B
                </Mono>
              </div>
              <div>
                <div className="eyebrow">Protection</div>
                <Mono>{last.alg}</Mono>
              </div>
              <div>
                <div className="eyebrow">At SOC</div>
                {last.dropped ? (
                  <Badge tone="bad">lost in transit</Badge>
                ) : last.verified ? (
                  <Badge tone="good">signature ✓ · decrypted</Badge>
                ) : (
                  <Badge tone="bad">invalid</Badge>
                )}
              </div>
              {last.bundle && (
                <div className="md:col-span-3">
                  <div className="eyebrow">What a relay sees (ciphertext only)</div>
                  <div className="mono mt-1 truncate text-[10.5px] text-muted-foreground">
                    ct={last.bundle.ct.slice(0, 48)}… body={last.bundle.body.slice(0, 40)}… σ=
                    {last.bundle.sig.slice(0, 32)}…
                  </div>
                </div>
              )}
            </div>
          )}
        </Panel>

        <div className="grid content-start gap-4">
          <Panel title="Nodes">
            {relays
              .filter((r) => r.kind === "RELAY" || r.kind === "GATEWAY")
              .map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between border-b py-2 text-[12.5px] last:border-0"
                >
                  <div>
                    <Mono className="font-semibold">{r.id}</Mono>
                    <div className="text-[11.5px] text-muted-foreground">
                      {r.label} · ML-DSA identity
                    </div>
                  </div>
                  <button
                    onClick={() =>
                      setRelayStatus(r.id, r.status === "OFFLINE" ? "NOMINAL" : "OFFLINE")
                    }
                  >
                    <Badge tone={r.status === "OFFLINE" ? "bad" : "good"}>{r.status}</Badge>
                  </button>
                </div>
              ))}
            <Button
              variant="outline"
              size="sm"
              className="mt-3 w-full"
              onClick={() => {
                armDrop();
                toast.message("A relay will silently drop the next bundle");
              }}
            >
              <Unplug /> Compromised relay: drop next bundle
            </Button>
          </Panel>
          <Panel title="Radio policy">
            <div className="flex flex-wrap gap-1.5">
              {[
                "IN865 · 865–867 MHz",
                "1 W ERP limit",
                "Transmit-only emitters",
                `Rate cap ${radio.rateCap} bundles/h`,
                "Fixed 120-byte schema",
                "Rolling pseudonymous IDs",
                "Every bundle ledgered",
              ].map((c) => (
                <Badge key={c} tone="navy">
                  {c}
                </Badge>
              ))}
            </div>
            <label className="mt-3 flex items-center justify-between text-[12.5px]">
              <span>
                RF fallback enabled{" "}
                <span className="text-muted-foreground">
                  (policy default: off — wired diode path)
                </span>
              </span>
              <input
                type="checkbox"
                checked={radio.rfEnabled}
                onChange={(e) => setRadio({ rfEnabled: e.target.checked })}
              />
            </label>
          </Panel>
          <Panel title="TEMPEST objection — four-part answer">
            <ol className="grid gap-1.5 text-[12.5px]">
              {[
                ["Transmit-only radio", "No receiver fitted — physically cannot accept a command."],
                [
                  "Bandwidth-capped",
                  "Fixed 120-byte schema, rate-limited — can never carry a document.",
                ],
                [
                  "Default off, opt-in per site",
                  "Wired path to the diode is primary; RF only where no cabling.",
                ],
                [
                  "Fully auditable",
                  "Each bundle is also written to the local ledger and reconciled.",
                ],
              ].map(([a, b], i) => (
                <li key={a} className="flex gap-2">
                  <span className="mono text-saffron">{i + 1}.</span>
                  <span>
                    <b>{a}.</b> <span className="text-muted-foreground">{b}</span>
                  </span>
                </li>
              ))}
            </ol>
          </Panel>
        </div>
      </div>
      <Panel className="mt-4" pad={false} title="Recent bundles">
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <tbody>
              {mesh.slice(0, 12).map((m) => (
                <tr key={m.id + m.time} className="border-b last:border-0">
                  <td className="px-4 py-2">
                    <Mono>{hms(m.time)}</Mono>
                  </td>
                  <td className="px-4 py-2">
                    <Mono>{m.device}</Mono>
                  </td>
                  <td className="px-4 py-2">
                    <Badge tone={m.event === "HEARTBEAT" ? "neutral" : "navy"}>{m.event}</Badge>
                  </td>
                  <td className="px-4 py-2">
                    <Mono>0x{m.seq.toString(16)}</Mono>
                  </td>
                  <td className="mono px-4 py-2 text-[10.5px] text-muted-foreground">
                    {m.route.join(" → ")}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {m.dropped ? (
                      <Badge tone="bad">dropped</Badge>
                    ) : (
                      <span className={cn("inline-flex items-center gap-1 text-success")}>
                        <ShieldCheck className="size-3.5" /> verified
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <div className="mt-3 flex items-center gap-2 text-[12px] text-muted-foreground">
        <Radio className="size-3.5" /> Proven paradigm: Apple Find My (offline BLE beacons relayed
        by any passing device), here with a signed decryption event, a private LoRa mesh and
        post-quantum algorithms.
      </div>
    </>
  );
}
