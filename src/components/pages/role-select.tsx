import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Delete, FingerprintPattern, KeyRound, Search, Send, Shield, Siren } from "lucide-react";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { Logo } from "@/components/cl/shell";
import { setSession, useApp, useSession } from "@/lib/app";
import type { Role } from "@/lib/engine/model";
import { cn } from "@/lib/utils";
import { useCryptoMode } from "@/components/cl/hooks";
import { Badge } from "@/components/cl/ui";

const ROLES: { role: Role; title: string; sub: string; icon: typeof Shield; home: string }[] = [
  {
    role: "OFFICER",
    title: "Officer",
    sub: "Open controlled documents · log-before-decrypt",
    icon: Shield,
    home: "/inbox",
  },
  {
    role: "SENDER",
    title: "HQ Sender",
    sub: "Package, fingerprint and distribute orders",
    icon: Send,
    home: "/distribute/new",
  },
  {
    role: "INVESTIGATOR",
    title: "Investigator",
    sub: "Attribute leaked material · build evidence",
    icon: Search,
    home: "/trace",
  },
  {
    role: "SOC",
    title: "SENTINEL SOC",
    sub: "Monitor, correlate and contain leaks",
    icon: Siren,
    home: "/soc",
  },
];

export function RoleSelectPage() {
  const nav = useNavigate();
  const session = useSession();
  const officers = useApp((s) => s.officers);
  const mode = useCryptoMode();
  const [role, setRole] = useState<Role>(session.role);
  const [officer, setOfficer] = useState(session.officerId);
  const [pin, setPin] = useState("");
  const [phase, setPhase] = useState<"pin" | "scan" | "done">("pin");
  const me = officers.find((o) => o.id === officer);

  const press = (d: string) => setPin((p) => (p.length < 6 ? p + d : p));
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      if (e.key === "Backspace") setPin((p) => p.slice(0, -1));
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, []);

  const unlock = () => {
    if (pin.length !== 6) {
      toast.error("Enter the 6-digit device PIN");
      return;
    }
    if (me?.status === "REVOKED" && role === "OFFICER") {
      toast.error(`${me.id} device key is revoked — contact the Security Office for re-enrolment`);
      return;
    }
    setPhase("scan");
    setTimeout(() => {
      setPhase("done");
      setSession(role, officer);
      toast.success("Device-bound key unlocked", {
        description:
          role === "OFFICER"
            ? `${officer} · ${me?.device} · private key stays in the hardware token`
            : `${ROLES.find((r) => r.role === role)?.title} console`,
      });
      setTimeout(() => nav({ to: ROLES.find((r) => r.role === role)!.home }), 350);
    }, 1300);
  };

  return (
    <div className="grid min-h-screen bg-[#0e1621] text-[#e3e9f0] lg:grid-cols-[1.05fr_1fr]">
      <section className="flex flex-col justify-between border-b border-[#253449] p-8 lg:border-r lg:border-b-0 lg:p-12">
        <div>
          <div className="flex items-center gap-3 text-[#5b9bd5]">
            <Logo size={44} />
            <div>
              <div className="text-xl font-bold tracking-wide text-white">CHAINLOCK + SENTINEL</div>
              <div className="mono text-[11px] text-[#8d9bad]">
                SIH26237 · Ministry of Defence · Indian Navy (WESEE)
              </div>
            </div>
          </div>
          <h1 className="mt-10 max-w-xl text-[30px] leading-tight font-semibold text-white">
            The decryption itself is the watermark.
          </h1>
          <p className="mt-3 max-w-xl text-[14px] leading-relaxed text-[#aab7c6]">
            Cryptographic attribution and immutable decryption provenance for multi-recipient
            encrypted documents. Every opening is signed with the officer’s own post-quantum key and
            committed to a three-office ledger <b className="text-white">before</b> a single key
            share is released.
          </p>
          <div className="mt-8 grid max-w-xl grid-cols-2 gap-2 text-[12px]">
            {[
              ["Log before decrypt", "No ledger record → no keys"],
              ["Fingerprint in the keys", "320 A/B segments per copy"],
              ["Collusion-resistant", "Tardos 256 + 64 session bits"],
              ["Evidence, not accusation", "Offline-verifiable bundle"],
            ].map(([a, b]) => (
              <div key={a} className="rounded-lg border border-[#253449] bg-[#152131] px-3 py-2.5">
                <div className="font-semibold text-white">{a}</div>
                <div className="text-[#8d9bad]">{b}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="mono mt-10 flex flex-wrap gap-x-4 gap-y-1 text-[10.5px] text-[#7c8a99]">
          <span>Zone 1 · air-gapped enclave</span>
          <span>ML-KEM-768 · ML-DSA-65 · SLH-DSA</span>
          <span>Crypto core: {mode}</span>
        </div>
      </section>

      <section className="flex items-center justify-center p-6 lg:p-12">
        <div className="w-full max-w-[480px]">
          <div className="eyebrow !text-[#8d9bad]">Step 1 · select console</div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {ROLES.map((r) => (
              <button
                key={r.role}
                onClick={() => setRole(r.role)}
                className={cn(
                  "rounded-[10px] border p-3 text-left transition-colors",
                  role === r.role
                    ? "border-[#e8792b] bg-[#1c2b3e]"
                    : "border-[#253449] bg-[#152131] hover:border-[#5b9bd5]",
                )}
              >
                <r.icon
                  className={cn("size-5", role === r.role ? "text-[#e8792b]" : "text-[#5b9bd5]")}
                />
                <div className="mt-2 text-[13.5px] font-semibold text-white">{r.title}</div>
                <div className="text-[11.5px] leading-snug text-[#8d9bad]">{r.sub}</div>
              </button>
            ))}
          </div>

          <div className="eyebrow mt-6 !text-[#8d9bad]">Step 2 · device identity</div>
          <select
            value={officer}
            onChange={(e) => setOfficer(e.target.value)}
            className="mt-2 h-10 w-full rounded-md border border-[#253449] bg-[#152131] px-3 text-[13px] text-white"
          >
            {officers.map((o) => (
              <option key={o.id} value={o.id}>
                {o.id} · {o.rank} {o.name} · {o.device} {o.status === "REVOKED" ? "(REVOKED)" : ""}
              </option>
            ))}
          </select>

          <div className="eyebrow mt-6 !text-[#8d9bad]">Step 3 · unlock hardware key</div>
          <div className="mt-2 rounded-[10px] border border-[#253449] bg-[#152131] p-4">
            {phase === "pin" ? (
              <>
                <div className="flex justify-center gap-2">
                  {Array.from({ length: 6 }, (_, i) => (
                    <span
                      key={i}
                      className={cn(
                        "size-3.5 rounded-full border border-[#5b9bd5]",
                        i < pin.length && "bg-[#5b9bd5]",
                      )}
                    />
                  ))}
                </div>
                <div className="mx-auto mt-4 grid max-w-[260px] grid-cols-3 gap-2">
                  {["1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "0", "⌫"].map((k) => (
                    <button
                      key={k}
                      onClick={() =>
                        k === "C"
                          ? setPin("")
                          : k === "⌫"
                            ? setPin((p) => p.slice(0, -1))
                            : press(k)
                      }
                      className="h-11 rounded-md border border-[#253449] bg-[#0e1621] text-[16px] font-semibold text-white hover:border-[#5b9bd5]"
                      aria-label={k === "⌫" ? "Delete" : k === "C" ? "Clear" : k}
                    >
                      {k === "⌫" ? <Delete className="mx-auto size-4" /> : k}
                    </button>
                  ))}
                </div>
                <button
                  onClick={unlock}
                  className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-md bg-[#e8792b] text-[14px] font-semibold text-white hover:bg-[#d56a20]"
                >
                  <FingerprintPattern className="size-4.5" /> Unlock with fingerprint
                </button>
                <div className="mono mt-2 text-center text-[10.5px] text-[#7c8a99]">
                  Demo: any 6 digits
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center py-4">
                <div className="relative grid size-28 place-items-center rounded-2xl border border-[#253449] bg-[#0e1621]">
                  <FingerprintPattern
                    className={cn(
                      "size-16",
                      phase === "done" ? "text-[#33b35a]" : "text-[#5b9bd5]",
                    )}
                    strokeWidth={1.2}
                  />
                  {phase === "scan" && <span className="scan-line" />}
                </div>
                <div className="mt-3 text-[13px] font-semibold">
                  {phase === "scan" ? "Matching fingerprint on secure element…" : "Key unlocked"}
                </div>
                <div className="mono mt-1 text-[11px] text-[#8d9bad]">
                  {me?.keys.sig?.alg ?? "ML-DSA-65"}
                </div>
              </div>
            )}
          </div>
          <div className="mt-4 flex gap-2.5 rounded-lg border border-[#253449] bg-[#111c29] p-3 text-[12px] text-[#aab7c6]">
            <KeyRound className="mt-0.5 size-4 shrink-0 text-[#e8792b]" />
            <div>
              <b className="text-white">No shared passwords.</b> Each officer holds a private
              ML-DSA-65 signing key and ML-KEM-768 decryption key generated on their own device.
              They never leave it — so the officer cannot later claim the server forged their
              decryption record.
            </div>
          </div>
          <div className="mt-3 flex justify-end">
            <Badge tone="neutral" className="!border-[#253449] !bg-transparent !text-[#8d9bad]">
              Build v0.9 prototype
            </Badge>
          </div>
        </div>
      </section>
      <Toaster richColors position="top-right" theme="dark" />
    </div>
  );
}
