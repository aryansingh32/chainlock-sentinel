// Ledger service (handbook §2.5, §4.6): hash-chained records with an
// RFC 6962 Merkle transparency log over them and SLH-DSA-signed checkpoints
// co-signed by independent witnesses.
import { canonicalJson } from "./bytes";
import { leafHash, merkleRoot, inclusionProof } from "./merkle";
import { sha3 } from "./sha3";
import type { Signature } from "./crypto-core";

export type RecordType =
  | "GENESIS"
  | "ENROL"
  | "REGISTER"
  | "DECRYPT"
  | "PRINT"
  | "SCAN"
  | "REVOKE"
  | "ALERT"
  | "BEACON"
  | "ESCALATE"
  | "EXPORT";

export const ORGS = ["ORG-SEC", "ORG-AUD", "ORG-CMD"] as const;
export type OrgId = (typeof ORGS)[number];

export type LedgerBody = {
  index: number;
  type: RecordType;
  time: string;
  actor: string;
  docId?: string;
  deviceId?: string;
  sessionNonce?: string;
  codewordHash?: string;
  sigHash?: string;
  algoId?: string;
  endorsements: string[];
  detail: string;
  meta?: Record<string, string | number>;
  prevHash: string;
};
export type LedgerRecord = LedgerBody & { hash: string };

/** Off-chain encrypted store: full signatures and request objects (§4.6). */
export type OffChainEntry = {
  request?: Record<string, unknown>;
  sig?: Signature;
  signer?: string;
  pk?: string;
};

export type Cosignature = { witness: string; alg: string; sig: string; bytes: number };
export type Checkpoint = {
  size: number;
  root: string;
  time: string;
  log: Signature;
  cosigs: Cosignature[];
};

export const GENESIS_PREV = "0".repeat(64);

export function hashBody(body: LedgerBody): string {
  return sha3(canonicalJson(body));
}

export function seal(body: LedgerBody): LedgerRecord {
  return { ...body, hash: hashBody(body) };
}

export function bodyOf(r: LedgerRecord): LedgerBody {
  const { hash: _h, ...body } = r;
  return body;
}

export function leaves(records: LedgerRecord[]): string[] {
  return records.map((r) => leafHash(r.hash));
}

export function rootOf(records: LedgerRecord[], size = records.length): string {
  return merkleRoot(leaves(records.slice(0, size)));
}

export function proofFor(records: LedgerRecord[], index0: number, size = records.length): string[] {
  return inclusionProof(index0, leaves(records.slice(0, size)));
}

/** The exact bytes a checkpoint signer and every witness sign (C2SP tlog-checkpoint style). */
export function checkpointMessage(size: number, root: string, time: string): string {
  return sha3(`chainlock.navy/log/v1\n${size}\n${root}\n${time}\n`);
}

/** The bytes an officer signs: SHA3-256 of the canonical request (§4.3 step 1). */
export function requestDigest(req: Record<string, unknown>): string {
  return sha3(canonicalJson(req));
}

export type RecordCheck = {
  index: number;
  hashOk: boolean;
  linkOk: boolean;
  /** true = covered by a checkpoint whose root still matches, false = diverges from witnessed history, null = not yet checkpointed */
  witnessed: boolean | null;
};
export type ChainReport = {
  records: RecordCheck[];
  checkpoints: { size: number; rootOk: boolean }[];
  ok: boolean;
  firstBad: number | null;
  splitView: boolean;
};

/**
 * Re-derive every hash from scratch. A naive edit breaks hashOk/linkOk; a
 * full history rewrite keeps the chain self-consistent but no longer matches
 * the roots the witnesses co-signed (split-view detection).
 */
export function verifyChain(records: LedgerRecord[], checkpoints: Checkpoint[]): ChainReport {
  const checks: RecordCheck[] = [];
  let prev = GENESIS_PREV;
  for (const r of records) {
    const recomputed = hashBody(bodyOf(r));
    checks.push({
      index: r.index,
      hashOk: recomputed === r.hash,
      linkOk: r.prevHash === prev,
      witnessed: null,
    });
    prev = recomputed;
  }
  const cps = checkpoints.map((c) => ({
    size: c.size,
    rootOk: c.size <= records.length && rootOf(records, c.size) === c.root,
  }));
  // Earliest record that falls inside a failing checkpoint but not inside the previous good one.
  let lastGood = 0;
  let badFrom: number | null = null;
  for (const c of [...cps].sort((a, b) => a.size - b.size)) {
    if (c.rootOk) lastGood = Math.max(lastGood, c.size);
    else if (badFrom === null) badFrom = lastGood;
  }
  const maxCovered = Math.max(0, ...cps.map((c) => c.size));
  checks.forEach((c, i) => {
    if (i >= maxCovered) c.witnessed = null;
    else c.witnessed = badFrom === null || i < badFrom;
  });
  const firstBadIdx = checks.findIndex((c) => !c.hashOk || !c.linkOk || c.witnessed === false);
  const chainConsistent = checks.every((c) => c.hashOk && c.linkOk);
  return {
    records: checks,
    checkpoints: cps,
    ok: firstBadIdx === -1,
    firstBad: firstBadIdx === -1 ? null : checks[firstBadIdx]!.index,
    splitView: chainConsistent && cps.some((c) => !c.rootOk),
  };
}

/** Recompute hashes from `fromIndex0` onward — what an attacker who controls storage would do. */
export function rewriteFrom(records: LedgerRecord[], fromIndex0: number): LedgerRecord[] {
  const out = records.slice(0, fromIndex0);
  let prev = fromIndex0 === 0 ? GENESIS_PREV : out[fromIndex0 - 1]!.hash;
  for (const r of records.slice(fromIndex0)) {
    const sealed = seal({ ...bodyOf(r), prevHash: prev });
    out.push(sealed);
    prev = sealed.hash;
  }
  return out;
}
