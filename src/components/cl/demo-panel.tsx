import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  BookOpen,
  Command,
  Database,
  Eye,
  FingerprintPattern,
  Radio,
  RotateCcw,
  ScanLine,
  ShieldAlert,
  TriangleAlert,
  Unplug,
  Usb,
  X,
  Zap,
  Camera,
} from "lucide-react";
import { toast } from "sonner";
import {
  armDrop,
  emitBundle,
  fireCanary,
  imageMatch,
  killAgent,
  reset,
  revoke,
  setLedgerOffline,
  tamper,
  toggleDemo,
  useApp,
} from "@/lib/app";
import { cn } from "@/lib/utils";

export function DemoPanel() {
  const open = useApp((s) => s.demoOpen);
  const orgs = useApp((s) => s.orgs);
  const officers = useApp((s) => s.officers);
  const tampered = useApp((s) => s.tamper);
  const [busy, setBusy] = useState<string | null>(null);
  const nav = useNavigate();
  const ledgerDown = orgs.filter((o) => o.online).length < 2;
  const off4 = officers.find((o) => o.id === "OFF-004");

  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (
        e.key.toLowerCase() === "d" &&
        !e.metaKey &&
        !e.ctrlKey &&
        !["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) &&
        !t.isContentEditable
      )
        toggleDemo();
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, []);

  const act = async (label: string, fn: () => unknown | Promise<unknown>, msg?: string) => {
    setBusy(label);
    try {
      await fn();
      toast.success(msg ?? label);
    } catch (e) {
      toast.error(String((e as Error).message ?? e));
    } finally {
      setBusy(null);
    }
  };

  const actions: [typeof Zap, string, () => unknown, string?][] = [
    [RotateCcw, "Reset mock data", () => reset(), "Scenario reset · fresh key ceremony"],
    [
      Database,
      ledgerDown ? "Bring ledger online" : "Ledger offline (2 offices)",
      () => setLedgerOffline(!ledgerDown),
      ledgerDown ? "Ledger quorum restored 3/3" : "Security + Audit offices unreachable — 1/3",
    ],
    [
      FingerprintPattern,
      "Canary fires · OFF-004",
      () => fireCanary("OFF-004", "DOC-007"),
      "CRITICAL canary alert raised in SOC",
    ],
    [
      Eye,
      "pHash image match",
      () => imageMatch("DOC-007", 3),
      "pHash monitor matched DOC-007 page 3",
    ],
    [
      Radio,
      off4?.agent === "KILLED" ? "Restore agent WS-NAVAL-14" : "Kill heartbeat WS-NAVAL-14",
      () => killAgent("OFF-004", off4?.agent === "KILLED"),
      off4?.agent === "KILLED" ? "Agent restored" : "Agent killed — alert in ~20 s",
    ],
    [
      Zap,
      "Mesh beacon WS-NAVAL-14",
      () => emitBundle("WS-NAVAL-14", "HEARTBEAT"),
      "Signed bundle relayed to SOC",
    ],
    [
      Unplug,
      "Relay drops next bundle",
      () => armDrop(),
      "Next bundle will be dropped — SOC will see the sequence gap",
    ],
    [
      Usb,
      "USB insert WS-NAVAL-14",
      () => emitBundle("WS-NAVAL-14", "USB_INSERT", "DOC-007"),
      "USB_INSERT bundle sent",
    ],
    [
      Camera,
      "Screenshot attempt",
      () => emitBundle("WS-NAVAL-14", "SCREENSHOT_ATTEMPT", "DOC-007"),
      "SCREENSHOT_ATTEMPT bundle sent",
    ],
    [
      ScanLine,
      "MFP scan match",
      () => emitBundle("WS-NAVAL-14", "SCAN", "DOC-007"),
      "MFP scan hook matched a protected page",
    ],
    [
      TriangleAlert,
      tampered ? "Ledger tampered — open explorer" : "Tamper ledger #7",
      () => (tampered ? nav({ to: "/ledger" }) : tamper("EDIT", 7)),
      tampered ? "Opened ledger" : "Admin edited record #7 — verification fails",
    ],
    [
      ShieldAlert,
      "Revoke OFF-004",
      () => revoke("OFF-004", "demo control"),
      "OFF-004 revoked · REVOKE block committed",
    ],
  ];

  return (
    <>
      <button
        onClick={() => toggleDemo()}
        className="fixed right-5 bottom-5 z-40 grid size-11 place-items-center rounded-full bg-[#12304d] text-white shadow-lg ring-2 ring-white/20 hover:bg-[#1f4e79]"
        aria-label="Demo controls (D)"
        title="Demo controls (D)"
      >
        <Command className="size-5" />
      </button>
      {open && (
        <div className="fade-in fixed right-5 bottom-20 z-40 w-[330px] rounded-[10px] border border-[#253449] bg-[#0e1621] p-3 text-[#e3e9f0] shadow-2xl">
          <div className="mb-2 flex items-center justify-between px-1">
            <div>
              <div className="text-[13px] font-semibold">Demo control panel</div>
              <div className="mono text-[10px] text-[#8d9bad]">
                press D · every action mutates shared state
              </div>
            </div>
            <button onClick={() => toggleDemo(false)} aria-label="Close">
              <X className="size-4" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {actions.map(([Icon, label, fn, msg]) => (
              <button
                key={label}
                disabled={!!busy}
                onClick={() => void act(label, fn, msg)}
                className={cn(
                  "flex min-h-11 items-center gap-2 rounded-md border border-[#253449] bg-[#152131] px-2.5 py-1.5 text-left text-[11.5px] leading-tight hover:border-[#5b9bd5] disabled:opacity-50",
                  busy === label && "pulse",
                )}
              >
                <Icon className="size-3.5 shrink-0 text-[#e8792b]" />
                {label}
              </button>
            ))}
          </div>
          <button
            onClick={() => nav({ to: "/briefing", hash: "script" })}
            className="mt-2 flex h-9 w-full items-center justify-center gap-2 rounded-md bg-[#e8792b] text-[12.5px] font-semibold text-white"
          >
            <BookOpen className="size-4" /> Open jury demo run-sheet
          </button>
        </div>
      )}
    </>
  );
}
