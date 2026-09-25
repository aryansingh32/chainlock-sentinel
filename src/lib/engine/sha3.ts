// SHA3-256 (FIPS 202) — compact Keccak-f[1600] using 32-bit lane halves.
// Verified against Python hashlib.sha3_256 (see backend/selftest.py).
import { concat, fromHex, toHex, utf8 } from "./bytes";

const RC_HI = new Uint32Array(24);
const RC_LO = new Uint32Array(24);
(() => {
  // Generate round constants with the LFSR from the spec.
  let r = 1;
  for (let i = 0; i < 24; i++) {
    let hi = 0;
    let lo = 0;
    for (let j = 0; j < 7; j++) {
      r = ((r << 1) ^ ((r >> 7) * 0x71)) % 256;
      if (r & 2) {
        const bit = (1 << j) - 1;
        if (bit < 32) lo ^= 1 << bit;
        else hi ^= 1 << (bit - 32);
      }
    }
    RC_HI[i] = hi >>> 0;
    RC_LO[i] = lo >>> 0;
  }
})();

const ROT = [
  0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14,
];

function keccakF(s: Uint32Array) {
  const bcH = new Uint32Array(5);
  const bcL = new Uint32Array(5);
  const tH = new Uint32Array(25);
  const tL = new Uint32Array(25);
  for (let round = 0; round < 24; round++) {
    // theta
    for (let x = 0; x < 5; x++) {
      bcL[x] = s[2 * x]! ^ s[2 * (x + 5)]! ^ s[2 * (x + 10)]! ^ s[2 * (x + 15)]! ^ s[2 * (x + 20)]!;
      bcH[x] =
        s[2 * x + 1]! ^
        s[2 * (x + 5) + 1]! ^
        s[2 * (x + 10) + 1]! ^
        s[2 * (x + 15) + 1]! ^
        s[2 * (x + 20) + 1]!;
    }
    for (let x = 0; x < 5; x++) {
      const l1 = bcL[(x + 1) % 5]!;
      const h1 = bcH[(x + 1) % 5]!;
      const dL = bcL[(x + 4) % 5]! ^ ((l1 << 1) | (h1 >>> 31));
      const dH = bcH[(x + 4) % 5]! ^ ((h1 << 1) | (l1 >>> 31));
      for (let y = 0; y < 25; y += 5) {
        s[2 * (x + y)] = s[2 * (x + y)]! ^ dL;
        s[2 * (x + y) + 1] = s[2 * (x + y) + 1]! ^ dH;
      }
    }
    // rho + pi
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        const i = x + 5 * y;
        const r = ROT[i]!;
        const lo = s[2 * i]!;
        const hi = s[2 * i + 1]!;
        let nl: number, nh: number;
        if (r === 0) {
          nl = lo;
          nh = hi;
        } else if (r < 32) {
          nl = (lo << r) | (hi >>> (32 - r));
          nh = (hi << r) | (lo >>> (32 - r));
        } else if (r === 32) {
          nl = hi;
          nh = lo;
        } else {
          const k = r - 32;
          nl = (hi << k) | (lo >>> (32 - k));
          nh = (lo << k) | (hi >>> (32 - k));
        }
        const j = y + 5 * ((2 * x + 3 * y) % 5);
        tL[j] = nl;
        tH[j] = nh;
      }
    }
    // chi
    for (let y = 0; y < 25; y += 5) {
      for (let x = 0; x < 5; x++) {
        s[2 * (x + y)] = tL[x + y]! ^ (~tL[((x + 1) % 5) + y]! & tL[((x + 2) % 5) + y]!);
        s[2 * (x + y) + 1] = tH[x + y]! ^ (~tH[((x + 1) % 5) + y]! & tH[((x + 2) % 5) + y]!);
      }
    }
    // iota
    s[0] = s[0]! ^ RC_LO[round]!;
    s[1] = s[1]! ^ RC_HI[round]!;
  }
}

export function sha3_256(data: Uint8Array): Uint8Array {
  const rate = 136;
  const s = new Uint32Array(50);
  const padded = new Uint8Array(Math.ceil((data.length + 1) / rate) * rate);
  padded.set(data);
  padded[data.length] = 0x06;
  padded[padded.length - 1] = padded[padded.length - 1]! | 0x80;
  for (let off = 0; off < padded.length; off += rate) {
    for (let i = 0; i < rate / 4; i++) {
      const w =
        padded[off + i * 4]! |
        (padded[off + i * 4 + 1]! << 8) |
        (padded[off + i * 4 + 2]! << 16) |
        (padded[off + i * 4 + 3]! << 24);
      s[i] = s[i]! ^ w;
    }
    keccakF(s);
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 8; i++) {
    const w = s[i]!;
    out[i * 4] = w & 0xff;
    out[i * 4 + 1] = (w >>> 8) & 0xff;
    out[i * 4 + 2] = (w >>> 16) & 0xff;
    out[i * 4 + 3] = (w >>> 24) & 0xff;
  }
  return out;
}

/** SHA3-256 of a UTF-8 string or bytes, returned as lowercase hex. */
export function sha3(input: string | Uint8Array): string {
  return toHex(sha3_256(typeof input === "string" ? utf8(input) : input));
}

/** HMAC-SHA3-256 (block size 136). */
export function hmacSha3(key: Uint8Array, msg: Uint8Array): Uint8Array {
  const block = 136;
  let k = key.length > block ? sha3_256(key) : key;
  const padded = new Uint8Array(block);
  padded.set(k);
  const ipad = padded.map((b) => b ^ 0x36);
  const opad = padded.map((b) => b ^ 0x5c);
  k = sha3_256(concat(ipad, msg));
  return sha3_256(concat(opad, k));
}

/** HKDF-SHA3-256 (RFC 5869) — extract + expand. */
export function hkdfSha3(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: string,
  length: number,
): Uint8Array {
  const prk = hmacSha3(salt.length ? salt : new Uint8Array(32), ikm);
  const out = new Uint8Array(length);
  let prev = new Uint8Array(0);
  let o = 0;
  for (let i = 1; o < length; i++) {
    prev = hmacSha3(prk, concat(prev, utf8(info), new Uint8Array([i]))) as Uint8Array<ArrayBuffer>;
    out.set(prev.subarray(0, Math.min(prev.length, length - o)), o);
    o += prev.length;
  }
  return out;
}

export { fromHex };
