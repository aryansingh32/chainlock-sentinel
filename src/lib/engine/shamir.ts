// Shamir secret sharing over GF(256) — handbook §4.2 step 7 (2-of-3 key-set split).
import { randomBytes } from "./bytes";

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x ^= (x << 1) ^ (x & 0x80 ? 0x11b : 0); // multiply by generator 3 in GF(2^8)/0x11b
    x &= 0xff;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]!;
})();

function mul(a: number, b: number) {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a]! + LOG[b]!]!;
}
function div(a: number, b: number) {
  if (a === 0) return 0;
  return EXP[(LOG[a]! + 255 - LOG[b]!) % 255]!;
}

export type Share = { x: number; y: Uint8Array };

export function split(
  secret: Uint8Array,
  n = 3,
  k = 2,
  rand: (n: number) => Uint8Array = randomBytes,
): Share[] {
  const coeffs = Array.from({ length: k - 1 }, () => rand(secret.length));
  return Array.from({ length: n }, (_, idx) => {
    const x = idx + 1;
    const y = new Uint8Array(secret.length);
    for (let b = 0; b < secret.length; b++) {
      let acc = secret[b]!;
      let xp = 1;
      for (const c of coeffs) {
        xp = mul(xp, x);
        acc ^= mul(c[b]!, xp);
      }
      y[b] = acc;
    }
    return { x, y };
  });
}

export function combine(shares: Share[]): Uint8Array {
  const len = shares[0]?.y.length ?? 0;
  const out = new Uint8Array(len);
  for (let b = 0; b < len; b++) {
    let acc = 0;
    for (let i = 0; i < shares.length; i++) {
      let num = 1;
      let den = 1;
      for (let j = 0; j < shares.length; j++) {
        if (i === j) continue;
        num = mul(num, shares[j]!.x);
        den = mul(den, shares[i]!.x ^ shares[j]!.x);
      }
      acc ^= mul(shares[i]!.y[b]!, div(num, den));
    }
    out[b] = acc;
  }
  return out;
}
