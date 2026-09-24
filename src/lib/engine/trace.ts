// Investigation (handbook §4.7 steps 4–6): Tardos accusation, session and
// ledger cross-reference, evidence bundle, and the verifier that re-checks a
// bundle without trusting anything but the bundle itself.
import { canonicalJson } from "./bytes";
import type { ExtractResult } from "./forensics";
import { checkpointMessage, hashBody, bodyOf, requestDigest, type LedgerRecord } from "./ledger";
import { leafHash, verifyInclusion } from "./merkle";
import type { AppState, DocumentRecord, EvidenceBundle } from "./model";
import { sha3 } from "./sha3";
import {
  BIAS_DISTRIBUTION,
  SESSION_BITS,
  TARDOS_BITS,
  accusationScore,
  accusationThreshold,
  bitsToHex,
  commitBiases,
  commitCodeword,
  codewordHash,
  falseAccusationBound,
  hexToBits,
  sessionBits,
} from "./tardos";

export const EPSILON = 1e-4;

export type SessionRef = { record: LedgerRecord; officer: string; full: number[] };

export function fullCodeword(doc: DocumentRecord, officer: string, nonce: string): number[] {
  return [...(doc.tracing.codewords[officer] ?? []), ...sessionBits(nonce, doc.id, officer)];
}

export function sessionsFor(doc: DocumentRecord, ledger: LedgerRecord[]): SessionRef[] {
  return ledger
    .filter(
      (r) => r.docId === doc.id && (r.type === "DECRYPT" || r.type === "PRINT") && r.sessionNonce,
    )
    .map((r) => ({
      record: r,
      officer: r.actor,
      full: fullCodeword(doc, r.actor, r.sessionNonce!),
    }));
}

export type TraceResult = {
  docId: string;
  n: number;
  m: number;
  threshold: number;
  bound: number;
  scores: { id: string; score: number; accused: boolean }[];
  accused: string[];
  sessions: {
    officer: string;
    recordIndex: number;
    type: string;
    time: string;
    agree: number;
    total: number;
  }[];
  microdotRecord: LedgerRecord | null;
  confidence: "HIGH" | "MODERATE" | "LOW";
  note: string;
};

export function trace(ex: ExtractResult, doc: DocumentRecord, ledger: LedgerRecord[]): TraceResult {
  const y = ex.recovered;
  const m = y.slice(0, TARDOS_BITS).filter((b) => b >= 0).length;
  const n = doc.recipients.length;
  const Z = accusationThreshold(m, n, EPSILON);
  const scores = doc.recipients
    .map((id) => {
      const { score } = accusationScore(y, doc.tracing.codewords[id] ?? [], doc.tracing.biases);
      return { id, score, accused: m > 0 && score > Z };
    })
    .sort((a, b) => b.score - a.score);
  const accused = scores.filter((s) => s.accused).map((s) => s.id);

  // Session identification from the 64 fresh session bits (R2).
  const all = sessionsFor(doc, ledger);
  const focus = accused.length ? accused : scores.slice(0, 1).map((s) => s.id);
  const sessions = focus.flatMap((officer) => {
    const mine = all.filter((s) => s.officer === officer);
    if (!mine.length) return [];
    const ranked = mine
      .map((s) => {
        let agree = 0;
        let total = 0;
        for (let i = TARDOS_BITS; i < TARDOS_BITS + SESSION_BITS; i++) {
          if (y[i]! < 0) continue;
          total++;
          if (y[i] === s.full[i]) agree++;
        }
        return {
          officer,
          recordIndex: s.record.index,
          type: s.record.type,
          time: s.record.time,
          agree,
          total,
        };
      })
      .sort((a, b) => b.agree - b.total - (a.agree - a.total) || a.recordIndex - b.recordIndex);
    return ranked.slice(0, 1);
  });

  const microdotRecord = ex.microdots?.checksumOk
    ? (ledger.find(
        (r) =>
          r.type === "PRINT" &&
          r.meta?.["dotIndex"] === ex.microdots!.index.toString(16).padStart(6, "0"),
      ) ?? null)
    : null;

  const top = scores[0];
  const margin = top ? top.score / Math.max(1, Z) : 0;
  const confidence: TraceResult["confidence"] =
    accused.length && margin > 1.6 ? "HIGH" : accused.length ? "MODERATE" : "LOW";
  let note: string;
  if (accused.length > 1)
    note = `Collusion detected: ${accused.join(" + ")} each score above threshold. Mixing copies did not hide either recipient.`;
  else if (accused.length === 1)
    note = `${accused[0]} scores ${top!.score.toFixed(1)} against threshold ${Z.toFixed(1)} over ${m} recovered Tardos positions.`;
  else if (microdotRecord)
    note = `Only ${m} Tardos positions recovered — below the accusation threshold on its own. Attribution rests on the printed microdot index, which resolves to ledger record #${microdotRecord.index}.`;
  else
    note = `LOW CONFIDENCE — only ${m} of ${TARDOS_BITS} Tardos positions recovered. ${top ? `${top.id} leads but is below the threshold.` : ""} No accusation is made; corroborate with canary or pHash monitor evidence.`;
  return {
    docId: doc.id,
    n,
    m,
    threshold: Z,
    bound: falseAccusationBound(Z, m, n),
    scores,
    accused,
    sessions,
    microdotRecord,
    confidence,
    note,
  };
}

