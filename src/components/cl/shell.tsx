import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import {
  Archive,
  BookOpen,
  CircleDot,
  Cpu,
  Database,
  Eye,
  FilePlus,
  FileSearch,
  Inbox,
  KeyRound,
  Layers,
  LockKeyhole,
  Menu,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCcw,
  Send,
  Shield,
  ShieldAlert,
  Siren,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";
import {
  boot,
  emitBundle,
  heartbeatWatch,
  hms,
  nowIso,
  reprobe,
  reset,
  useApp,
  useSession,
} from "@/lib/app";
import { cryptoCore } from "@/lib/engine/crypto-core";
import { DemoPanel } from "./demo-panel";
import { useCryptoMode, useNow } from "./hooks";
import { Badge } from "./ui";

type NavItem = { to: string; label: string; icon: typeof Inbox; match?: string };
const NAV: [string, NavItem[]][] = [
  ["OVERVIEW", [{ to: "/briefing", label: "Briefing & Demo Script", icon: BookOpen }]],
  [
    "OFFICER",
    [
      { to: "/inbox", label: "Inbox", icon: Inbox },
      { to: "/view/DOC-007", label: "Document Viewer", icon: Eye, match: "/view" },
    ],
  ],
  [
    "HQ SENDER",
    [
      { to: "/distribute/new", label: "New Distribution", icon: FilePlus },
      { to: "/distributions", label: "Distributions", icon: Send },
    ],
  ],
  [
    "INVESTIGATION",
    [
      { to: "/trace", label: "Trace a Leak", icon: FileSearch },
      { to: "/compare", label: "Compare Copies", icon: Layers },
      { to: "/evidence/CASE-071", label: "Evidence", icon: Archive, match: "/evidence" },
    ],
  ],
  ["LEDGER", [{ to: "/ledger", label: "Ledger Explorer", icon: Database }]],
  [
    "SENTINEL",
    [
      { to: "/soc", label: "SOC Dashboard", icon: ShieldAlert },
      { to: "/mesh", label: "Relay Mesh", icon: Network },
      { to: "/devices", label: "Devices & Keys", icon: KeyRound },
    ],
  ],
];
const DARK = ["/soc", "/mesh", "/devices"];
const ROLE_LABEL = {
  OFFICER: "OFFICER",
  SENDER: "HQ SENDER",
  INVESTIGATOR: "INVESTIGATOR",
  SOC: "SENTINEL SOC",
} as const;

export function Logo({ size = 34 }: { size?: number }) {
  return (
    <div
      className="relative grid shrink-0 place-items-center"
      style={{ width: size, height: size }}
    >
      <Shield style={{ width: size, height: size }} strokeWidth={1.6} />
      <LockKeyhole
        className="absolute"
        style={{ width: size * 0.4, height: size * 0.4 }}
        strokeWidth={2.2}
      />
    </div>
  );
}

export function BootGate({ children }: { children: ReactNode }) {
  const ready = useApp((s) => s.ready);
  const booting = useApp((s) => s.booting);
  useEffect(() => {
    void boot();
  }, []);
  if (ready) return <>{children}</>;
  return (
    <div className="grid min-h-screen place-items-center bg-[#0e1621] p-6 text-[#e3e9f0]">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto mb-5 w-fit text-[#5b9bd5]">
          <Logo size={56} />
        </div>
        <div className="text-lg font-semibold tracking-wide">CHAINLOCK + SENTINEL</div>
        <div className="mono mt-1 text-[#8d9bad]">SIH26237 · offline enclave bootstrap</div>
        <div className="mt-8 h-1 overflow-hidden rounded bg-[#1c2b3e]">
          <div className="pulse h-full w-2/3 bg-[#e8792b]" />
        </div>
        <div className="mono mt-3 text-[#cfd8e3]">{booting ?? "Loading…"}</div>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const loc = useLocation();
  const nav = useNavigate();
  const dark = DARK.some((r) => loc.pathname.startsWith(r));
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const session = useSession();
  const officers = useApp((s) => s.officers);
  const orgs = useApp((s) => s.orgs);
  const alerts = useApp((s) => s.alerts);
  const builtWith = useApp((s) => s.builtWith);
  const mode = useCryptoMode();
  const now = useNow(1000);
  const online = orgs.filter((o) => o.online).length;
  const openAlerts = alerts.filter((a) => a.status === "OPEN").length;
  const me = officers.find((o) => o.id === session.officerId);

  useEffect(() => {
    const id = setInterval(() => heartbeatWatch(), 2000);
    return () => clearInterval(id);
  }, []);

  // SENTINEL agent: a PrintScreen key press on an enrolled workstation is a SCREENSHOT_ATTEMPT event.
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (e.key !== "PrintScreen" || !me) return;
      void emitBundle(
        me.device,
        "SCREENSHOT_ATTEMPT",
        loc.pathname.startsWith("/view/") ? loc.pathname.split("/")[2] : "—",
      );
      toast.warning("Screenshot attempt recorded by SENTINEL agent", {
        description: `${me.device} → mesh → SOC`,
      });
    };
    window.addEventListener("keyup", fn);
    return () => window.removeEventListener("keyup", fn);
  }, [me, loc.pathname]);

  useEffect(() => setMobileOpen(false), [loc.pathname]);

  const sidebar = (
    <aside
      className={cn(
        "flex h-full flex-col bg-sidebar text-[#d6dee8]",
        collapsed ? "w-[68px]" : "w-[236px]",
      )}
    >
      <div className="flex h-14 items-center gap-2.5 border-b border-white/10 px-4">
        <Logo size={30} />
        {!collapsed && (
          <div className="leading-tight">
            <div className="text-[13px] font-bold tracking-wide text-white">CHAINLOCK</div>
            <div className="mono text-[9px] text-white/55">+ SENTINEL · SIH26237</div>
          </div>
        )}
      </div>
      <nav className="flex-1 overflow-y-auto px-2 py-3">
        {NAV.map(([group, items]) => (
          <div key={group} className="mb-3">
            {!collapsed && (
              <div className="mono px-2.5 pb-1 text-[9.5px] font-semibold tracking-[0.12em] text-white/40">
                {group}
              </div>
            )}
            {items.map((it) => {
              const active =
                loc.pathname === it.to ||
                loc.pathname.startsWith((it.match ?? it.to) + "/") ||
                (it.match && loc.pathname.startsWith(it.match));
              const Icon = it.icon;
              return (
                <Link
                  key={it.to}
                  to={it.to}
                  title={it.label}
                  className={cn(
                    "flex h-9 items-center gap-2.5 rounded-md border-l-[3px] border-transparent px-2.5 text-[13px] text-white/75 transition-colors hover:bg-white/8 hover:text-white",
                    active && "border-l-saffron bg-white/10 text-white",
                    collapsed && "justify-center px-0",
                  )}
                >
                  <Icon className="size-4 shrink-0" />
                  {!collapsed && <span className="truncate">{it.label}</span>}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
      <button
        onClick={() => setCollapsed((v) => !v)}
        className="hidden h-10 items-center gap-2 border-t border-white/10 px-4 text-[12px] text-white/60 hover:text-white lg:flex"
        aria-label="Toggle navigation"
      >
        {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
        {!collapsed && "Collapse"}
      </button>
    </aside>
  );

  return (
    <div className={cn("min-h-screen bg-background text-foreground", dark && "sentinel")}>
      <div className="fixed inset-y-0 left-0 z-30 hidden lg:block">{sidebar}</div>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
          <div className="relative h-full w-fit">{sidebar}</div>
        </div>
      )}
      <div
        className={cn("flex min-h-screen flex-col", collapsed ? "lg:pl-[68px]" : "lg:pl-[236px]")}
      >
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b bg-card/95 px-4 backdrop-blur">
          <button
            className="lg:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation"
          >
            <Menu className="size-5" />
          </button>
          <Badge tone="navy">{ROLE_LABEL[session.role]}</Badge>
          <span className="hidden items-center gap-1.5 text-[12px] text-muted-foreground md:flex">
            <CircleDot className="size-3.5 text-success" /> Air-gapped · Offline
          </span>
          <Link
            to="/ledger"
            className={cn(
              "hidden items-center gap-1.5 text-[12px] md:flex",
              online >= 2 ? "text-muted-foreground" : "font-semibold text-destructive",
            )}
          >
            <Database className="size-3.5" /> Ledger {online}/3 offices online
          </Link>
          <CoreStatus />
          <div className="ml-auto flex items-center gap-3">
            <span
              className="mono hidden text-muted-foreground sm:inline"
              title="Scenario clock (UTC)"
            >
              {new Date(now).toISOString().slice(0, 10)} {hms(new Date(now).toISOString())}Z
            </span>
            <Link to="/soc" className="relative" title="Open SENTINEL alerts">
              <Siren
                className={cn("size-5", openAlerts ? "text-destructive" : "text-muted-foreground")}
              />
              {openAlerts > 0 && (
                <span className="absolute -top-1.5 -right-2 grid h-4 min-w-4 place-items-center rounded-full bg-destructive px-1 text-[10px] font-bold text-white">
                  {openAlerts}
                </span>
              )}
            </Link>
            <div className="flex items-center gap-2 border-l pl-3">
              <span className="grid size-8 place-items-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
                {session.role === "OFFICER"
                  ? (me?.name.slice(0, 2).toUpperCase() ?? "??")
                  : session.role.slice(0, 2)}
              </span>
              <div className="hidden leading-tight sm:block">
                <div className="text-[12.5px] font-semibold">
                  {session.role === "OFFICER" && me
                    ? `${me.rank} ${me.name}`
                    : ROLE_LABEL[session.role]}
                </div>
                <button
                  onClick={() => nav({ to: "/" })}
                  className="text-[11px] text-primary hover:underline"
                >
                  Switch role
                </button>
              </div>
            </div>
          </div>
        </header>
        {mode === "LIVE" && builtWith === "SIMULATED" && (
          <div className="flex flex-wrap items-center gap-3 border-b bg-warning/15 px-4 py-2 text-[12.5px]">
            <Cpu className="size-4" /> Crypto Core is live, but this ledger was built with simulated
            signatures.
            <button
              className="font-semibold text-primary underline"
              onClick={() =>
                void reset().then(() =>
                  toast.success("Ledger rebuilt with real ML-DSA-65 / SLH-DSA signatures"),
                )
              }
            >
              Rebuild with real PQC
            </button>
          </div>
        )}
        <main className="w-full max-w-[1600px] flex-1 px-4 py-5 md:px-6">{children}</main>
        <footer className="flex flex-wrap items-center justify-between gap-2 border-t px-6 py-2 text-[11px] text-muted-foreground">
          <span className="mono">
            PQC: ML-KEM-768 · ML-DSA-65 · SLH-DSA | SHA3-256 · AES-256-GCM · Tardos 256+64
          </span>
          <span className="mono">
            Build v0.9 prototype · crypto {mode} · {nowIso().slice(11, 16)}Z
          </span>
        </footer>
      </div>
      <DemoPanel />
      <Toaster richColors position="top-right" theme={dark ? "dark" : "light"} />
    </div>
  );
}

function CoreStatus() {
  const mode = useCryptoMode();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState(cryptoCore.url);
  return (
    <div className="relative">
      <button onClick={() => setOpen((v) => !v)} className="flex items-center gap-1.5">
        <Badge tone={mode === "LIVE" ? "good" : "warn"}>
          <Cpu className="size-3" /> Crypto core {mode === "LIVE" ? "LIVE" : "SIMULATED"}
        </Badge>
      </button>
      {open && (
        <div className="panel fade-in absolute top-9 left-0 z-50 w-[340px] p-4 shadow-lg">
          <div className="flex items-center justify-between">
            <div className="font-semibold">Crypto Core</div>
            <button onClick={() => setOpen(false)} aria-label="Close">
              <X className="size-4" />
            </button>
          </div>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            {mode === "LIVE"
              ? `Real ML-DSA-65, ML-KEM-768, SLH-DSA and AES-256-GCM via the FastAPI service${cryptoCore.impl ? ` (${cryptoCore.impl})` : ""}.`
              : "No backend reachable — signatures are labelled SHA3 placeholders. Hash chain, Merkle proofs, Shamir and Tardos remain real. Start the backend: cd backend && uvicorn app:app"}
          </p>
          <label className="mt-3 block text-[11px] text-muted-foreground">Service URL</label>
          <div className="mt-1 flex gap-2">
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="mono h-8 flex-1 rounded-md border bg-background px-2"
            />
            <button
              className="flex h-8 items-center gap-1 rounded-md bg-primary px-3 text-[12px] font-medium text-primary-foreground"
              onClick={async () => {
                const m = await reprobe(url);
                toast[m === "LIVE" ? "success" : "warning"](
                  m === "LIVE"
                    ? "Crypto Core connected"
                    : "Crypto Core unreachable — simulated mode",
                );
              }}
            >
              <RefreshCcw className="size-3.5" /> Probe
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
