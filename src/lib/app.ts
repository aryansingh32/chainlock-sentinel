// Application state + actions. Every ledger-writing action appends a real
// SHA3 hash-chained record; signatures come from the Crypto Core (LIVE) or
// the labelled simulator.
import { fromHex, toHex } from "./engine/bytes";
import { cryptoCore } from "./engine/crypto-core";
import {
  checkpointMessage,
  leaves,
  proofFor,
  requestDigest,
  rewriteFrom,
  verifyChain,
  type Checkpoint,
} from "./engine/ledger";
import { leafHash, verifyInclusion } from "./engine/merkle";
import type {
  Alert,
  AppState,
  CaseRecord,
  Classification,
  MeshEvent,
  Role,
  Session,
} from "./engine/model";
import {
  buildDocument,
  canaryToken,
  makeCheckpoint,
  newNonce,
  onlineEndorsers,
  registerDocument,
  signedSession,
  simpleRecord,
  type Draft,
} from "./engine/ops";
import { buildSeed, SCENARIO_START } from "./engine/seed";
import { combine } from "./engine/shamir";
import { sha3 } from "./engine/sha3";
import { fullCodeword } from "./engine/trace";
import { createStore, useStoreSelector } from "./store";

const KEY = "chainlock-sentinel-state-v2";

const empty: AppState = {
  ready: false,
  booting: "Starting…",
  builtWith: "SIMULATED",
  clock: { scenarioStart: SCENARIO_START, realStart: 0 },
  officers: [],
  orgs: [],
  witnesses: [],
  logKeys: {},
  senderKeys: {},
  socKeys: {},
  relays: [],
  documents: [],
  ledger: [],
  offchain: {},
  checkpoints: [],
  alerts: [],
  mesh: [],
  socLog: [],
  cases: {},
  tamper: null,
  radio: { rfEnabled: true, rateCap: 12 },
  demoOpen: false,
};

export const store = createStore<AppState>(empty, { key: KEY, persist: (s) => s.ready });
export const useApp = <R>(sel: (s: AppState) => R) => useStoreSelector(store, sel);

// ---------------- per-tab session (role) ----------------

const SESSION_KEY = "chainlock-session";
const sessionStore = createStore<Session>(
  { role: "OFFICER", officerId: "OFF-004" },
  { key: SESSION_KEY, persist: () => false },
);
export const useSession = () => useStoreSelector(sessionStore, (s) => s);
export function setSession(role: Role, officerId: string) {
  sessionStore.replace({ role, officerId }, false);
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ role, officerId }));
  } catch {
    /* ignore */
  }
}

// ---------------- clock ----------------

export function nowMs(s: AppState = store.get()) {
  return s.clock.scenarioStart + (Date.now() - s.clock.realStart);
}
export function nowIso(s?: AppState) {
  return new Date(nowMs(s)).toISOString().replace(/\.\d+Z$/, "Z");
}
export function hms(isoStr: string) {
  return isoStr.slice(11, 19);
}

// ---------------- boot / reset ----------------

let booted = false;
export async function boot() {
  if (booted) return;
  booted = true;
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (raw) sessionStore.replace(JSON.parse(raw) as Session, false);
  } catch {
    /* ignore */
  }
  store.syncTabs();
  store.set({ booting: "Probing Crypto Core…" });
  await cryptoCore.probe();
  const saved = store.load();
  if (saved?.ready && saved.ledger?.length) {
    store.replace({ ...saved, booting: null, demoOpen: false }, false);
    return;
  }
  await reset();
}

export async function reset() {
  store.set({ ready: false, booting: "Key ceremony…" });
  const s = await buildSeed((msg) => store.set({ booting: msg }));
  store.replace({ ...s, booting: null });
}

export async function reprobe(url?: string) {
  const mode = await cryptoCore.probe(url);
  return mode;
}

// ---------------- helpers ----------------

function draft(): Draft {
  const s = store.get();
  return { ledger: s.ledger, offchain: s.offchain, checkpoints: s.checkpoints };
}
function commit(d: Draft, extra: Partial<AppState> = {}) {
  store.set({ ledger: d.ledger, offchain: d.offchain, checkpoints: d.checkpoints, ...extra });
}
function socLine(source: string, text: string, tone?: "good" | "warn" | "bad") {
  store.set((s) => ({
    socLog: [{ time: nowIso(s), source, text, ...(tone ? { tone } : {}) }, ...s.socLog].slice(
      0,
      80,
    ),
  }));
}
function addAlert(a: Omit<Alert, "id" | "time" | "status">) {
  store.set((s) => {
    const n = 104 + s.alerts.length;
    return { alerts: [{ ...a, id: `ALT-${n}`, time: nowIso(s), status: "OPEN" }, ...s.alerts] };
  });
}
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function latestCheckpoint(s: AppState): Checkpoint | undefined {
  return [...s.checkpoints].sort((a, b) => b.size - a.size)[0];
}

