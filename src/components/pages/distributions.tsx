import { useMemo, useState, type ReactNode } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { ChevronLeft, FilePlus, ShieldCheck, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { hms, useApp } from "@/lib/app";
import { commitBiases, commitCodeword } from "@/lib/engine/tardos";
import {
  Badge,
  Empty,
  Hash,
  Kv,
  Metric,
  Mono,
  PageHeader,
  Panel,
  PieceGrid,
  classificationTone,
} from "@/components/cl/ui";
import { fmtBytes } from "@/components/cl/hooks";

export function DistributionsPage() {
  const docs = useApp((s) => s.documents);
  const ledger = useApp((s) => s.ledger);
  return (
    <>
      <PageHeader
        eyebrow="HQ sender / audit"
        title="Distributions"
        sub="Open counts are read from the ledger, not from any client — an officer cannot open a document without leaving a signed record."
        actions={
          <Button asChild className="bg-saffron text-white hover:bg-saffron/90">
            <Link to="/distribute/new">
              <FilePlus /> New distribution
            </Link>
          </Button>
        }
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {docs.map((d) => {
          const opens = ledger.filter((r) => r.docId === d.id && r.type === "DECRYPT");
          const openedBy = new Set(opens.map((r) => r.actor));
          const prints = ledger.filter((r) => r.docId === d.id && r.type === "PRINT").length;
          return (
            <Panel key={d.id}>
              <div className="flex items-center justify-between">
                <Badge tone={classificationTone(d.classification)}>{d.classification}</Badge>
                <Mono className="text-muted-foreground">{d.id}</Mono>
              </div>
              <div className="mt-2 text-[16px] font-semibold">{d.title}</div>
              <div className="text-[12.5px] text-muted-foreground">
                {d.sender} · registered {hms(d.createdAt)}Z · ledger #{d.registerIndex}
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-md bg-muted/60 py-2">
                  <div className="text-[18px] font-semibold">
                    {openedBy.size}/{d.recipients.length}
                  </div>
                  <div className="eyebrow">opened</div>
                </div>
                <div className="rounded-md bg-muted/60 py-2">
                  <div className="text-[18px] font-semibold">{opens.length}</div>
                  <div className="eyebrow">sessions</div>
                </div>
                <div className="rounded-md bg-muted/60 py-2">
                  <div className="text-[18px] font-semibold">{prints}</div>
                  <div className="eyebrow">prints</div>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1">
                {d.recipients.map((r) => (
                  <Badge key={r} tone={openedBy.has(r) ? "good" : "neutral"}>
                    {r}
                  </Badge>
                ))}
              </div>
              <Button asChild variant="outline" className="mt-3 w-full">
                <Link to="/distributions/$docId" params={{ docId: d.id }}>
                  View detail
                </Link>
              </Button>
            </Panel>
          );
        })}
      </div>
    </>
  );
}

export function DistributionDetailPage() {
  const { docId } = useParams({ strict: false }) as { docId?: string };
  const docs = useApp((s) => s.documents);
  const ledger = useApp((s) => s.ledger);
  const officers = useApp((s) => s.officers);
  const doc = docs.find((d) => d.id === docId);
  const [shown, setShown] = useState<string | null>(null);
  const events = useMemo(() => ledger.filter((r) => r.docId === docId), [ledger, docId]);
  if (!doc)
    return (
      <Panel>
        <Empty
          icon={<ShieldAlert />}
          title="Distribution not found"
          sub={`${docId} is not registered on this ledger.`}
          action={
            <Link to="/distributions" className="text-primary underline">
              All distributions
            </Link>
          }
        />
      </Panel>
    );
  const reg = ledger[doc.registerIndex - 1];
  const verify = () => {
    const regMap = Object.fromEntries(
      String(reg?.meta?.["commitments"] ?? "")
        .split(",")
        .map((kv) => kv.split("=") as [string, string]),
    );
    const ok =
      doc.recipients.every(
        (r) =>
          commitCodeword(doc.id, r, doc.tracing.codewords[r] ?? [], doc.tracing.salts[r] ?? "") ===
          regMap[r],
      ) &&
      commitBiases(doc.id, doc.tracing.biases, doc.tracing.biasSalt) ===
        reg?.meta?.["biasCommitment"];
    if (ok)
      toast.success("All codeword and bias commitments match the REGISTER record", {
        description: "The sealed tracing key cannot be swapped to frame an officer.",
      });
    else toast.error("Commitment mismatch!");
  };
  return (
    <>
      <PageHeader
        eyebrow="HQ sender / distribution detail"
        title={`${doc.id} · ${doc.title}`}
        actions={
          <>
            <Button variant="outline" onClick={verify}>
              <ShieldCheck /> Verify commitments
            </Button>
            <Button variant="outline" asChild>
              <Link to="/distributions">
                <ChevronLeft /> All distributions
              </Link>
            </Button>
          </>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Metric label="Recipients" value={doc.recipients.length} />
        <Metric label="Segments" value="320" sub="640 locked variants" />
        <Metric
          label="Package"
          value={fmtBytes(doc.packageBytes)}
          sub="≈ 2× source (both variants)"
        />
        <Metric
          label="Sessions"
          value={events.filter((e) => e.type === "DECRYPT").length}
          tone="navy"
        />
        <Metric
          label="Prints"
          value={events.filter((e) => e.type === "PRINT").length}
          tone="warn"
        />
      </div>
      <div className="grid gap-4 xl:grid-cols-[1.3fr_1fr]">
        <Panel title="Recipients & fingerprint commitments" pad={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b text-left">
                  {["Recipient", "Device", "Commitment (on-chain)", "Sessions", "Status", ""].map(
                    (h) => (
                      <th key={h} className="eyebrow px-4 py-2.5">
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {doc.recipients.map((r) => {
                  const o = officers.find((x) => x.id === r);
                  const n = events.filter((e) => e.actor === r && e.type === "DECRYPT").length;
                  return (
                    <tr key={r} className="border-b last:border-0">
                      <td className="px-4 py-2.5">
                        <div className="font-medium">
                          {o?.rank} {o?.name}
                        </div>
                        <Mono className="text-muted-foreground">{r}</Mono>
                      </td>
                      <td className="px-4 py-2.5">
                        <Mono>{o?.device}</Mono>
                      </td>
                      <td className="px-4 py-2.5">
                        <Hash value={doc.tracing.commitments[r]} n={12} />
                      </td>
                      <td className="px-4 py-2.5">{n}</td>
                      <td className="px-4 py-2.5">
                        {o?.status === "REVOKED" ? (
                          <Badge tone="bad">revoked</Badge>
                        ) : n ? (
                          <Badge tone="good">opened</Badge>
                        ) : (
                          <Badge tone="warn">pending</Badge>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <button
                          className="text-[12px] text-primary underline"
                          onClick={() => setShown(shown === r ? null : r)}
                        >
                          {shown === r ? "hide" : "codeword"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {shown && (
            <div className="border-t p-4">
              <div className="mb-2 text-[12.5px] text-muted-foreground">
                Sealed tracing key (ORG-SEC only) — {shown}’s 256 Tardos bits; the last 64 positions
                are fixed per session at decryption time.
              </div>
              <PieceGrid bits={[...(doc.tracing.codewords[shown] ?? []), ...Array(64).fill(-1)]} />
            </div>
          )}
        </Panel>
        <Panel title="Document timeline (ledger)">
          <ol className="relative grid gap-3 border-l pl-4">
            {events.map((e) => (
              <li key={e.index} className="relative">
                <span
                  className={`absolute top-1.5 -left-[21px] size-2.5 rounded-full ${e.type === "PRINT" ? "bg-warning" : e.type === "REGISTER" ? "bg-saffron" : e.type === "DECRYPT" ? "bg-primary" : "bg-muted-foreground"}`}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Mono className="text-muted-foreground">{hms(e.time)}Z</Mono>
                  <Badge
                    tone={e.type === "PRINT" ? "warn" : e.type === "REGISTER" ? "navy" : "neutral"}
                  >
                    {e.type}
                  </Badge>
                  <span className="text-[13px] font-medium">{e.actor}</span>
                  <Mono className="text-muted-foreground">#{e.index}</Mono>
                </div>
                <div className="text-[12px] text-muted-foreground">{e.detail}</div>
              </li>
            ))}
          </ol>
        </Panel>
      </div>
      <Panel className="mt-4" title="Package statistics">
        <Kv
          rows={[
            ["Package hash", <Hash key="h" value={doc.packageHash} n={20} />],
            ["Bias commitment", <Hash key="b" value={doc.tracing.biasCommitment} n={20} />],
            ["Sender signature", <Mono key="s">{reg?.algoId}</Mono>],
            ["Endorsed by", (reg?.endorsements ?? []).join(" · ") as ReactNode],
            ["Layer 4 lexical", String(reg?.meta?.["layer4"] ?? "DISABLED")],
            ["Key sets", "2-of-3 Shamir shares held by Security, Audit, Command"],
          ]}
        />
      </Panel>
    </>
  );
}
