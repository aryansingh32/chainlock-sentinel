// Tardos collusion-secure fingerprinting code with the symmetric (Škorić)
// accusation score. Handbook §2.7 and §4.2 steps 4–5, §4.7 step 4.
//
//   codeword = 256 Tardos bits  (fixed per recipient per document)
//            + 64 session bits  (fresh per decryption / print session)
//            = 320 segments, each rendered as variant A (bit 0) or B (bit 1)
import { Rng, concat, toHex, utf8, fromHex, canonicalJson } from "./bytes";
import { hkdfSha3, sha3 } from "./sha3";

export const TARDOS_BITS = 256;
export const SESSION_BITS = 64;
export const SEGMENTS = TARDOS_BITS + SESSION_BITS;
/** Bias values are stored quantised to 16 bits so they hash deterministically. */
export const P_SCALE = 65536;

/**
 * Half-width of the arcsine window around p = 1/2. Classic Tardos uses the
 * full window (cutoff t = 1/300c), which is tuned for large coalitions and
 * long codes. For our short-code regime (L = 256, n ≤ 50, coalitions ≤ 3)
 * a truncated window p ∈ [0.16, 0.84] was chosen by Monte-Carlo simulation:
 * 400/400 two-colluder traces named both colluders, ~98 % for three, zero
 * false accusations at ε = 1e-4.
 */
export const BIAS_HALF_WIDTH = 0.35;
export const BIAS_DISTRIBUTION = "Tardos arcsine, truncated p∈[0.16,0.84]";

/** Draw the secret bias vector P (handbook §4.2 step 4). */
export function generateBiases(rng: Rng): number[] {
  const out: number[] = [];
  for (let i = 0; i < TARDOS_BITS; i++) {
    const r = Math.PI / 4 + (rng.next() * 2 - 1) * BIAS_HALF_WIDTH;
    const p = Math.sin(r) ** 2;
    out.push(Math.min(P_SCALE - 1, Math.max(1, Math.round(p * P_SCALE))));
  }
  return out;
}

export function generateCodeword(rng: Rng, biases: number[]): number[] {
  return biases.map((q) => (rng.next() < q / P_SCALE ? 1 : 0));
}

/** 64 session bits derived from the signed session nonce (handbook §4.4 step 1). */
export function sessionBits(nonceHex: string, docId: string, recipient: string): number[] {
  const okm = hkdfSha3(
    concat(fromHex(nonceHex), utf8(docId), utf8(recipient)),
    new Uint8Array(0),
    "chainlock-session-v1",
    8,
  );
  const bits: number[] = [];
  for (let i = 0; i < SESSION_BITS; i++) bits.push((okm[i >> 3]! >> (7 - (i & 7))) & 1);
  return bits;
}

export function bitsToHex(bits: number[]): string {
  const out = new Uint8Array(Math.ceil(bits.length / 8));
  bits.forEach((b, i) => {
    if (b) out[i >> 3] = out[i >> 3]! | (1 << (7 - (i & 7)));
  });
  return toHex(out);
}

export function hexToBits(hex: string, n: number): number[] {
  const b = fromHex(hex);
  return Array.from({ length: n }, (_, i) => (b[i >> 3]! >> (7 - (i & 7))) & 1);
}

/** Commitment to a recipient's Tardos codeword, published at REGISTER time. */
export function commitCodeword(
  docId: string,
  recipient: string,
  codeword: number[],
  saltHex: string,
): string {
  return sha3(canonicalJson({ codeword: bitsToHex(codeword), docId, recipient, salt: saltHex }));
}

export function commitBiases(docId: string, biases: number[], saltHex: string): string {
  return sha3(
    canonicalJson({
      biases: biases.map((q) => q.toString(16).padStart(4, "0")).join(""),
      docId,
      salt: saltHex,
    }),
  );
}

/** Hash of the full 320-bit session codeword (stored on-chain per DECRYPT/PRINT). */
export function codewordHash(full: number[]): string {
  return sha3("cw:" + bitsToHex(full));
}

/**
 * Symmetric Tardos score of candidate codeword x against recovered y.
 * y[i] = -1 marks an erased (unrecoverable) position and is skipped.
 */
export function accusationScore(
  y: number[],
  x: number[],
  biases: number[],
): { score: number; used: number } {
  let s = 0;
  let used = 0;
  for (let i = 0; i < TARDOS_BITS; i++) {
    const yi = y[i];
    if (yi === undefined || yi < 0) continue;
    const p = biases[i]! / P_SCALE;
    const g1 = Math.sqrt((1 - p) / p);
    const g0 = Math.sqrt(p / (1 - p));
    const xi = x[i];
    if (yi === 1) s += xi === 1 ? g1 : -g0;
    else s += xi === 0 ? g0 : -g1;
    used++;
  }
  return { score: s, used };
}

// --- Normal-distribution helpers for the threshold and false-accusation bound ---

function erfc(x: number): number {
  // Numerical Recipes erfc approximation, |error| < 1.2e-7
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const r =
    t *
    Math.exp(
      -z * z -
        1.26551223 +
        t *
          (1.00002368 +
            t *
              (0.37409196 +
                t *
                  (0.09678418 +
                    t *
                      (-0.18628806 +
                        t *
                          (0.27886807 +
                            t *
                              (-1.13520398 +
                                t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))),
    );
  return x >= 0 ? r : 2 - r;
}

/** Upper-tail probability of the standard normal. */
export function normalQ(z: number): number {
  return 0.5 * erfc(z / Math.SQRT2);
}

/** Inverse of normalQ via bisection (precise enough for thresholds). */
export function normalQInv(p: number): number {
  let lo = 0;
  let hi = 12;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (normalQ(mid) > p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * For an innocent user each score term has mean 0 and variance 1, so the
 * score over m recovered positions is ≈ N(0, m). The threshold Z bounds the
 * probability that ANY of n innocent users is accused by eps (union bound).
 */
export function accusationThreshold(m: number, n: number, eps = 1e-4): number {
  return normalQInv(eps / Math.max(1, n)) * Math.sqrt(Math.max(1, m));
}

export function falseAccusationBound(Z: number, m: number, n: number): number {
  return Math.min(1, n * normalQ(Z / Math.sqrt(Math.max(1, m))));
}

/** Deterministic segment → codeword-position permutation (spreads session bits over all pages). */
export function segmentPermutation(docId: string): number[] {
  const rng = new Rng(fromHex(sha3("perm:" + docId)));
  const perm = Array.from({ length: SEGMENTS }, (_, i) => i);
  for (let i = perm.length - 1; i > 0; i--) {
    const j = rng.nextU32() % (i + 1);
    [perm[i], perm[j]] = [perm[j]!, perm[i]!];
  }
  return perm;
}