export async function ensureCheckpoint() {
  const s = store.get();
  const cp = latestCheckpoint(s);
  if (cp && cp.size >= s.ledger.length) return cp;
  const d = draft();
  const c = await makeCheckpoint(s, d, nowIso());
  commit(d);
  socLine(
    "LEDGER",
    `Checkpoint ${c.size} signed (SLH-DSA) · ${c.cosigs.length}/3 witness co-signatures`,
    "good",
  );
  return c;
}

// ---------------- officer: open a document (log-before-decrypt) ----------------

export const OPEN_STEPS = [
  {
    title: "Build & sign decryption request",
    sub: "ML-DSA-65 with the officer’s own device key (R4, R5)",
  },
  { title: "Chaincode checks & endorsement", sub: "≥ 2 of 3 offices must endorse" },
  {
    title: "Commit to ledger · Merkle proof",
    sub: "Leaf, inclusion proof, witness-co-signed checkpoint",
  },
  {
    title: "Key release quorum (2-of-3)",
    sub: "Each office verifies the proof before releasing its share",
  },
  {
    title: "Reconstruct key set · decrypt 320 segments",
    sub: "Only one variant per segment can be opened",
  },
  {
    title: "Render in memory · attach canary · emit bundle",
    sub: "Never written to disk unmarked",
  },
] as const;

export type StepState = { status: "pending" | "running" | "done" | "failed"; lines: string[] };
export type OpenedSession = {
  docId: string;
  officer: string;
  device: string;
  nonce: string;
  recordIndex: number;
  codeword: number[];
  canary: string;
  checkpointSize: number;
  sigBytes: number;
  sigAlg: string;
  openedAt: string;
};

