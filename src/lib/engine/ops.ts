// State-transition helpers shared by the seed builder and the live actions.
// They never mutate the input; each returns the records/objects to add.
import { Rng, fromHex, randomBytes, toHex, utf8 } from "./bytes";
import { documentLines } from "./content";
import { cryptoCore, type Signature } from "./crypto-core";
import {
  checkpointMessage,
  requestDigest,
  rootOf,
  seal,
  GENESIS_PREV,
  type Checkpoint,
  type LedgerBody,
  type LedgerRecord,
  type OffChainEntry,
  type RecordType,
} from "./ledger";
import type { AppState, Classification, DocumentRecord } from "./model";
import { split } from "./shamir";
import { hmacSha3, sha3 } from "./sha3";
import {
  SEGMENTS,
  bitsToHex,
  commitBiases,
  commitCodeword,
  codewordHash,
  generateBiases,
  generateCodeword,
  sessionBits,
} from "./tardos";

export const SCENARIO_DATE = "2026-09-24";
export const iso = (hms: string) => `${SCENARIO_DATE}T${hms}Z`;

export type Draft = Pick<AppState, "ledger" | "offchain" | "checkpoints">;

export function nextBody(d: Draft, b: Omit<LedgerBody, "index" | "prevHash">): LedgerBody {
  return { ...b, index: d.ledger.length + 1, prevHash: d.ledger.at(-1)?.hash ?? GENESIS_PREV };
}

export function append(
  d: Draft,
  b: Omit<LedgerBody, "index" | "prevHash">,
  off?: OffChainEntry,
): LedgerRecord {
  const rec = seal(nextBody(d, b));
  d.ledger = [...d.ledger, rec];
  if (off) d.offchain = { ...d.offchain, [rec.index]: off };
  return rec;
}

export function onlineEndorsers(s: Pick<AppState, "orgs">): string[] {
  return s.orgs.filter((o) => o.online).map((o) => o.id);
}

export function dotIndexFor(recordIndex: number): string {
  return toHex(hmacSha3(utf8("chainlock-print-gateway-key"), utf8(String(recordIndex)))).slice(
    0,
    6,
  );
}

export function canaryToken(recipient: string, nonce: string): string {
  return (
    "t_" + toHex(hmacSha3(utf8("sentinel-canary-server-key"), utf8(recipient + nonce))).slice(0, 8)
  );
}

export function newNonce(seed?: string): string {
  return seed ? sha3("nonce:" + seed).slice(0, 16) : toHex(randomBytes(8));
}

/** Build + sign a DECRYPT or PRINT request exactly as handbook §4.3 step 1. */
export async function signedSession(
  s: AppState,
  d: Draft,
  o: {
    type: "DECRYPT" | "PRINT";
    officer: string;
    docId: string;
    time: string;
    purpose: string;
    nonce: string;
    endorsements: string[];
    meta?: Record<string, string | number>;
  },
): Promise<{ record: LedgerRecord; sig: Signature; request: Record<string, unknown> }> {
  const off = s.officers.find((x) => x.id === o.officer)!;
  const doc = s.documents.find((x) => x.id === o.docId)!;
  const request: Record<string, unknown> = {
    doc_id: o.docId,
    recipient_id: o.officer,
    device_id: off.device,
    session_nonce: o.nonce,
    timestamp: o.time,
    purpose: o.purpose,
    ...(o.type === "PRINT" ? { action: "PRINT", printer: String(o.meta?.["printer"] ?? "") } : {}),
  };
  const sig = await cryptoCore.sign(o.officer, requestDigest(request), "sig", off.keys.sig?.pk);
  const full = [
    ...(doc.tracing.codewords[o.officer] ?? []),
    ...sessionBits(o.nonce, o.docId, o.officer),
  ];
  const index = d.ledger.length + 1;
  const meta = {
    ...(o.meta ?? {}),
    ...(o.type === "PRINT" ? { dotIndex: dotIndexFor(index) } : {}),
    canary: canaryToken(o.officer, o.nonce),
  };
  const record = append(
    d,
    {
      type: o.type,
      time: o.time,
      actor: o.officer,
      docId: o.docId,
      deviceId: off.device,
      sessionNonce: o.nonce,
      codewordHash: codewordHash(full),
      sigHash: sha3(sig.sig),
      algoId: sig.alg,
      endorsements: o.endorsements,
      detail:
        o.type === "DECRYPT"
          ? `Decryption request committed before key release (${o.purpose})`
          : `Print job via SENTINEL print gateway — fresh mark variant + microdots`,
      meta,
    },
    { request, sig, signer: o.officer, pk: off.keys.sig?.pk ?? "" },
  );
  return { record, sig, request };
}