// ---------------- evidence bundle ----------------

function proofAt(state: AppState, index: number, size: number) {
  // Lazy import cycle avoidance: compute from records directly.
  const leaves = state.ledger.slice(0, size).map((r) => leafHash(r.hash));
  return inclusionPath(index - 1, leaves);
}

import { inclusionProof as inclusionPath } from "./merkle";

export function buildBundle(
  state: AppState,
  caseId: string,
  createdAt: string,
  ex: ExtractResult,
  tr: TraceResult,
  artefact: EvidenceBundle["artefact"],
): EvidenceBundle {
  const doc = state.documents.find((d) => d.id === tr.docId)!;
  const cp = [...state.checkpoints].sort((a, b) => b.size - a.size)[0]!;
  const reg = state.ledger[doc.registerIndex - 1]!;
  const sessions = tr.sessions
    .filter((s) => s.recordIndex <= cp.size)
    .map((s) => {
      const rec = state.ledger[s.recordIndex - 1]!;
      const off = state.offchain[rec.index];
      return {
        officer: s.officer,
        record: rec,
        proof: proofAt(state, rec.index, cp.size),
        sessionAgreement: `${s.agree}/${s.total}`,
        request: off?.request ?? null,
        signature: off?.sig && off.pk ? { alg: off.sig.alg, pk: off.pk, sig: off.sig.sig } : null,
      };
    });
  const md = tr.microdotRecord && tr.microdotRecord.index <= cp.size ? tr.microdotRecord : null;
  return {
    format: "chainlock-evidence/v1",
    caseId,
    createdAt,
    docId: doc.id,
    artefact,
    recovered_pattern: {
      symbols: ex.recovered.map((b) => (b < 0 ? "-" : String(b))).join(""),
      recovered: ex.recoveredCount,
      erased: ex.recovered.length - ex.recoveredCount,
    },
    tardos_parameters: {
      L: TARDOS_BITS,
      sessionBits: SESSION_BITS,
      distribution: BIAS_DISTRIBUTION,
      biases: doc.tracing.biases,
      biasSalt: doc.tracing.biasSalt,
      biasCommitment: doc.tracing.biasCommitment,
      epsilon: EPSILON,
      n: tr.n,
      m: tr.m,
      threshold: Number(tr.threshold.toFixed(4)),
      falseAccusationBound: tr.bound,
    },
    scores: doc.recipients.map((id) => {
      const s = tr.scores.find((x) => x.id === id)!;
      return {
        id,
        codeword: bitsToHex(doc.tracing.codewords[id] ?? []),
        salt: doc.tracing.salts[id] ?? "",
        commitment: doc.tracing.commitments[id] ?? "",
        score: Number(s.score.toFixed(4)),
        accused: s.accused,
      };
    }),
    register: { record: reg, proof: proofAt(state, reg.index, cp.size) },
    sessions,
    microdots: ex.microdots?.checksumOk
      ? {
          index: ex.microdots.index.toString(16).padStart(6, "0"),
          record: md,
          proof: md ? proofAt(state, md.index, cp.size) : [],
        }
      : null,
    mic: ex.mic?.parityOk
      ? {
          serial: ex.mic.serial,
          time: `${ex.mic.year}-${String(ex.mic.month).padStart(2, "0")}-${String(ex.mic.day).padStart(2, "0")} ${String(ex.mic.hh).padStart(2, "0")}:${String(ex.mic.mm).padStart(2, "0")}`,
        }
      : null,
    checkpoint: {
      ...cp,
      logPk: state.logKeys.slh?.pk ?? "",
      witnessPks: Object.fromEntries(state.witnesses.map((w) => [w.id, w.keys.slh?.pk ?? ""])),
    },
    readme: [
      "ChainLock evidence bundle — re-verify independently, without the ChainLock server:",
      "  python backend/verifier.py evidence.json",
      "Checks: record hashes, Merkle inclusion against the witnessed checkpoint, checkpoint signature and",
      ">= 2 of 3 witness co-signatures (SLH-DSA), codeword and bias commitments made at REGISTER time",
      "(before any decryption), session codeword hash, the officer ML-DSA-65 signature over the decryption",
      "request, and a full recomputation of every Tardos accusation score.",
      "Designed to support a certificate under Section 63, Bharatiya Sakshya Adhiniyam 2023 (not legal advice).",
    ].join("\n"),
  };
}