export async function openDocument(
  docId: string,
  officerId: string,
  purpose: string,
  emit: (i: number, st: StepState) => void,
  pace = 650,
): Promise<OpenedSession | null> {
  const lines: string[][] = OPEN_STEPS.map(() => []);
  const run = (i: number, l?: string) => {
    if (l) lines[i]!.push(l);
    emit(i, { status: "running", lines: [...lines[i]!] });
  };
  const done = (i: number, l?: string) => {
    if (l) lines[i]!.push(l);
    emit(i, { status: "done", lines: [...lines[i]!] });
  };
  const fail = (i: number, l: string) => {
    lines[i]!.push(l);
    emit(i, { status: "failed", lines: [...lines[i]!] });
    return null;
  };
  let s = store.get();
  const doc = s.documents.find((d) => d.id === docId);
  const off = s.officers.find((o) => o.id === officerId);
  if (!doc || !off) return fail(0, "Unknown document or officer");

  // 1 — request + signature
  run(0);
  const nonce = newNonce();
  const time = nowIso();
  run(0, `session_nonce = 0x${nonce}  (64 random bits → session codeword)`);
  await sleep(pace);
  const req = {
    doc_id: docId,
    recipient_id: officerId,
    device_id: off.device,
    session_nonce: nonce,
    timestamp: time,
    purpose,
  };
  const sig = await cryptoCore.sign(officerId, requestDigest(req), "sig", off.keys.sig?.pk);
  done(
    0,
    `σ = ${sig.alg} · ${sig.bytes.toLocaleString()} bytes · SHA3 ${sha3(sig.sig).slice(0, 16)}…`,
  );
  await sleep(pace);

  // 2 — chaincode checks + endorsement
  run(1);
  run(1, `doc_id ${docId} registered at ledger #${doc.registerIndex}  ✓`);
  await sleep(pace / 2);
  if (!doc.recipients.includes(officerId))
    return fail(1, `${officerId} is NOT on the authorised recipient list — rejected`);
  run(1, `${officerId} on authorised recipient list  ✓`);
  const sigOk = await cryptoCore
    .verify(sig.alg, off.keys.sig?.pk ?? "", requestDigest(req), sig.sig)
    .catch(() => false);
  if (!sigOk) return fail(1, "Signature does not verify against certified pk_sig — rejected");
  run(1, `σ verifies against certified pk_sig  ✓`);
  const used = s.ledger.some((r) => r.sessionNonce === nonce);
  if (used) return fail(1, "session_nonce replay — rejected");
  run(1, "session_nonce unused (replay protection)  ✓");
  await sleep(pace / 2);
  s = store.get();
  const endorsers = onlineEndorsers(s);
  s.orgs.forEach((o) => run(1, `${o.short.padEnd(9)} ${o.online ? "ENDORSED" : "UNREACHABLE"}`));
  await sleep(pace / 2);
  if (endorsers.length < 2)
    return fail(
      1,
      `Only ${endorsers.length}/3 offices endorsed — request NOT committed. No ledger record → no keys → no document.`,
    );
  done(1, `Endorsement policy satisfied: ${endorsers.length}/3`);
  await sleep(pace / 2);

  // 3 — commit + proof + checkpoint
  run(2);
  const d = draft();
  const { record } = await signedSession(s, d, {
    type: "DECRYPT",
    officer: officerId,
    docId,
    time,
    purpose,
    nonce,
    endorsements: endorsers,
  });
  commit(d);
  run(2, `Committed as ledger record #${record.index} · hash ${record.hash.slice(0, 16)}…`);
  await sleep(pace / 2);
  const cp = await makeCheckpoint(store.get(), d, nowIso());
  commit(d);
  const proof = proofFor(d.ledger, record.index - 1, cp.size);
  const incl = verifyInclusion(record.index - 1, cp.size, leafHash(record.hash), proof, cp.root);
  run(
    2,
    `Merkle leaf ${record.index - 1} · inclusion proof ${proof.length} hashes · root ${cp.root.slice(0, 12)}…  ${incl ? "✓" : "✗"}`,
  );
  done(
    2,
    `Checkpoint ${cp.size} signed ${cp.log.alg.split(" ")[0]} · witnesses ${cp.cosigs.length}/3 co-signed`,
  );
  socLine("LEDGER", `Checkpoint ${cp.size} co-signed 3/3 · DECRYPT ${officerId} ${docId}`, "good");
  await sleep(pace);

  // 4 — quorum
  run(3);
  s = store.get();
  const offNow = s.officers.find((o) => o.id === officerId)!;
  const msg = checkpointMessage(cp.size, cp.root, cp.time);
  let cosOk = 0;
  for (const c of cp.cosigs) {
    const w = s.witnesses.find((x) => x.id === c.witness);
    if (await cryptoCore.verify(c.alg, w?.keys.slh?.pk ?? "", msg, c.sig).catch(() => false))
      cosOk++;
  }
  const released: { org: string; x: number; share: string }[] = [];
  for (const [k, o] of s.orgs.entries()) {
    if (!o.online) {
      run(3, `${o.short.padEnd(9)} offline — no share`);
      continue;
    }
    if (offNow.status === "REVOKED") {
      run(3, `${o.short.padEnd(9)} REFUSED — ${officerId} device key revoked`);
      continue;
    }
    const inclOk = verifyInclusion(
      record.index - 1,
      cp.size,
      leafHash(record.hash),
      proofFor(store.get().ledger, record.index - 1, cp.size),
      cp.root,
    );
    if (!inclOk || cosOk < 2) {
      run(3, `${o.short.padEnd(9)} REFUSED — proof or witness quorum invalid`);
      continue;
    }
    if (released.length >= 2) {
      run(3, `${o.short.padEnd(9)} standby (threshold reached)`);
      continue;
    }
    const share = doc.shares[officerId]?.[o.id] ?? "";
    const wrapped = await cryptoCore.wrapShare(o.id, officerId, share, offNow.keys.kem?.pk ?? "");
    const unwrapped = await cryptoCore.unwrapShare(
      officerId,
      o.id,
      wrapped,
      offNow.keys.kem?.pk ?? "",
    );
    released.push({ org: o.id, x: k + 1, share: unwrapped });
    run(
      3,
      `${o.short.padEnd(9)} proof ✓ · cosigs ${cosOk}/3 ✓ · share wrapped ${wrapped.alg === "SIMULATED" ? "(sim KEM)" : `ML-KEM-768 ct ${wrapped.ctBytes} B`}`,
    );
    await sleep(pace / 3);
  }
  await sleep(pace / 2);
  if (released.length < 2) {
    return fail(
      3,
      offNow.status === "REVOKED"
        ? `Key release refused: ${officerId} is revoked. The ledger records the attempt; no key share was issued.`
        : `Only ${released.length}/3 shares released — threshold not met. Document stays locked.`,
    );
  }
  done(3, `${released.length} of 3 shares released → threshold met`);
  await sleep(pace / 2);

  // 5 — reconstruct + decrypt
  run(4);
  const seed = combine(released.map((r) => ({ x: r.x, y: fromHex(r.share) })));
  const recOk = sha3(seed) === doc.keysetCommitments[officerId];
  run(
    4,
    `Shamir combine (${released.map((r) => r.org.slice(4)).join(" + ")}) → KeySet(${officerId}) ${recOk ? "matches commitment ✓" : "MISMATCH ✗"}`,
  );
  if (!recOk) return fail(4, "Key set reconstruction failed");
  await sleep(pace);
  const codeword = fullCodeword(doc, officerId, nonce);
  done(4, `AES-256-GCM: 320 segments opened · the other 320 variants stay permanently opaque`);
  await sleep(pace / 2);

  // 6 — canary + bundle
  run(5);
  const canary = canaryToken(officerId, nonce);
  run(5, `Canary token ${canary} embedded (maps to ledger #${record.index} in Zone 2)`);
  void emitBundle(off.device, "DECRYPT", docId);
  done(5, "SENTINEL DECRYPT bundle emitted → mesh → diode → SOC");
  return {
    docId,
    officer: officerId,
    device: off.device,
    nonce,
    recordIndex: record.index,
    codeword,
    canary,
    checkpointSize: cp.size,
    sigBytes: sig.bytes,
    sigAlg: sig.alg,
    openedAt: time,
  };
}

