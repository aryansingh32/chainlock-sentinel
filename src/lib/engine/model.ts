import type { CryptoMode, PublicKeys, SealedBundle } from "./crypto-core";
import type { Checkpoint, LedgerRecord, OffChainEntry, OrgId } from "./ledger";

export type Role = "OFFICER" | "SENDER" | "INVESTIGATOR" | "SOC";
export type Classification = "SECRET" | "CONFIDENTIAL" | "RESTRICTED";

export type Officer = {
  id: string;
  name: string;
  rank: string;
  device: string;
  status: "ACTIVE" | "REVOKED";
  keys: PublicKeys;
  deviceKeys: PublicKeys;
  agent: "ALIVE" | "KILLED";
  lastHeartbeat: number;
  seq: number;
};

export type Org = { id: OrgId; name: string; short: string; online: boolean; keys: PublicKeys };
export type Witness = { id: string; name: string; keys: PublicKeys };
export type Relay = {
  id: string;
  kind: "GATEWAY" | "RELAY" | "HANDSET" | "WORKSTATION" | "DIODE" | "SOC";
  label: string;
  status: "NOMINAL" | "DEGRADED" | "OFFLINE";
  x: number;
  y: number;
  transport: string;
};

/** Sealed tracing key held by ORG-SEC: the secret bias vector and every codeword. */
export type TracingKey = {
  biases: number[];
  biasSalt: string;
  biasCommitment: string;
  codewords: Record<string, number[]>;
  salts: Record<string, string>;
  commitments: Record<string, string>;
};

export type DocumentRecord = {
  id: string;
  title: string;
  classification: Classification;
  pages: number;
  sender: string;
  createdAt: string;
  recipients: string[];
  layer4: boolean;
  customText?: string;
  tracing: TracingKey;
  /** Shamir shares of each recipient's key-set seed, one per org (encrypted at rest in production). */
  shares: Record<string, Record<string, string>>;
  keysetCommitments: Record<string, string>;
  packageBytes: number;
  packageHash: string;
  registerIndex: number;
};

export type AlertKind =
  | "CANARY"
  | "PHASH"
  | "PHRASE"
  | "HEARTBEAT"
  | "SEQ_GAP"
  | "USB"
  | "SCREENSHOT"
  | "BEACON"
  | "PRINT"
  | "SCAN"
  | "TAMPER";
export type Alert = {
  id: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  kind: AlertKind;
  title: string;
  detail: string;
  time: string;
  docId?: string;
  officer?: string;
  device?: string;
  ledgerIndex?: number;
  status: "OPEN" | "ACK" | "CONTAINED" | "ESCALATED";
  data?: Record<string, string>;
};

export type MeshEvent = {
  id: string;
  time: string;
  device: string;
  event: string;
  seq: number;
  route: string[];
  bytes: number;
  verified: boolean;
  alg: string;
  bundle?: SealedBundle;
  dropped?: boolean;
};

export type SocLine = {
  time: string;
  source: string;
  text: string;
  tone?: "good" | "warn" | "bad";
};

export type CaseRecord = {
  id: string;
  createdAt: string;
  docId: string;
  sample: string;
  accused: string[];
  bundle: EvidenceBundle;
};

export type EvidenceBundle = {
  format: "chainlock-evidence/v1";
  caseId: string;
  createdAt: string;
  docId: string;
  artefact: { kind: string; sha3: string; pages: number; width: number; height: number };
  recovered_pattern: { symbols: string; recovered: number; erased: number };
  tardos_parameters: {
    L: number;
    sessionBits: number;
    distribution: string;
    biases: number[];
    biasSalt: string;
    biasCommitment: string;
    epsilon: number;
    n: number;
    m: number;
    threshold: number;
    falseAccusationBound: number;
  };
  scores: {
    id: string;
    codeword: string;
    salt: string;
    commitment: string;
    score: number;
    accused: boolean;
  }[];
  register: { record: LedgerRecord; proof: string[] };
  sessions: {
    officer: string;
    record: LedgerRecord;
    proof: string[];
    sessionAgreement: string;
    request: Record<string, unknown> | null;
    signature: { alg: string; pk: string; sig: string } | null;
  }[];
  microdots: { index: string; record: LedgerRecord | null; proof: string[] } | null;
  mic: { serial: string; time: string } | null;
  checkpoint: Checkpoint & { logPk: string; witnessPks: Record<string, string> };
  readme: string;
};

export type Session = { role: Role; officerId: string };

export type AppState = {
  ready: boolean;
  booting: string | null;
  builtWith: CryptoMode;
  clock: { scenarioStart: number; realStart: number };
  officers: Officer[];
  orgs: Org[];
  witnesses: Witness[];
  logKeys: PublicKeys;
  senderKeys: PublicKeys;
  socKeys: PublicKeys;
  relays: Relay[];
  documents: DocumentRecord[];
  ledger: LedgerRecord[];
  offchain: Record<number, OffChainEntry>;
  checkpoints: Checkpoint[];
  alerts: Alert[];
  mesh: MeshEvent[];
  socLog: SocLine[];
  cases: Record<string, CaseRecord>;
  tamper: null | { mode: "EDIT" | "REWRITE"; index: number; backup: LedgerRecord[] };
  radio: { rfEnabled: boolean; rateCap: number };
  demoOpen: boolean;
};
