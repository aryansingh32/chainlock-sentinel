// Seed scenario — handbook §1.2 story, "Operation Order 7", 24 Sep 2026.
import { cryptoCore, type Scheme } from "./crypto-core";
import { ORGS, type OrgId } from "./ledger";
import type { AppState, Officer, Relay } from "./model";
import {
  buildDocument,
  iso,
  makeCheckpoint,
  newNonce,
  registerDocument,
  signedSession,
  simpleRecord,
  canaryToken,
  type Draft,
} from "./ops";
import { sha3 } from "./sha3";

export const SCENARIO_START = Date.UTC(2026, 8, 24, 14, 36, 0);

const OFFICERS: [string, string, string, string][] = [
  ["OFF-001", "Mehta", "Lt Cdr", "WS-NAVAL-11"],
  ["OFF-002", "Iyer", "Lt", "WS-NAVAL-12"],
  ["OFF-003", "Khan", "Lt", "WS-NAVAL-13"],
  ["OFF-004", "Rao", "Lt Cdr", "WS-NAVAL-14"],
  ["OFF-005", "Das", "Sub Lt", "WS-NAVAL-15"],
];
const ORG_NAMES: Record<OrgId, [string, string]> = {
  "ORG-SEC": ["Security Office", "Security"],
  "ORG-AUD": ["Audit Office", "Audit"],
  "ORG-CMD": ["Command Office", "Command"],
};
const WITNESSES: [string, string][] = [
  ["WIT-1", "Naval Audit Cell (witness)"],
  ["WIT-2", "CERT-Navy (witness)"],
  ["WIT-3", "IHQ MoD (Navy) (witness)"],
];

export const RELAYS: Relay[] = [
  {
    id: "WS-NAVAL-14",
    kind: "WORKSTATION",
    label: "Ops room · air-gapped",
    status: "NOMINAL",
    x: 90,
    y: 250,
    transport: "BLE adv (transmit-only)",
  },
  {
    id: "RN-CORRIDOR-A",
    kind: "RELAY",
    label: "Corridor A gateway",
    status: "NOMINAL",
    x: 250,
    y: 170,
    transport: "BLE → LoRa IN865",
  },
  {
    id: "RN-DECK2",
    kind: "RELAY",
    label: "Deck 2 relay",
    status: "NOMINAL",
    x: 420,
    y: 250,
    transport: "LoRa IN865",
  },
  {
    id: "RN-DECK3",
    kind: "RELAY",
    label: "Deck 3 relay",
    status: "NOMINAL",
    x: 560,
    y: 140,
    transport: "LoRa IN865",
  },
  {
    id: "GW-BRIDGE",
    kind: "GATEWAY",
    label: "Wired gateway (bridge)",
    status: "NOMINAL",
    x: 700,
    y: 230,
    transport: "LoRa → wired",
  },
  {
    id: "DIODE",
    kind: "DIODE",
    label: "Data diode (one-way)",
    status: "NOMINAL",
    x: 820,
    y: 230,
    transport: "optical, one-way",
  },
  {
    id: "SOC",
    kind: "SOC",
    label: "SENTINEL SOC · Zone 2",
    status: "NOMINAL",
    x: 940,
    y: 230,
    transport: "receive-only",
  },
];