export async function printDocument(sess: OpenedSession, printer = "PR-OPS-01") {
  const s = store.get();
  const endorsers = onlineEndorsers(s);
  if (endorsers.length < 2)
    throw new Error("Print gateway: ledger quorum unavailable — print refused");
  const d = draft();
  const nonce = newNonce();
  const t = nowIso();
  const { record } = await signedSession(s, d, {
    type: "PRINT",
    officer: sess.officer,
    docId: sess.docId,
    time: t,
    purpose: "hard copy",
    nonce,
    endorsements: endorsers,
    meta: { printer, serial: "00654321", pages: 10 },
  });
  commit(d);
  void emitBundle(sess.device, "PRINT", sess.docId);
  socLine(
    "PRINT",
    `${sess.officer} printed ${sess.docId} on ${printer} · ledger #${record.index}`,
    "warn",
  );
  const doc = store.get().documents.find((x) => x.id === sess.docId)!;
  return {
    record,
    codeword: fullCodeword(doc, sess.officer, nonce),
    dotIndex: String(record.meta?.["dotIndex"]),
    time: t,
  };
}

// ---------------- sender ----------------

export async function distribute(o: {
  title: string;
  classification: Classification;
  recipients: string[];
  layer4: boolean;
  customText?: string;
}) {
  const s = store.get();
  const endorsers = onlineEndorsers(s);
  if (endorsers.length < 2)
    throw new Error("Ledger quorum unavailable — cannot register the document");
  const num = 10 + s.documents.filter((x) => /^DOC-0(1\d|[2-9]\d)$/.test(x.id)).length;
  const id = `DOC-${String(num).padStart(3, "0")}`;
  const t = nowIso();
  const doc = buildDocument({
    id,
    title: o.title,
    classification: o.classification,
    sender: "HQ WESTERN FLEET",
    createdAt: t,
    recipients: o.recipients,
    layer4: o.layer4,
    deterministic: false,
    ...(o.customText ? { customText: o.customText } : {}),
  });
  const d = draft();
  const rec = await registerDocument(s, d, doc, t, endorsers);
  doc.registerIndex = rec.index;
  commit(d, { documents: [...s.documents, doc] });
  await ensureCheckpoint();
  return { doc, record: rec };
}

// ---------------- devices ----------------