export type VerifyLine = { ok: boolean | null; text: string };
export type SigVerifier = (
  alg: string,
  pk: string,
  msgHex: string,
  sig: string,
) => Promise<boolean | null>;

/** Offline verifier — mirrors backend/verifier.py step for step. */
export async function* verifyBundle(
  b: EvidenceBundle,
  verifySig: SigVerifier,
): AsyncGenerator<VerifyLine> {
  yield { ok: b.format === "chainlock-evidence/v1", text: `Bundle ${b.caseId} format ${b.format}` };
  const cp = b.checkpoint;
  const recs: { label: string; rec: LedgerRecord; proof: string[] }[] = [
    {
      label: `REGISTER #${b.register.record.index}`,
      rec: b.register.record,
      proof: b.register.proof,
    },
    ...b.sessions.map((s) => ({
      label: `${s.record.type} #${s.record.index} (${s.officer})`,
      rec: s.record,
      proof: s.proof,
    })),
    ...(b.microdots?.record
      ? [
          {
            label: `PRINT #${b.microdots.record.index} (microdots)`,
            rec: b.microdots.record,
            proof: b.microdots.proof,
          },
        ]
      : []),
  ];
  for (const { label, rec, proof } of recs) {
    const hashOk = hashBody(bodyOf(rec)) === rec.hash;
    yield { ok: hashOk, text: `${label}: record hash recomputes (SHA3-256)` };
    yield {
      ok: verifyInclusion(rec.index - 1, cp.size, leafHash(rec.hash), proof, cp.root),
      text: `${label}: Merkle inclusion proof → checkpoint root ${cp.root.slice(0, 12)}… (size ${cp.size})`,
    };
  }
  const msg = checkpointMessage(cp.size, cp.root, cp.time);
  const logOk = await verifySig(cp.log.alg, cp.logPk, msg, cp.log.sig);
  yield {
    ok: logOk,
    text: `Checkpoint signature ${cp.log.alg}${logOk === null ? " — cannot verify offline in browser (run verifier.py)" : ""}`,
  };
  let cos = 0;
  for (const c of cp.cosigs) {
    const v = await verifySig(c.alg, cp.witnessPks[c.witness] ?? "", msg, c.sig);
    if (v) cos++;
    yield { ok: v, text: `Witness ${c.witness} co-signature (${c.alg})` };
  }
  yield {
    ok: cos >= 2,
    text: `Witness quorum: ${cos} of ${cp.cosigs.length} valid (≥ 2 required — split-view defence)`,
  };

  const t = b.tardos_parameters;
  const reg = b.register.record;
  const commitMap = Object.fromEntries(
    String(reg.meta?.["commitments"] ?? "")
      .split(",")
      .map((kv) => kv.split("=") as [string, string]),
  );
  yield {
    ok: commitBiases(b.docId, t.biases, t.biasSalt) === reg.meta?.["biasCommitment"],
    text: "Tardos bias vector matches commitment published at REGISTER",
  };
  for (const s of b.scores) {
    const bits = hexToBits(s.codeword, TARDOS_BITS);
    yield {
      ok: commitCodeword(b.docId, s.id, bits, s.salt) === commitMap[s.id],
      text: `${s.id} codeword matches REGISTER commitment (cannot be fabricated after the leak)`,
    };
  }
  for (const s of b.sessions) {
    const cw = hexToBits(b.scores.find((x) => x.id === s.officer)?.codeword ?? "", TARDOS_BITS);
    const full = [...cw, ...sessionBits(s.record.sessionNonce ?? "", b.docId, s.officer)];
    yield {
      ok: codewordHash(full) === s.record.codewordHash,
      text: `${s.officer} session codeword hash matches ledger record #${s.record.index}`,
    };
    if (s.request && s.signature) {
      const req = s.request;
      const fieldsOk =
        req["session_nonce"] === s.record.sessionNonce &&
        req["doc_id"] === b.docId &&
        req["recipient_id"] === s.officer;
      const sigHashOk = sha3(s.signature.sig) === s.record.sigHash;
      const v = await verifySig(
        s.signature.alg,
        s.signature.pk,
        requestDigest(req),
        s.signature.sig,
      );
      yield {
        ok: fieldsOk && sigHashOk,
        text: `${s.officer} request fields and signature hash bound to on-chain record`,
      };
      yield {
        ok: v,
        text: `${s.officer} ${s.signature.alg} signature over request — non-repudiation (R5)`,
      };
    }
  }
  const y = b.recovered_pattern.symbols.split("").map((c) => (c === "-" ? -1 : Number(c)));
  const m = y.slice(0, TARDOS_BITS).filter((v) => v >= 0).length;
  const Z = accusationThreshold(m, t.n, t.epsilon);
  for (const s of b.scores) {
    const { score } = accusationScore(y, hexToBits(s.codeword, TARDOS_BITS), t.biases);
    const accused = m > 0 && score > Z;
    yield {
      ok: Math.abs(score - s.score) < 1e-3 && accused === s.accused,
      text: `${s.id} Tardos score recomputed ${score.toFixed(2)} ${accused ? "> " : "≤ "}${Z.toFixed(2)} → ${accused ? "ACCUSED" : "not accused"}`,
    };
  }
  yield {
    ok: true,
    text: `False-accusation bound ≤ ${falseAccusationBound(Z, m, t.n).toExponential(2)} (Gaussian approximation, n=${t.n}, m=${m})`,
  };
  if (b.microdots)
    yield {
      ok: !!b.microdots.record,
      text: `Microdot ledger index 0x${b.microdots.index} → ${b.microdots.record ? `PRINT record #${b.microdots.record.index} by ${b.microdots.record.actor}` : "no matching record"}`,
    };
  if (b.mic)
    yield {
      ok: true,
      text: `Manufacturer MIC decoded: printer serial ${b.mic.serial}, printed ${b.mic.time}`,
    };
}

export function bundleDigest(b: EvidenceBundle) {
  return sha3(canonicalJson(b));
}
