import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { HardDrive, Inbox, Lock, RefreshCcw, ShieldX, Usb } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { hms, useApp, useSession } from "@/lib/app";
import { verifyChain } from "@/lib/engine/ledger";
import {
  Badge,
  Callout,
  Empty,
  Mono,
  PageHeader,
  Panel,
  classificationTone,
} from "@/components/cl/ui";
import { fmtBytes } from "@/components/cl/hooks";

export function InboxPage() {
  const session = useSession();
  const docs = useApp((s) => s.documents);
  const ledger = useApp((s) => s.ledger);
  const checkpoints = useApp((s) => s.checkpoints);
  const officers = useApp((s) => s.officers);
  const [all, setAll] = useState(false);
  const me = officers.find((o) => o.id === session.officerId);
  const visible = all ? docs : docs.filter((d) => d.recipients.includes(session.officerId));
  const mine = useMemo(
    () =>
      ledger.filter(
        (r) => r.actor === session.officerId && (r.type === "DECRYPT" || r.type === "PRINT"),
      ),
    [ledger, session.officerId],
  );

  return (
    <>
      <PageHeader
        eyebrow="Officer / controlled inbox"
        title="Document Inbox"
        sub={me ? `${me.rank} ${me.name} · ${me.id} · ${me.device}` : undefined}
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => {
                const r = verifyChain(ledger, checkpoints);
                if (r.ok)
                  toast.success(
                    `Ledger verified · ${ledger.length} records · ${checkpoints.length} witnessed checkpoints`,
                  );
                else toast.error(`Ledger verification FAILED at record #${r.firstBad}`);
              }}
            >
              <RefreshCcw /> Sync & verify ledger
            </Button>
            <Button
              onClick={() =>
                toast.success("Package received via USB (sneakernet)", {
                  description:
                    "Every recipient receives the identical 640-ciphertext package — broadcast-encrypt, individually-decrypt.",
                })
              }
            >
              <Usb /> Receive package
            </Button>
          </>
        }
      />
      <div className="mb-4 grid gap-3 md:grid-cols-[1fr_auto]">
        <Callout
          tone="navy"
          icon={<HardDrive className="text-primary" />}
          title="Memory-only sessions"
        >
          Decrypted pages exist only in RAM and are never written to disk unmarked. Opening a
          document first writes a signed request to the ledger — without that record no key share is
          ever released.
        </Callout>
        <label className="panel flex items-center gap-2 px-4 text-[13px]">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Show
          all station documents
        </label>
      </div>
      {me?.status === "REVOKED" && (
        <Callout
          tone="bad"
          icon={<ShieldX className="text-destructive" />}
          title={`${me.id} is revoked`}
          className="mb-4"
        >
          Key-release nodes will refuse every request from this device. You can still try — the
          attempt is itself recorded.
        </Callout>
      )}
      <Panel pad={false} title={`${visible.length} documents`}>
        {visible.length === 0 ? (
          <Empty
            icon={<Inbox />}
            title="No documents addressed to you"
            sub="Switch identity or show all station documents."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="text-left">
                <tr className="border-b">
                  {[
                    "Classification",
                    "Document",
                    "Sender",
                    "Received",
                    "Package",
                    "Your record",
                    "",
                  ].map((h) => (
                    <th key={h} className="eyebrow px-4 py-2.5 font-semibold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((d) => {
                  const opens = mine.filter((r) => r.docId === d.id && r.type === "DECRYPT").length;
                  const prints = mine.filter((r) => r.docId === d.id && r.type === "PRINT").length;
                  const allowed = d.recipients.includes(session.officerId);
                  return (
                    <tr key={d.id} className="border-b last:border-0 hover:bg-muted/50">
                      <td className="px-4 py-3">
                        <Badge tone={classificationTone(d.classification)}>
                          {d.classification}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium">{d.title}</div>
                        <Mono className="text-muted-foreground">
                          {d.id} · {d.pages} pages · 320 segments
                        </Mono>
                      </td>
                      <td className="px-4 py-3">{d.sender}</td>
                      <td className="px-4 py-3">
                        <Mono>{hms(d.createdAt)}Z</Mono>
                      </td>
                      <td className="px-4 py-3">
                        <Mono>{fmtBytes(d.packageBytes)}</Mono>
                      </td>
                      <td className="px-4 py-3">
                        {!allowed ? (
                          <Badge tone="neutral">not a recipient</Badge>
                        ) : opens ? (
                          <Badge tone="good">
                            opened ×{opens}
                            {prints ? ` · printed ×${prints}` : ""}
                          </Badge>
                        ) : (
                          <Badge tone="warn">unopened</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button asChild size="sm" variant={allowed ? "default" : "outline"}>
                          <Link to="/view/$docId" params={{ docId: d.id }}>
                            <Lock /> Open
                          </Link>
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <Panel className="mt-4" title="Your signed activity on the ledger">
        {mine.length === 0 ? (
          <div className="text-[13px] text-muted-foreground">
            No decryption or print events yet.
          </div>
        ) : (
          <div className="grid gap-1.5">
            {[...mine]
              .reverse()
              .slice(0, 8)
              .map((r) => (
                <div key={r.index} className="flex flex-wrap items-center gap-3 text-[13px]">
                  <Mono className="w-16 text-muted-foreground">#{r.index}</Mono>
                  <Badge tone={r.type === "PRINT" ? "warn" : "navy"}>{r.type}</Badge>
                  <span>{r.docId}</span>
                  <Mono className="text-muted-foreground">{hms(r.time)}Z</Mono>
                  <Mono className="text-muted-foreground">{r.algoId}</Mono>
                </div>
              ))}
          </div>
        )}
      </Panel>
    </>
  );
}