export async function revoke(officerId: string, reason: string) {
  const s = store.get();
  const d = draft();
  const off = s.officers.find((o) => o.id === officerId)!;
  simpleRecord(
    d,
    "REVOKE",
    nowIso(),
    "ORG-CMD",
    `${officerId} / ${off.device} revoked — ${reason}. Quorum nodes will refuse all key releases.`,
    onlineEndorsers(s),
    { deviceId: off.device, meta: { officer: officerId } },
  );
  commit(d, {
    officers: s.officers.map((o) => (o.id === officerId ? { ...o, status: "REVOKED" } : o)),
    alerts: s.alerts.map((a) =>
      a.officer === officerId && a.status === "OPEN" ? { ...a, status: "CONTAINED" } : a,
    ),
  });
  socLine("CONTAIN", `${officerId} frozen · REVOKE committed`, "bad");
}

export async function reenrol(officerId: string) {
  const s = store.get();
  const keys = await cryptoCore.rotate(officerId, ["sig", "kem"]);
  const d = draft();
  simpleRecord(
    d,
    "ENROL",
    nowIso(),
    "ORG-SEC",
    `${officerId} re-enrolled in person · new ML-DSA-65 / ML-KEM-768 keys certified`,
    onlineEndorsers(s),
    { meta: { officer: officerId, pkHash: sha3(keys.sig?.pk ?? "") } },
  );
  commit(d, {
    officers: store.get().officers.map((o) =>
      o.id === officerId
        ? {
            ...o,
            status: "ACTIVE",
            keys: { ...o.keys, ...keys },
            agent: "ALIVE",
            lastHeartbeat: nowMs(),
          }
        : o,
    ),
  });
}

export function setOrgOnline(id: string, online: boolean) {
  store.set((s) => ({ orgs: s.orgs.map((o) => (o.id === id ? { ...o, online } : o)) }));
}
export function setLedgerOffline(off: boolean) {
  store.set((s) => ({
    orgs: s.orgs.map((o) => ({ ...o, online: off ? o.id === "ORG-CMD" : true })),
  }));
}

// ---------------- ledger tamper demo ----------------

export function tamper(mode: "EDIT" | "REWRITE", index: number) {
  const s = store.get();
  const backup = s.tamper?.backup ?? s.ledger;
  const target = backup[index - 1];
  if (!target) return;
  const edited = {
    ...target,
    actor: target.actor === "OFF-001" ? "OFF-003" : "OFF-001",
    detail: target.detail + " ",
  };
  let ledger = backup.map((r, i) => (i === index - 1 ? edited : r));
  if (mode === "REWRITE") ledger = rewriteFrom(ledger, index - 1);
  store.set({ ledger, tamper: { mode, index, backup } });
  const rep = verifyChain(ledger, s.checkpoints);
  addAlert({
    severity: "CRITICAL",
    kind: "TAMPER",
    title: mode === "EDIT" ? `Ledger record #${index} altered` : "Split-view: history rewritten",
    detail:
      mode === "EDIT"
        ? `Hash of #${index} no longer recomputes; chain broken from #${rep.firstBad}`
        : `Chain is self-consistent but diverges from witness-co-signed checkpoints from #${rep.firstBad}`,
  });
  socLine(
    "AUDIT",
    mode === "EDIT"
      ? `Integrity failure at #${index}`
      : "Witness checkpoint mismatch — split view detected",
    "bad",
  );
}
export function restore() {
  const s = store.get();
  if (!s.tamper) return;
  store.set({ ledger: s.tamper.backup, tamper: null });
  socLine("AUDIT", "Ledger restored from witnessed replicas · verification green", "good");
}

// ---------------- SENTINEL ----------------

const ROUTES: Record<string, string[]> = {
  "WS-NAVAL-11": ["WS-NAVAL-11", "GW-BRIDGE", "DIODE", "SOC"],
  "WS-NAVAL-12": ["WS-NAVAL-12", "GW-BRIDGE", "DIODE", "SOC"],
  "WS-NAVAL-13": ["WS-NAVAL-13", "RN-CORRIDOR-A", "RN-DECK3", "GW-BRIDGE", "DIODE", "SOC"],
  "WS-NAVAL-14": ["WS-NAVAL-14", "RN-CORRIDOR-A", "RN-DECK2", "GW-BRIDGE", "DIODE", "SOC"],
  "WS-NAVAL-15": ["WS-NAVAL-15", "RN-CORRIDOR-A", "RN-DECK3", "GW-BRIDGE", "DIODE", "SOC"],
};
let dropNext = false;
export function armDrop() {
  dropNext = true;
}

