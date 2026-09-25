import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import {
  ArrowRight,
  Check,
  Pause,
  Play,
  RotateCcw,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { emitBundle, imageMatch, killAgent, setSession, tamper } from "@/lib/app";
import { cn } from "@/lib/utils";
import { Badge, PageHeader, Panel } from "@/components/cl/ui";

const TABS = [
  ["overview", "Problem & architecture"],
  ["compliance", "Compliance R1–R14"],
  ["script", "Jury demo script"],
  ["limits", "Honest limits & viva"],
] as const;
type Tab = (typeof TABS)[number][0];

const REQS: [string, string, string, string][] = [
  [
    "R1",
    "Unique invisible forensic watermark generated at the moment of decryption",
    "Joint fingerprinting: the key set only opens one A/B variant per segment",
    "/view/DOC-007",
  ],
  [
    "R2",
    "Watermark specific to each recipient and each session",
    "256 Tardos bits + 64 fresh session bits from the signed nonce",
    "/compare",
  ],
  [
    "R3",
    "Every copy visually identical but forensically distinct",
    "Sub-perceptual line/word shift + micro-pattern; pixel diff on demand",
    "/compare",
  ],
  [
    "R4",
    "Decryption cryptographically bound to recipient identity",
    "ML-DSA-65 signed request committed before key release",
    "/view/DOC-007",
  ],
  [
    "R5",
    "Signed with the recipient’s own private key (non-repudiation)",
    "Device-held ML-DSA key; server never holds it",
    "/devices",
  ],
  [
    "R6",
    "NIST post-quantum algorithms",
    "ML-KEM-768 (FIPS 203), ML-DSA-65 (FIPS 204), SLH-DSA (FIPS 205)",
    "/devices",
  ],
  [
    "R7",
    "Immutable audit layer — blockchain / DLT",
    "Three-org permissioned ledger + RFC 6962 Merkle log",
    "/ledger",
  ],
  [
    "R8",
    "No single admin can alter or delete records",
    "2-of-3 endorsement, witness co-signed checkpoints, tamper demo",
    "/ledger",
  ],
  [
    "R9",
    "Extract the watermark from a leaked document",
    "Pixel-level extractor: pHash page ID + line-centroid decoding + microdots",
    "/trace",
  ],
  [
    "R10",
    "Look the watermark up against the ledger",
    "Codeword → session → ledger record + inclusion proof",
    "/trace",
  ],
  [
    "R11",
    "Cryptographically verifiable record identifying the recipient",
    "Evidence bundle + standalone offline verifier",
    "/evidence/CASE-071",
  ],
  [
    "R12",
    "Complete operation offline / air-gapped",
    "Zone 1 self-contained; runs on a laptop with networking disabled",
    "/inbox",
  ],
  [
    "R13",
    "No external cloud KMS",
    "All keys generated and held locally (backend keystore / device tokens)",
    "/devices",
  ],
  [
    "R14",
    "No public blockchain",
    "Permissioned, local-only ledger; no gas, no internet",
    "/ledger",
  ],
];

type Step = {
  n: number;
  action: string;
  sees: string;
  line: string;
  to: string;
  run?: () => unknown;
  key?: boolean;
};
const STEPS: Step[] = [
  {
    n: 1,
    action: "Sender encrypts and distributes to 5 officers",
    sees: "Package built; REGISTER with codeword commitments",
    line: "One encryption, five recipients, identical package. The codeword commitments are published before anyone opens anything.",
    to: "/distribute/new",
    run: () => setSession("SENDER", "OFF-004"),
  },
  {
    n: 2,
    action: "Officer 4 requests decryption",
    sees: "Request signed, ledger commits, 2 quorum nodes release shares, document opens",
    line: "Notice the order. The log entry came first. Without it, no key is ever released.",
    to: "/view/DOC-007",
    run: () => setSession("OFFICER", "OFF-004"),
  },
  {
    n: 3,
    action: "Officer 2 and Officer 4 copies side by side",
    sees: "Visually identical; diff reveals differing segments",
    line: "Identical to the eye. Forensically distinct to us. The fingerprint is the decryption itself.",
    to: "/compare",
    run: () => setSession("INVESTIGATOR", "OFF-004"),
  },
  {
    n: 4,
    action: "LoRa beacon — laptop unplugged from every network",
    sees: "Bundle hops relay to relay; SOC shows the DECRYPT event",
    line: "That machine has no network. The alert still reached the SOC, carried hop by hop.",
    to: "/mesh",
    run: () => emitBundle("WS-NAVAL-14", "DECRYPT", "DOC-007"),
    key: true,
  },
  {
    n: 5,
    action: "Officer 4 prints one page",
    sees: "Print gateway logs a new ledger event with a new mark variant",
    line: "Every print is its own traceable artefact.",
    to: "/view/DOC-007",
    run: () => setSession("OFFICER", "OFF-004"),
  },
  {
    n: 6,
    action: "Shine the blue torch on the printed page",
    sees: "Yellow microdots become visible",
    line: "Printers have signed every page since the 1980s. We do it deliberately, and ours is unforgeable.",
    to: "/trace",
  },
  {
    n: 7,
    action: "Scan the printed page, run the extractor",
    sees: "Our mark and the manufacturer MIC both decode to the same print job",
    line: "Two independent attributions from one sheet of paper.",
    to: "/trace",
  },
  {
    n: 8,
    action: "Photograph the screen, upload to a test channel",
    sees: "pHash monitor fires; correlates to Officer 4’s session",
    line: "The canary cannot survive a photograph. The perceptual hash can.",
    to: "/soc",
    run: () => imageMatch("DOC-007", 3),
  },
  {
    n: 9,
    action: "Collusion: merge Officer 2 and Officer 5 copies",
    sees: "Tardos scoring names both, with the false-accusation probability",
    line: "They tried to hide in each other. The mathematics names them both, and tells you the chance we are wrong.",
    to: "/trace",
    key: true,
  },
  {
    n: 10,
    action: "Kill the SENTINEL agent on the laptop",
    sees: "About 20 s later a missing-heartbeat alert appears",
    line: "Silence is also a signal.",
    to: "/soc",
    run: () => killAgent("OFF-004"),
  },
  {
    n: 11,
    action: "Admin tampers with a ledger record",
    sees: "Checkpoint verification fails visibly",
    line: "A privileged administrator cannot quietly erase this.",
    to: "/ledger",
    run: () => tamper("EDIT", 7),
  },
  {
    n: 12,
    action: "Run the offline verifier with the server off",
    sees: "All proofs re-verify independently",
    line: "A court does not have to trust our system. It can check the evidence itself.",
    to: "/evidence/CASE-071",
  },
];

const LIMITS: [string, string, string][] = [
  [
    "Analogue hole",
    "Nobody can stop someone reading aloud, memorising or rewriting a document",
    "We do not claim to prevent leaks — we attribute and deter. Say it in the first minute.",
  ],
  [
    "Unmanaged camera",
    "A personal phone photographing a screen emits no telemetry",
    "Attribution survives the photo (L1–L3); pHash monitor catches it when uploaded.",
  ],
  [
    "Canary detectable",
    "A careful adversary can block the callback",
    "Two independent layers remain (pHash, phrase). Defence in depth.",
  ],
  [
    "Heavy crop",
    "A single paragraph carries few marks",
    "Confidence and erasures are reported; low confidence is reported as low confidence.",
  ],
  [
    "Package size doubles",
    "Both variants of every segment are shipped",
    "Acceptable for documents — stated openly.",
  ],
  [
    "Fabric is internally ECDSA",
    "The DLT layer is not natively post-quantum",
    "PQC layer above it; SLH-DSA checkpoints; hybrid ML-DSA-65/ECDSA Fabric is the production path.",
  ],
  [
    "MFP SDK cost",
    "Canon MEAP SDK ≈ $5,000 plus royalties",
    "Simulated here; MEAP / SmartSDK / EIP named as production path.",
  ],
  [
    "RF inside a secure facility",
    "Accreditation objection",
    "Transmit-only, bandwidth-capped, default off, fully auditable.",
  ],
  [
    "Lexical marking changes wording",
    "Dangerous in orders and technical text",
    "Disabled by default, prose only, never numbers, coordinates or legal wording.",
  ],
  [
    "Prototype scope",
    "This build simulates Fabric, MFP hooks and radio hardware",
    "CORE is working; EXTENDED is shown as prototyped — see the labels.",
  ],
];

export function BriefingPage() {
  const loc = useLocation();
  const nav = useNavigate();
  const initial = (loc.hash as Tab) || "overview";
  const [tab, setTab] = useState<Tab>(TABS.some(([t]) => t === initial) ? initial : "overview");
  const [done, setDone] = useState<number[]>([]);
  const [t0, setT0] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (loc.hash && TABS.some(([t]) => t === loc.hash)) setTab(loc.hash as Tab);
  }, [loc.hash]);
  useEffect(() => {
    if (t0 === null) return;
    const id = setInterval(() => setElapsed(Date.now() - t0), 500);
    return () => clearInterval(id);
  }, [t0]);

  const go = async (s: Step) => {
    try {
      await s.run?.();
    } catch (e) {
      toast.error((e as Error).message);
    }
    setDone((d) => (d.includes(s.n) ? d : [...d, s.n]));
    nav({ to: s.to });
  };

  return (
    <>
      <PageHeader
        eyebrow="Overview / SIH26237 · Blockchain & Cybersecurity · Software"
        title="ChainLock + SENTINEL — Briefing"
        sub="Cryptographic attribution and immutable decryption provenance for multi-recipient encrypted document distribution."
      />
      <div className="mb-4 flex flex-wrap gap-1 border-b">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={cn(
              "-mb-px border-b-2 px-4 py-2 text-[13px] font-medium",
              tab === id
                ? "border-saffron text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="grid gap-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="The problem">
              <p className="text-[13.5px] leading-relaxed">
                One encrypted document, fifty recipients. Every decrypted copy is byte-for-byte
                identical, so when it leaks, all fifty are equally plausible suspects. Server logs
                can be edited by the admin who leaked it; static watermarks are identical on every
                copy.
              </p>
              <div className="mt-3 rounded-lg bg-muted/60 p-3 text-[12.5px]">
                <b>09:00</b> HQ distributes Operation Order 7 to 5 officers · <b>09:14</b> Officer 4
                opens it · <b>09:41</b> prints one copy · <b>14:32</b> a photo appears on Telegram.
                Who? Can we prove it? When? Can they deny it? Could an admin erase it?
              </div>
            </Panel>
            <Panel title="Why the obvious design fails — and how we close each hole">
              <ol className="grid gap-2 text-[13px]">
                {[
                  [
                    "Client can skip the watermark",
                    "We never decrypt an unmarked document — the fingerprint is in the keys.",
                  ],
                  [
                    "Two recipients erase the mark together",
                    "Tardos collusion-secure codes name both, with an error bound.",
                  ],
                  [
                    "Real leaks are prints and photos",
                    "Structural marks, microdots, pHash monitoring.",
                  ],
                  [
                    "“Quantum-safe ledger” isn’t",
                    "PQC signatures above the DLT + hash-based SLH-DSA checkpoints.",
                  ],
                ].map(([a, b], i) => (
                  <li key={a} className="flex gap-3">
                    <span className="mono mt-0.5 text-destructive">Hole {i + 1}</span>
                    <span>
                      <b>{a}.</b> <span className="text-muted-foreground">{b}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </Panel>
          </div>
          <Panel title="Three zones — handbook §3.1">
            <div className="grid gap-3 lg:grid-cols-[1.4fr_auto_1fr]">
              <div className="rounded-[10px] border-2 border-destructive/40 p-3">
                <div className="eyebrow !text-destructive">
                  Zone 1 · air-gapped secure enclave (ChainLock)
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-[12px] md:grid-cols-3">
                  {[
                    "Sender console",
                    "Encrypted package store",
                    "Recipient workstation + agent",
                    "Ledger: 3 orgs + Merkle log",
                    "Key-release quorum 2-of-3",
                    "Print gateway · MFP hook",
                    "Forensic extractor",
                    "Offline verifier",
                    "Crypto core (PQC)",
                  ].map((x) => (
                    <div key={x} className="rounded-md bg-muted/70 px-2 py-1.5">
                      {x}
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex flex-col items-center justify-center gap-1 text-[11px] text-muted-foreground">
                <ArrowRight className="size-5 text-success" />
                <span className="mono">DATA DIODE</span>
                <span>one-way</span>
              </div>
              <div className="rounded-[10px] border-2 border-success/40 p-3">
                <div className="eyebrow !text-success">
                  Zone 2 · internet-facing monitor (SENTINEL)
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-[12px]">
                  {[
                    "Canary server",
                    "pHash monitor",
                    "Phrase monitor",
                    "Alert correlator",
                    "SOC dashboard",
                  ].map((x) => (
                    <div key={x} className="rounded-md bg-muted/70 px-2 py-1.5">
                      {x}
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="mt-3 rounded-[10px] border border-primary/40 p-3 text-[12.5px]">
              <b>Zone 3 · relay fabric (SENTINEL-MESH):</b> workstation transmit-only beacon →
              corridor gateway / guard handset → LoRa relay → wired gateway → diode → Zone 2.
            </div>
          </Panel>
          <Panel title="Five design pillars">
            <div className="grid gap-3 md:grid-cols-5">
              {[
                ["Log before decrypt", "No ledger entry ⇒ no key share ⇒ no decryption. Ever."],
                [
                  "Fingerprint in the keys",
                  "Each officer can only open one of two variants per segment.",
                ],
                ["Collusion-resistant", "Tardos codes still name colluders who mix copies."],
                ["Layered marks", "Line/word shift, glyph, micro-pattern, optional lexical."],
                [
                  "Evidence, not accusation",
                  "Bundle with proofs, scores and error bound — verifiable offline.",
                ],
              ].map(([a, b], i) => (
                <div key={a} className="rounded-lg border p-3">
                  <div className="mono text-saffron">0{i + 1}</div>
                  <div className="mt-1 text-[13.5px] font-semibold">{a}</div>
                  <div className="mt-1 text-[12px] text-muted-foreground">{b}</div>
                </div>
              ))}
            </div>
          </Panel>
          <div className="grid gap-4 md:grid-cols-2">
            <Panel title="CORE — working in this prototype">
              <ul className="grid gap-1 text-[13px]">
                {[
                  "Log-before-decrypt with 2-of-3 endorsement and key-release quorum",
                  "Key-bound A/B fingerprint (320 segments, Tardos 256 + 64)",
                  "PQC signatures (ML-DSA-65 / SLH-DSA via Crypto Core), SHA3 hash chain, Merkle proofs",
                  "Pixel-level forensic extraction + Tardos accusation",
                  "Evidence bundle + offline verifier (browser + Python)",
                ].map((x) => (
                  <li key={x} className="flex gap-2">
                    <Check className="mt-0.5 size-4 shrink-0 text-success" />
                    {x}
                  </li>
                ))}
              </ul>
            </Panel>
            <Panel title="EXTENDED — shown as prototyped">
              <ul className="grid gap-1 text-[13px]">
                {[
                  "SENTINEL Zone 2 monitors (canary, pHash, phrase) — events simulated",
                  "SENTINEL-MESH relays — real bundle crypto, simulated radio hardware",
                  "Print gateway microdots real; MFP scan hook simulated (MEAP/SmartSDK/EIP in production)",
                  "Hyperledger Fabric replaced by an in-process 3-org ledger for the demo",
                ].map((x) => (
                  <li key={x} className="flex gap-2">
                    <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
                    {x}
                  </li>
                ))}
              </ul>
            </Panel>
          </div>
        </div>
      )}

      {tab === "compliance" && (
        <Panel pad={false} title="Requirement-by-requirement compliance matrix">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b text-left">
                  {["#", "Requirement", "How ChainLock satisfies it", "Status", ""].map((h) => (
                    <th key={h} className="eyebrow px-4 py-2.5">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {REQS.map(([id, req, how, to]) => (
                  <tr key={id} className="border-b last:border-0">
                    <td className="mono px-4 py-2.5 font-semibold">{id}</td>
                    <td className="px-4 py-2.5">{req}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{how}</td>
                    <td className="px-4 py-2.5">
                      <Badge tone="good">
                        <ShieldCheck className="size-3" /> demo
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Link
                        to={to}
                        className="text-[12px] whitespace-nowrap text-primary underline"
                      >
                        Show me →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {tab === "script" && (
        <div id="script" className="grid gap-4">
          <Panel
            title="Six leak channels, all detected, all attributed, all offline — target under 5 minutes"
            right={
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "mono text-[15px] font-semibold tabular-nums",
                    elapsed > 300000 && "text-destructive",
                  )}
                >
                  {String(Math.floor(elapsed / 60000)).padStart(2, "0")}:
                  {String(Math.floor((elapsed % 60000) / 1000)).padStart(2, "0")}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => (t0 === null ? setT0(Date.now() - elapsed) : setT0(null))}
                >
                  {t0 === null ? <Play /> : <Pause />}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setT0(null);
                    setElapsed(0);
                    setDone([]);
                  }}
                >
                  <RotateCcw />
                </Button>
              </div>
            }
          >
            <div className="grid gap-2">
              {STEPS.map((s) => (
                <div
                  key={s.n}
                  className={cn(
                    "grid items-center gap-3 rounded-lg border px-3 py-2.5 md:grid-cols-[36px_1.1fr_1fr_1.3fr_auto]",
                    done.includes(s.n) && "border-success/40 bg-success/5",
                    s.key && "border-l-4 border-l-saffron",
                  )}
                >
                  <span
                    className={cn(
                      "grid size-7 place-items-center rounded-full border text-[12px] font-bold",
                      done.includes(s.n) && "border-success bg-success text-white",
                    )}
                  >
                    {done.includes(s.n) ? <Check className="size-3.5" /> : s.n}
                  </span>
                  <div className="text-[13px] font-medium">{s.action}</div>
                  <div className="text-[12px] text-muted-foreground">{s.sees}</div>
                  <div className="text-[12.5px] italic">“{s.line}”</div>
                  <Button size="sm" onClick={() => void go(s)}>
                    Go <ArrowRight />
                  </Button>
                </div>
              ))}
            </div>
            <div className="mt-3 text-[12.5px] text-muted-foreground">
              <b className="text-saffron">The best 30 seconds:</b> steps 4 and 9 (marked). If time
              is cut, protect those two.
            </div>
          </Panel>
        </div>
      )}

      {tab === "limits" && (
        <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
          <Panel pad={false} title="Risks & honest limits — say them before the jury does">
            <table className="w-full text-[12.5px]">
              <tbody>
                {LIMITS.map(([a, b, c]) => (
                  <tr key={a} className="border-b align-top last:border-0">
                    <td className="px-4 py-2.5 font-semibold">{a}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{b}</td>
                    <td className="px-4 py-2.5">{c}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
          <Panel title="Viva — ready answers">
            <div className="grid gap-3 text-[12.5px]">
              {[
                [
                  "Why not watermark after decryption?",
                  "That step would run on hardware the suspect controls. We never decrypt an unmarked document — there is nothing clean to strip.",
                ],
                [
                  "Two recipients compare copies?",
                  "Tardos codes: the accusation still names them and reports the false-accusation bound.",
                ],
                [
                  "Why ML-DSA, not Falcon?",
                  "FIPS 206 (FN-DSA) is still a draft and its floating-point signing path is hard to make constant-time. We record the algorithm id on every signature for migration.",
                ],
                [
                  "Fabric signs with ECDSA.",
                  "Correct — we say so. PQC above it, SLH-DSA checkpoints; hybrid ML-DSA-65/ECDSA Fabric is the production path.",
                ],
                [
                  "Could the Navy fabricate a codeword?",
                  "No. Codeword hashes are committed at REGISTER, before anyone decrypts.",
                ],
                [
                  "You put a radio in my air gap.",
                  "Transmit-only, bandwidth-capped, default off, fully auditable.",
                ],
                [
                  "What can’t it do?",
                  "Stop the analogue hole or instrument a device we don’t own. It attributes and deters.",
                ],
                [
                  "National fit?",
                  "DST Quantum-Safe task force (Feb 2026): defence pilots by 2027. This is such a pilot.",
                ],
              ].map(([q, a]) => (
                <div key={q}>
                  <div className="font-semibold">{q}</div>
                  <div className="text-muted-foreground">{a}</div>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      )}
    </>
  );
}