/** Signed checkpoint over the current log, co-signed by the witnesses (§4.3 step 3, §4.6). */
export async function makeCheckpoint(
  s: Pick<AppState, "witnesses" | "logKeys">,
  d: Draft,
  time: string,
): Promise<Checkpoint> {
  const size = d.ledger.length;
  const root = rootOf(d.ledger, size);
  const msg = checkpointMessage(size, root, time);
  const sigs = await cryptoCore.signBatch([
    { id: "LOG", msg, scheme: "slh", ...(s.logKeys.slh?.pk ? { pk: s.logKeys.slh.pk } : {}) },
    ...s.witnesses.map((w) => ({
      id: w.id,
      msg,
      scheme: "slh" as const,
      ...(w.keys.slh?.pk ? { pk: w.keys.slh.pk } : {}),
    })),
  ]);
  const cp: Checkpoint = {
    size,
    root,
    time,
    log: sigs[0]!,
    cosigs: s.witnesses.map((w, i) => ({
      witness: w.id,
      alg: sigs[i + 1]!.alg,
      sig: sigs[i + 1]!.sig,
      bytes: sigs[i + 1]!.bytes,
    })),
  };
  d.checkpoints = [...d.checkpoints, cp];
  return cp;
}

/**
 * Sender side of §4.2: Tardos bias vector, per-recipient codewords,
 * commitments, per-recipient key-set seeds split 2-of-3 across the orgs.
 */
export function buildDocument(o: {
  id: string;
  title: string;
  classification: Classification;
  sender: string;
  createdAt: string;
  recipients: string[];
  layer4: boolean;
  customText?: string;
  deterministic: boolean;
}): DocumentRecord {
  const rng = o.deterministic
    ? new Rng(fromHex(sha3("tracing:" + o.id)))
    : new Rng(randomBytes(16));
  const biases = generateBiases(rng);
  const biasSalt = toHex(rng.bytes(16));
  const codewords: Record<string, number[]> = {};
  const salts: Record<string, string> = {};
  const commitments: Record<string, string> = {};
  const shares: Record<string, Record<string, string>> = {};
  const keysetCommitments: Record<string, string> = {};
  for (const r of o.recipients) {
    codewords[r] = generateCodeword(rng, biases);
    salts[r] = toHex(rng.bytes(16));
    commitments[r] = commitCodeword(o.id, r, codewords[r]!, salts[r]!);
    const seed = rng.bytes(32);
    keysetCommitments[r] = sha3(seed);
    const sh = split(seed, 3, 2, (n) => rng.bytes(n));
    shares[r] = {
      "ORG-SEC": toHex(sh[0]!.y),
      "ORG-AUD": toHex(sh[1]!.y),
      "ORG-CMD": toHex(sh[2]!.y),
    };
  }
  const lines = documentLines(o.id, o.customText);
  // 640 AES-256-GCM ciphertexts: plaintext + 12-byte nonce + 16-byte tag each.
  const packageBytes =
    lines.reduce((n, l) => n + 2 * (new TextEncoder().encode(l).length + 28), 0) + 4096;
  const biasCommitment = commitBiases(o.id, biases, biasSalt);
  return {
    id: o.id,
    title: o.title,
    classification: o.classification,
    pages: 10,
    sender: o.sender,
    createdAt: o.createdAt,
    recipients: o.recipients,
    layer4: o.layer4,
    ...(o.customText ? { customText: o.customText } : {}),
    tracing: { biases, biasSalt, biasCommitment, codewords, salts, commitments },
    shares,
    keysetCommitments,
    packageBytes,
    packageHash: sha3("package:" + o.id + ":" + Object.values(commitments).join("")),
    registerIndex: 0,
  };
}

export async function registerDocument(
  s: AppState,
  d: Draft,
  doc: DocumentRecord,
  time: string,
  endorsements: string[],
): Promise<LedgerRecord> {
  const request = {
    doc_id: doc.id,
    package_hash: doc.packageHash,
    recipients: doc.recipients.join(","),
    bias_commitment: doc.tracing.biasCommitment,
    codeword_commitments: doc.recipients.map((r) => `${r}=${doc.tracing.commitments[r]}`).join(","),
    timestamp: time,
  };
  const sig = await cryptoCore.sign(
    "HQ-SENDER",
    requestDigest(request),
    "sig",
    s.senderKeys.sig?.pk,
  );
  return append(
    d,
    {
      type: "REGISTER",
      time,
      actor: "HQ-SENDER",
      docId: doc.id,
      sigHash: sha3(sig.sig),
      algoId: sig.alg,
      endorsements,
      detail: `${doc.title} registered · ${doc.recipients.length} recipients · codeword commitments published before any decryption`,
      meta: {
        packageHash: doc.packageHash,
        packageBytes: doc.packageBytes,
        segments: SEGMENTS,
        recipients: doc.recipients.join(","),
        biasCommitment: doc.tracing.biasCommitment,
        commitments: doc.recipients.map((r) => `${r}=${doc.tracing.commitments[r]}`).join(","),
        layer4: doc.layer4 ? "ENABLED (prose only)" : "DISABLED",
      },
    },
    { request, sig, signer: "HQ-SENDER", pk: s.senderKeys.sig?.pk ?? "" },
  );
}

export function simpleRecord(
  d: Draft,
  type: RecordType,
  time: string,
  actor: string,
  detail: string,
  endorsements: string[],
  extra: Partial<LedgerBody> = {},
) {
  return append(d, { type, time, actor, detail, endorsements, ...extra });
}

export { bitsToHex };