export async function emitBundle(
  device: string,
  event: string,
  docId = "—",
): Promise<MeshEvent | null> {
  const s = store.get();
  const off = s.officers.find((o) => o.device === device);
  const seq = (off?.seq ?? 0x0400) + 1;
  store.set((st) => ({
    officers: st.officers.map((o) => (o.device === device ? { ...o, seq } : o)),
  }));
  const time = nowIso();
  const payload = {
    event,
    doc_id: docId,
    wm_index: sha3(device + time).slice(0, 4),
    device_id: device,
    timestamp: time,
    seq,
  };
  const sealed = await cryptoCore.sealBundle(device, payload);
  // Route: prefer the RF path; skip offline relays (store-carry-forward via handset).
  let route = [...(ROUTES[device] ?? [device, "GW-BRIDGE", "DIODE", "SOC"])];
  const st = store.get();
  if (!st.radio.rfEnabled) route = [device, "GW-BRIDGE", "DIODE", "SOC"];
  const offline = route.filter((r) => st.relays.find((x) => x.id === r)?.status === "OFFLINE");
  if (offline.length)
    route = route.map((r) =>
      offline.includes(r)
        ? r === "RN-DECK2"
          ? "RN-DECK3"
          : r === "RN-DECK3"
            ? "RN-DECK2"
            : "HANDSET-DUTY"
        : r,
    );
  const d = draft();
  simpleRecord(
    d,
    "BEACON",
    time,
    device,
    `SENTINEL bundle ${event} seq 0x${seq.toString(16).padStart(4, "0")} emitted (${sealed.bytes} B) — reconciled at SOC`,
    onlineEndorsers(st).slice(0, 2),
    {
      deviceId: device,
      ...(docId !== "—" ? { docId } : {}),
      meta: { seq: `0x${seq.toString(16)}`, event, route: route.join(">") },
    },
  );
  commit(d);
  if (dropNext) {
    dropNext = false;
    const ev: MeshEvent = {
      id: `B-${seq.toString(16)}`,
      time,
      device,
      event,
      seq,
      route: route.slice(0, 3),
      bytes: sealed.bytes,
      verified: false,
      alg: sealed.alg,
      dropped: true,
    };
    store.set((x) => ({ mesh: [ev, ...x.mesh].slice(0, 60) }));
    return ev;
  }
  const opened = await cryptoCore.openBundle(device, sealed);
  const ev: MeshEvent = {
    id: `B-${seq.toString(16)}`,
    time,
    device,
    event,
    seq,
    route,
    bytes: sealed.bytes,
    verified: opened.valid,
    alg: sealed.alg === "SIMULATED" ? "SIMULATED" : "ML-KEM-768 + ML-DSA-65 + AES-256-GCM",
    bundle: sealed,
  };
  const prev = store.get().mesh.find((m) => m.device === device && !m.dropped);
  store.set((x) => ({ mesh: [ev, ...x.mesh].slice(0, 60) }));
  socLine(
    "MESH",
    `${event} from ${device} seq 0x${seq.toString(16)} · ${opened.valid ? "signature ✓ decrypted" : "INVALID"} · ${route.length - 1} hops`,
    opened.valid ? "good" : "bad",
  );
  if (prev && seq > prev.seq + 1) {
    addAlert({
      severity: "HIGH",
      kind: "SEQ_GAP",
      title: `Sequence gap — ${device}`,
      detail: `Expected seq 0x${(prev.seq + 1).toString(16)}, received 0x${seq.toString(16)} — ${seq - prev.seq - 1} bundle(s) silently dropped by a relay`,
      device,
      ...(off ? { officer: off.id } : {}),
    });
    socLine("MESH", `Sequence gap on ${device} — relay drop detected`, "bad");
  }
  if (event === "USB_INSERT" || event === "SCREENSHOT_ATTEMPT" || event === "SCAN")
    addAlert({
      severity: event === "SCAN" ? "HIGH" : "MEDIUM",
      kind: event === "USB_INSERT" ? "USB" : event === "SCAN" ? "SCAN" : "SCREENSHOT",
      title: `${event.replace("_", " ")} — ${device}`,
      detail: `Tier-A agent event from ${off?.id ?? device}${docId !== "—" ? ` while ${docId} open` : ""}`,
      device,
      ...(off ? { officer: off.id } : {}),
      ...(docId !== "—" ? { docId } : {}),
    });
  return ev;
}