export async function buildSeed(progress: (msg: string) => void): Promise<AppState> {
  progress("Generating identities (ML-DSA-65 · ML-KEM-768 · SLH-DSA)…");
  const ids: { id: string; schemes: Scheme[] }[] = [
    ...OFFICERS.map(([id]) => ({ id, schemes: ["sig", "kem"] as Scheme[] })),
    ...OFFICERS.map(([, , , ws]) => ({ id: ws, schemes: ["sig"] as Scheme[] })),
    ...ORGS.map((id) => ({ id, schemes: ["sig"] as Scheme[] })),
    { id: "HQ-SENDER", schemes: ["sig"] },
    { id: "LOG", schemes: ["slh"] },
    ...WITNESSES.map(([id]) => ({ id, schemes: ["slh"] as Scheme[] })),
    { id: "SOC", schemes: ["kem"] },
  ];
  const keys = await cryptoCore.identities(ids);

  const officers: Officer[] = OFFICERS.map(([id, name, rank, device]) => ({
    id,
    name,
    rank,
    device,
    status: "ACTIVE",
    keys: keys[id] ?? {},
    deviceKeys: keys[device] ?? {},
    agent: id === "OFF-003" ? "KILLED" : "ALIVE",
    lastHeartbeat: id === "OFF-003" ? Date.UTC(2026, 8, 24, 14, 3, 46) : SCENARIO_START,
    // continue from the last bundle each device emitted in the seeded mesh log
    seq: id === "OFF-004" ? 0x0442 : id === "OFF-002" ? 0x0376 : 0x0300 + Number(id.slice(-1)) * 17,
  }));

  const state: AppState = {
    ready: false,
    booting: null,
    builtWith: cryptoCore.mode,
    clock: { scenarioStart: SCENARIO_START, realStart: Date.now() },
    officers,
    orgs: ORGS.map((id) => ({
      id,
      name: ORG_NAMES[id][0],
      short: ORG_NAMES[id][1],
      online: true,
      keys: keys[id] ?? {},
    })),
    witnesses: WITNESSES.map(([id, name]) => ({ id, name, keys: keys[id] ?? {} })),
    logKeys: keys["LOG"] ?? {},
    senderKeys: keys["HQ-SENDER"] ?? {},
    socKeys: keys["SOC"] ?? {},
    relays: RELAYS.map((r) => ({ ...r })),
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

  const all = ["ORG-SEC", "ORG-AUD", "ORG-CMD"];
  const d: Draft = { ledger: [], offchain: {}, checkpoints: [] };
  progress("Writing genesis and enrolment records…");
  simpleRecord(
    d,
    "GENESIS",
    iso("07:30:00"),
    "ORG-CMD",
    "Facility root of trust generated offline; ORG-SEC, ORG-AUD, ORG-CMD identities certified",
    all,
    {
      meta: { rootAlg: "ML-DSA-65", witnesses: "WIT-1,WIT-2,WIT-3", checkpointQuorum: "2-of-3" },
    },
  );
  simpleRecord(
    d,
    "ENROL",
    iso("07:42:00"),
    "ORG-SEC",
    "OFF-001…OFF-005 enrolled in person — signing (ML-DSA-65) and KEM (ML-KEM-768) public keys certified",
    all,
    {
      meta: {
        keysCommitment: sha3(
          officers.map((o) => `${o.id}:${o.keys.sig?.pk}:${o.keys.kem?.pk}`).join("|"),
        ),
      },
    },
  );

  progress("Sender: building A/B variants, Tardos codewords, commitments…");
  const docs = [
    buildDocument({
      id: "DOC-007",
      title: "Operation Order 7 — Sector Seven",
      classification: "SECRET",
      sender: "HQ WESTERN FLEET",
      createdAt: iso("08:00:00"),
      recipients: OFFICERS.map((o) => o[0]),
      layer4: false,
      deterministic: true,
    }),
    buildDocument({
      id: "DOC-008",
      title: "Fleet Readiness Report Q3",
      classification: "CONFIDENTIAL",
      sender: "FLEET READINESS CELL",
      createdAt: iso("08:06:30"),
      recipients: ["OFF-001", "OFF-002", "OFF-003"],
      layer4: false,
      deterministic: true,
    }),
    buildDocument({
      id: "DOC-009",
      title: "Comms Schedule — Western Fleet",
      classification: "SECRET",
      sender: "COMMS COMMAND",
      createdAt: iso("08:12:10"),
      recipients: ["OFF-002", "OFF-004", "OFF-005"],
      layer4: false,
      deterministic: true,
    }),
  ];
  state.documents = docs;
  for (const doc of docs) {
    const r = await registerDocument(state, d, doc, doc.createdAt, all);
    doc.registerIndex = r.index;
  }
  progress("Committing checkpoint 1 (SLH-DSA + 3 witness co-signatures)…");
  await makeCheckpoint(state, d, iso("08:15:00"));

  progress("Replaying the day: signed decryption and print events…");
  const sess = async (
    type: "DECRYPT" | "PRINT",
    officer: string,
    docId: string,
    hms: string,
    purpose: string,
    endorsements = ["ORG-SEC", "ORG-AUD"],
    meta?: Record<string, string | number>,
  ) =>
    signedSession(state, d, {
      type,
      officer,
      docId,
      time: iso(hms),
      purpose,
      nonce: newNonce(`${type}${officer}${docId}${hms}`),
      endorsements,
      ...(meta ? { meta } : {}),
    });

  await sess("DECRYPT", "OFF-001", "DOC-008", "08:22:17", "readiness review");
  const r7 = await sess("DECRYPT", "OFF-004", "DOC-007", "09:14:02", "operational briefing", all);
  simpleRecord(
    d,
    "BEACON",
    iso("09:14:05"),
    "WS-NAVAL-14",
    "SENTINEL-MESH DECRYPT bundle emitted (seq 0x0441) — also written locally for reconciliation",
    ["ORG-SEC", "ORG-AUD"],
    {
      deviceId: "WS-NAVAL-14",
      docId: "DOC-007",
      meta: {
        seq: "0x0441",
        bytes: 120,
        route: "WS-NAVAL-14>RN-CORRIDOR-A>RN-DECK2>GW-BRIDGE>DIODE>SOC",
      },
    },
  );
  await sess(
    "PRINT",
    "OFF-004",
    "DOC-007",
    "09:41:00",
    "briefing hard copy",
    ["ORG-SEC", "ORG-CMD"],
    { printer: "PR-OPS-01", serial: "00654321", pages: 10 },
  );
  await makeCheckpoint(state, d, iso("09:45:00"));
  await sess("DECRYPT", "OFF-002", "DOC-007", "10:05:00", "operational briefing");
  await sess("DECRYPT", "OFF-003", "DOC-008", "10:42:29", "readiness review");
  await sess("DECRYPT", "OFF-002", "DOC-009", "11:02:40", "comms planning", ["ORG-AUD", "ORG-CMD"]);
  await sess("DECRYPT", "OFF-005", "DOC-007", "11:30:00", "operational briefing", all);
  await sess("DECRYPT", "OFF-005", "DOC-009", "12:10:05", "comms planning");
  await sess("DECRYPT", "OFF-001", "DOC-007", "13:48:30", "operational briefing");
  progress("Committing checkpoint 3…");
  await makeCheckpoint(state, d, iso("14:00:00"));

  state.ledger = d.ledger;
  state.offchain = d.offchain;
  state.checkpoints = d.checkpoints;

  const token = canaryToken("OFF-004", r7.record.sessionNonce!);
  state.alerts = [
    {
      id: "ALT-103",
      severity: "CRITICAL",
      kind: "CANARY",
      title: "Canary token fired — DOC-007",
      detail: `HTTP callback on token ${token} → session of OFF-004 (ledger #${r7.record.index})`,
      time: iso("14:32:07"),
      docId: "DOC-007",
      officer: "OFF-004",
      device: "WS-NAVAL-14",
      ledgerIndex: r7.record.index,
      status: "OPEN",
      data: {
        trigger: "Canary token fired [HTTP callback]",
        sourceIp: "203.x.x.x [Mumbai, Maharashtra, IN]",
        reader: "Adobe Acrobat Reader 24.0 / Windows 11",
        token,
      },
    },
    {
      id: "ALT-102",
      severity: "HIGH",
      kind: "PHASH",
      title: "Perceptual-hash match — DOC-007 page 3",
      detail: "Image in synthetic test channel matches page 3 · Hamming 4/64 · similarity 94%",
      time: iso("14:19:44"),
      docId: "DOC-007",
      status: "OPEN",
      data: { source: "Telegram test channel (synthetic)", hamming: "4", page: "3" },
    },
    {
      id: "ALT-101",
      severity: "MEDIUM",
      kind: "HEARTBEAT",
      title: "Heartbeat missing — WS-NAVAL-13",
      detail:
        "No HEARTBEAT bundle for 30 s from OFF-003 workstation · agent tampered or device moved",
      time: iso("14:04:16"),
      officer: "OFF-003",
      device: "WS-NAVAL-13",
      status: "OPEN",
    },
  ];
  state.mesh = [
    {
      id: "B-0441",
      time: iso("09:14:05"),
      device: "WS-NAVAL-14",
      event: "DECRYPT",
      seq: 0x0441,
      route: ["WS-NAVAL-14", "RN-CORRIDOR-A", "RN-DECK2", "GW-BRIDGE", "DIODE", "SOC"],
      bytes: 120,
      verified: true,
      alg: "ML-KEM-768 + ML-DSA-65",
    },
    {
      id: "B-0442",
      time: iso("09:41:02"),
      device: "WS-NAVAL-14",
      event: "PRINT",
      seq: 0x0442,
      route: ["WS-NAVAL-14", "RN-CORRIDOR-A", "RN-DECK3", "GW-BRIDGE", "DIODE", "SOC"],
      bytes: 120,
      verified: true,
      alg: "ML-KEM-768 + ML-DSA-65",
    },
    {
      id: "B-0376",
      time: iso("10:05:03"),
      device: "WS-NAVAL-12",
      event: "DECRYPT",
      seq: 0x0376,
      route: ["WS-NAVAL-12", "GW-BRIDGE", "DIODE", "SOC"],
      bytes: 120,
      verified: true,
      alg: "wired → diode",
    },
  ];
  state.socLog = [
    {
      time: iso("14:32:07"),
      source: "CANARY",
      text: `Token ${token} callback · correlated to ledger #${r7.record.index}`,
      tone: "bad",
    },
    {
      time: iso("14:19:44"),
      source: "PHASH",
      text: "DOC-007 p3 match in monitored channel · Hamming 4",
      tone: "warn",
    },
    { time: iso("14:04:16"), source: "HEARTBEAT", text: "WS-NAVAL-13 silent > 30 s", tone: "warn" },
    {
      time: iso("14:00:00"),
      source: "LEDGER",
      text: "Checkpoint 15 received via diode · 3/3 witness co-signatures",
      tone: "good",
    },
  ];
  progress("Ready");
  state.ready = true;
  return state;
}
