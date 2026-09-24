import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Check, FileText, Loader2, Send, TriangleAlert, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { distribute, useApp } from "@/lib/app";
import { documentLines, isProseLine } from "@/lib/engine/content";
import type { Classification, DocumentRecord } from "@/lib/engine/model";
import { cn } from "@/lib/utils";
import {
  Badge,
  Callout,
  Hash,
  Kv,
  Mono,
  PageHeader,
  Panel,
  Stepper,
  classificationTone,
} from "@/components/cl/ui";
import { fmtBytes } from "@/components/cl/hooks";

const BUILD_STEPS = [
  ["Segment document", "10 pages → 320 marking sites (32 per page)"],
  ["Render A/B variants", "640 variants · line shift · word shift · micro-pattern"],
  ["Encrypt every variant", "640 × AES-256-GCM · fresh 12-byte nonce each"],
  ["Draw Tardos bias vector", "256 secret biases — sealed in ORG-SEC tracing key"],
  ["Generate recipient codewords", "256 Tardos bits each + 64 session bits at open time"],
  ["Split key sets 2-of-3", "Shamir GF(256) → Security · Audit · Command"],
  ["Commit to ledger", "REGISTER + codeword commitments, sender ML-DSA-65 signature"],
] as const;

export function DistributePage() {
  const officers = useApp((s) => s.officers);
  const online = useApp((s) => s.orgs.filter((o) => o.online).length);
  const [step, setStep] = useState(0);
  const [title, setTitle] = useState("Operation Order 8 — Harbour Defence Drill");
  const [classification, setClassification] = useState<Classification>("SECRET");
  const [fileName, setFileName] = useState<string | null>(null);
  const [customText, setCustomText] = useState<string | undefined>(undefined);
  const [recipients, setRecipients] = useState<string[]>([
    "OFF-001",
    "OFF-002",
    "OFF-003",
    "OFF-004",
    "OFF-005",
  ]);
  const [layer4, setLayer4] = useState(false);
  const [progress, setProgress] = useState(-1);
  const [result, setResult] = useState<{ doc: DocumentRecord; index: number } | null>(null);

  const previewId = "DOC-PREVIEW";
  const lines = useMemo(() => documentLines(previewId, customText), [customText]);
  const proseEligible = useMemo(() => lines.filter(isProseLine).length, [lines]);

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setFileName(`${f.name} · ${fmtBytes(f.size)}`);
    if (!title || title.startsWith("Operation Order 8"))
      setTitle(f.name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " "));
    if (/\.(txt|md)$/i.test(f.name) || f.type.startsWith("text/")) {
      setCustomText(await f.text());
      toast.success("Text extracted — your content will be segmented and marked");
    } else {
      setCustomText(undefined);
      toast.message("Prototype renders text documents", {
        description:
          "PDF/DOCX parsing (PyMuPDF) is on the production path; the synthetic template body is used for this package.",
      });
    }
  };

  const run = async () => {
    setProgress(0);
    for (let i = 0; i < BUILD_STEPS.length - 1; i++) {
      setProgress(i);
      await new Promise((r) => setTimeout(r, 520));
    }
    setProgress(BUILD_STEPS.length - 1);
    try {
      const { doc, record } = await distribute({
        title,
        classification,
        recipients,
        layer4,
        ...(customText ? { customText } : {}),
      });
      setProgress(BUILD_STEPS.length);
      setResult({ doc, index: record.index });
      setStep(3);
      toast.success(`${doc.id} distributed · REGISTER #${record.index}`, {
        description: `${recipients.length} recipients · commitments published before any decryption`,
      });
    } catch (e) {
      setProgress(-1);
      toast.error((e as Error).message);
    }
  };

  const avail = officers.filter((o) => o.status === "ACTIVE");

  return (
    <>
      <PageHeader
        eyebrow="HQ sender / package control"
        title="New Secure Distribution"
        sub="One encryption, many recipients, identical package — every recipient can only ever open their own variant of each segment."
      />
      <div className="mb-5">
        <Stepper
          steps={["Upload", "Recipients & marks", "Review & build", "Distributed"]}
          current={step}
        />
      </div>

      {step === 0 && (
        <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
          <Panel title="Document">
            <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-[10px] border-2 border-dashed px-6 py-10 text-center hover:border-primary hover:bg-primary/5">
              <Upload className="size-8 text-primary" />
              <div className="font-medium">{fileName ?? "Drop a document or click to choose"}</div>
              <div className="text-[12px] text-muted-foreground">
                .txt / .md are segmented and marked with your text · other formats use the synthetic
                template
              </div>
              <input
                type="file"
                className="hidden"
                onChange={(e) => void onFile(e.target.files?.[0])}
              />
            </label>
            <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_180px]">
              <div>
                <label className="text-[12px] text-muted-foreground">Title</label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="mt-1 h-9 w-full rounded-md border bg-background px-3"
                />
              </div>
              <div>
                <label className="text-[12px] text-muted-foreground">Classification</label>
                <select
                  value={classification}
                  onChange={(e) => setClassification(e.target.value as Classification)}
                  className="mt-1 h-9 w-full rounded-md border bg-background px-2"
                >
                  <option>SECRET</option>
                  <option>CONFIDENTIAL</option>
                  <option>RESTRICTED</option>
                </select>
              </div>
            </div>
            <div className="mt-4 flex justify-end">
              <Button onClick={() => setStep(1)} disabled={!title.trim()}>
                Continue
              </Button>
            </div>
          </Panel>
          <Panel title="Segment preview (first lines)">
            <div className="mono grid gap-0.5 text-[11px]">
              {lines.slice(0, 16).map((l, i) => (
                <div key={i} className="flex gap-3">
                  <span className="w-8 text-muted-foreground">
                    s{String(i + 1).padStart(3, "0")}
                  </span>
                  <span className="truncate">{l}</span>
                </div>
              ))}
              <div className="text-muted-foreground">… 320 segments total</div>
            </div>
          </Panel>
        </div>
      )}

      {step === 1 && (
        <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
          <Panel title={`Recipients (${recipients.length})`}>
            <div className="grid gap-2">
              {officers.map((o) => {
                const on = recipients.includes(o.id);
                const disabled = o.status !== "ACTIVE";
                return (
                  <label
                    key={o.id}
                    className={cn(
                      "flex items-center gap-3 rounded-lg border px-3 py-2.5",
                      on && "border-primary bg-primary/5",
                      disabled && "opacity-50",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={disabled}
                      onChange={() =>
                        setRecipients((r) => (on ? r.filter((x) => x !== o.id) : [...r, o.id]))
                      }
                    />
                    <div className="flex-1">
                      <div className="font-medium">
                        {o.rank} {o.name} <Mono className="text-muted-foreground">{o.id}</Mono>
                      </div>
                      <Mono className="text-muted-foreground">
                        {o.device} · KEM pk {o.keys.kem?.pk.slice(0, 14)}…
                      </Mono>
                    </div>
                    {disabled ? (
                      <Badge tone="bad">revoked</Badge>
                    ) : (
                      <Badge tone="good">enrolled</Badge>
                    )}
                  </label>
                );
              })}
            </div>
            <div className="mt-4 flex justify-between">
              <Button variant="outline" onClick={() => setStep(0)}>
                Back
              </Button>
              <Button onClick={() => setStep(2)} disabled={recipients.length === 0}>
                Continue
              </Button>
            </div>
          </Panel>
          <div className="grid content-start gap-4">
            <Panel title="Mark layers">
              {[
                ["L1 · Line & word shift", "Survives print, photocopy, scan, fax", true],
                [
                  "L2 · Glyph / word-space perturbation",
                  "Survives photographs and format conversion",
                  true,
                ],
                ["L3 · Background micro-pattern", "Survives phone photos of a screen", true],
              ].map(([a, b]) => (
                <div
                  key={String(a)}
                  className="flex items-center justify-between border-b py-2 last:border-0"
                >
                  <div>
                    <div className="text-[13px] font-medium">{a}</div>
                    <div className="text-[12px] text-muted-foreground">{b}</div>
                  </div>
                  <Badge tone="good">always on</Badge>
                </div>
              ))}
              <label className="mt-2 flex items-center justify-between gap-3 py-2">
                <div>
                  <div className="text-[13px] font-medium">L4 · Lexical variants (optional)</div>
                  <div className="text-[12px] text-muted-foreground">
                    Survives retyping — changes wording
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={layer4}
                  onChange={(e) => setLayer4(e.target.checked)}
                  className="size-4"
                />
              </label>
              {layer4 && (
                <Callout
                  tone="warn"
                  icon={<TriangleAlert className="text-warning" />}
                  title="Prose-only region detection active"
                  className="mt-2"
                >
                  {proseEligible} of 320 segments eligible. Lines containing numbers, coordinates,
                  call signs, codewords or ALL-CAPS terms are never altered. Never enable for
                  orders, legal wording or technical specifications.
                </Callout>
              )}
            </Panel>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
          <Panel title="Package build">
            <ol className="grid gap-1.5">
              {BUILD_STEPS.map(([a, b], i) => (
                <li
                  key={a}
                  className={cn(
                    "flex items-center gap-3 rounded-md px-2 py-1.5",
                    progress === i && "bg-primary/8",
                  )}
                >
                  <span
                    className={cn(
                      "grid size-5 place-items-center rounded-full border text-[10px]",
                      progress > i && "border-success bg-success text-white",
                      progress === i && "border-primary",
                    )}
                  >
                    {progress > i ? (
                      <Check className="size-3" />
                    ) : progress === i ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      i + 1
                    )}
                  </span>
                  <div>
                    <div className="text-[13px] font-medium">{a}</div>
                    <div className="text-[12px] text-muted-foreground">{b}</div>
                  </div>
                </li>
              ))}
            </ol>
            {online < 2 && (
              <Callout tone="bad" className="mt-3" title="Ledger quorum unavailable">
                Only {online}/3 offices online — the REGISTER transaction cannot be endorsed.
              </Callout>
            )}
            <div className="mt-4 flex justify-between">
              <Button variant="outline" onClick={() => setStep(1)} disabled={progress >= 0}>
                Back
              </Button>
              <Button
                onClick={() => void run()}
                disabled={progress >= 0}
                className="bg-saffron text-white hover:bg-saffron/90"
              >
                <Send /> Build & distribute
              </Button>
            </div>
          </Panel>
          <Panel title="Review">
            <div className="grid grid-cols-2 gap-2">
              {[
                ["Pieces", "320"],
                ["Locked variants", "640"],
                ["Recipients / fingerprints", String(recipients.length)],
                [
                  "Package size",
                  `≈ ${fmtBytes(lines.reduce((n, l) => n + 2 * (l.length + 28), 0) + 4096)}`,
                ],
              ].map(([a, b]) => (
                <div key={a} className="rounded-lg bg-muted/60 px-3 py-2.5">
                  <div className="eyebrow">{a}</div>
                  <div className="text-[20px] font-semibold tabular-nums">{b}</div>
                </div>
              ))}
            </div>
            <Kv
              className="mt-4"
              rows={[
                ["Title", title],
                [
                  "Classification",
                  <Badge key="c" tone={classificationTone(classification)}>
                    {classification}
                  </Badge>,
                ],
                ["Recipients", recipients.join(", ")],
                ["Layer 4", layer4 ? "enabled (prose only)" : "disabled"],
                [
                  "Ledger commitment",
                  "SHA3-256 of every codeword + bias vector, published before any decryption",
                ],
              ]}
            />
            <div className="mt-3 text-[12px] text-muted-foreground">
              Cost stated openly: the package carries both variants of every segment, so it is
              roughly twice the size of the source document.
            </div>
          </Panel>
        </div>
      )}

      {step === 3 && result && (
        <Panel title="Distribution registered">
          <div className="flex flex-wrap items-start gap-6">
            <div className="grid size-14 place-items-center rounded-full bg-success/15 text-success">
              <Check className="size-7" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[18px] font-semibold">
                {result.doc.id} · {result.doc.title}
              </div>
              <div className="mt-1 text-[13px] text-muted-foreground">
                REGISTER block #{result.index} committed with {online}/3 endorsements and a
                witness-co-signed checkpoint.
              </div>
              <Kv
                className="mt-4"
                rows={[
                  ["Package hash", <Hash key="p" value={result.doc.packageHash} n={16} />],
                  ["Package size", fmtBytes(result.doc.packageBytes)],
                  [
                    "Bias commitment",
                    <Hash key="b" value={result.doc.tracing.biasCommitment} n={16} />,
                  ],
                  ...result.doc.recipients.map(
                    (r) =>
                      [
                        `${r} commitment`,
                        <Hash key={r} value={result.doc.tracing.commitments[r]} n={16} />,
                      ] as [string, React.ReactNode],
                  ),
                ]}
              />
              <div className="mt-4 flex flex-wrap gap-2">
                <Button asChild>
                  <Link to="/distributions/$docId" params={{ docId: result.doc.id }}>
                    <FileText /> Open distribution
                  </Link>
                </Button>
                <Button asChild variant="outline">
                  <Link to="/view/$docId" params={{ docId: result.doc.id }}>
                    Open as officer
                  </Link>
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setStep(0);
                    setProgress(-1);
                    setResult(null);
                  }}
                >
                  New distribution
                </Button>
              </div>
            </div>
          </div>
        </Panel>
      )}
    </>
  );
}