export function killAgent(officerId: string, alive = false) {
  store.set((s) => ({
    officers: s.officers.map((o) =>
      o.id === officerId ? { ...o, agent: alive ? "ALIVE" : "KILLED", lastHeartbeat: nowMs(s) } : o,
    ),
  }));
  socLine(
    "AGENT",
    alive ? `${officerId} agent restored` : `${officerId} agent stopped (demo) — watch for silence`,
    alive ? "good" : undefined,
  );
}

/** Called on an interval by the shell: silence is a signal (§5.6). */
export function heartbeatWatch(silenceMs = 20000) {
  const s = store.get();
  const now = nowMs(s);
  for (const o of s.officers) {
    if (o.agent !== "KILLED" || now - o.lastHeartbeat < silenceMs) continue;
    if (
      s.alerts.some((a) => a.kind === "HEARTBEAT" && a.device === o.device && a.status === "OPEN")
    )
      continue;
    addAlert({
      severity: "MEDIUM",
      kind: "HEARTBEAT",
      title: `Heartbeat missing — ${o.device}`,
      detail: `No HEARTBEAT bundle for ${Math.round((now - o.lastHeartbeat) / 1000)} s from ${o.id} · agent tampered or device moved`,
      device: o.device,
      officer: o.id,
    });
    socLine("HEARTBEAT", `${o.device} silent — alert raised`, "warn");
  }
}

export function fireCanary(officerId = "OFF-004", docId = "DOC-007") {
  const s = store.get();
  const sess = [...s.ledger]
    .reverse()
    .find((r) => r.type === "DECRYPT" && r.actor === officerId && r.docId === docId);
  if (!sess) return;
  const token = canaryToken(officerId, sess.sessionNonce!);
  addAlert({
    severity: "CRITICAL",
    kind: "CANARY",
    title: `Canary token fired — ${docId}`,
    detail: `HTTP callback on token ${token} → session of ${officerId} (ledger #${sess.index})`,
    docId,
    officer: officerId,
    device: sess.deviceId ?? "",
    ledgerIndex: sess.index,
    data: {
      trigger: "Canary token fired [DNS + HTTP callback]",
      sourceIp: "203.x.x.x [Mumbai, Maharashtra, IN]",
      reader: "Adobe Acrobat Reader 24.0 / Windows 11",
      token,
    },
  });
  socLine("CANARY", `Token ${token} fired · correlated to ledger #${sess.index}`, "bad");
}

export function imageMatch(docId = "DOC-007", page = 3) {
  addAlert({
    severity: "HIGH",
    kind: "PHASH",
    title: `Perceptual-hash match — ${docId} page ${page}`,
    detail: `Monitored channel image matches page ${page} · Hamming 5/64 · similarity 92%`,
    docId,
    data: { source: "Paste-site crawler (synthetic)", hamming: "5", page: String(page) },
  });
  socLine("PHASH", `${docId} p${page} matched in monitored source`, "warn");
}

export function setAlertStatus(id: string, status: Alert["status"]) {
  store.set((s) => ({ alerts: s.alerts.map((a) => (a.id === id ? { ...a, status } : a)) }));
}

export async function escalate(alertId: string) {
  const s = store.get();
  const a = s.alerts.find((x) => x.id === alertId);
  setAlertStatus(alertId, "ESCALATED");
  socLine("SOC", `${alertId} escalated to Commanding Officer and Board of Inquiry`, "warn");
  return a;
}

export function setRelayStatus(id: string, status: "NOMINAL" | "OFFLINE") {
  store.set((s) => ({ relays: s.relays.map((r) => (r.id === id ? { ...r, status } : r)) }));
}
export function setRadio(p: Partial<AppState["radio"]>) {
  store.set((s) => ({ radio: { ...s.radio, ...p } }));
}

export function saveCase(c: CaseRecord) {
  store.set((s) => ({ cases: { ...s.cases, [c.id]: c } }));
  const d = draft();
  simpleRecord(
    d,
    "EXPORT",
    nowIso(),
    "ORG-AUD",
    `Evidence bundle ${c.id} exported for ${c.docId} · accused: ${c.accused.join(", ") || "none"}`,
    onlineEndorsers(store.get()),
    { docId: c.docId, meta: { bundleSha3: sha3(JSON.stringify(c.bundle)).slice(0, 32) } },
  );
  commit(d);
}

export function toggleDemo(v?: boolean) {
  store.set((s) => ({ demoOpen: v ?? !s.demoOpen }));
}

export { leaves, toHex };
