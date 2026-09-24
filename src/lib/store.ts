// Minimal external store with persistence and cross-tab sync.
// Cross-tab sync lets the SOC dashboard run on a projector in one window
// while an officer decrypts in another — both see the same ledger live.
import { useSyncExternalStore } from "react";

export function createStore<T extends object>(
  initial: T,
  opts: { key: string; persist: (s: T) => boolean },
) {
  let state = initial;
  const listeners = new Set<() => void>();
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  const emit = () => listeners.forEach((l) => l());

  const write = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    try {
      localStorage.setItem(opts.key, JSON.stringify(state));
    } catch {
      /* quota or private mode — state stays in memory */
    }
  };
  const save = () => {
    if (typeof window === "undefined" || !opts.persist(state)) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(write, 250);
  };

  const store = {
    get: () => state,
    set(patch: Partial<T> | ((s: T) => Partial<T>)) {
      const p = typeof patch === "function" ? patch(state) : patch;
      state = { ...state, ...p };
      emit();
      save();
    },
    replace(next: T, persist = true) {
      state = next;
      emit();
      if (persist) save();
    },
    subscribe(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    load(): T | null {
      try {
        const raw = localStorage.getItem(opts.key);
        return raw ? (JSON.parse(raw) as T) : null;
      } catch {
        return null;
      }
    },
    /** Follow writes made by other tabs. */
    syncTabs() {
      if (typeof window === "undefined") return () => {};
      const fn = (e: StorageEvent) => {
        if (e.key !== opts.key || !e.newValue) return;
        try {
          state = JSON.parse(e.newValue) as T;
          emit();
        } catch {
          /* ignore partial writes */
        }
      };
      // flush a pending debounced save before the page goes away
      const flush = () => saveTimer && write();
      window.addEventListener("storage", fn);
      window.addEventListener("pagehide", flush);
      return () => {
        window.removeEventListener("storage", fn);
        window.removeEventListener("pagehide", flush);
      };
    },
  };
  return store;
}

export function useStoreSelector<T extends object, R>(
  store: { get: () => T; subscribe: (l: () => void) => () => void },
  sel: (s: T) => R,
): R {
  return useSyncExternalStore(
    store.subscribe,
    () => sel(store.get()),
    () => sel(store.get()),
  );
}
