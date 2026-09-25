import { useEffect, useState, useSyncExternalStore } from "react";
import { cryptoCore } from "@/lib/engine/crypto-core";
import { nowMs } from "@/lib/app";

/** Re-render every `ms` and return the demo-clock time. */
export function useNow(ms = 1000) {
  const [, setT] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setT((t) => t + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
  return nowMs();
}

export function useCryptoMode() {
  return useSyncExternalStore(
    (l) => cryptoCore.onChange(l),
    () => cryptoCore.mode,
    () => cryptoCore.mode,
  );
}

export function fmtAgo(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
