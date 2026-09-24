// Byte helpers shared by the engine. Everything here is synchronous and
// dependency-free so it runs identically in the browser and in Node.

export const enc = new TextEncoder();

export function utf8(s: string): Uint8Array {
  return enc.encode(s);
}

export function toHex(b: Uint8Array): string {
  let out = "";
  for (let i = 0; i < b.length; i++) out += (b[i] ?? 0).toString(16).padStart(2, "0");
  return out;
}

export function fromHex(h: string): Uint8Array {
  const clean = h.length % 2 ? "0" + h : h;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function toB64(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Cryptographically random bytes (WebCrypto is available in browsers and Node 19+). */
export function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  globalThis.crypto.getRandomValues(out);
  return out;
}

/**
 * Canonical JSON: object keys sorted, no whitespace. The Python verifier
 * reproduces this with json.dumps(sort_keys=True, separators=(",", ":"),
 * ensure_ascii=False). Only strings, integers, booleans, null, arrays and
 * objects may appear in hashed structures (no floats).
 */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canonicalJson).join(",") + "]";
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalJson(obj[k])).join(",") + "}";
}

/** Deterministic PRNG (xoshiro128**) seeded from bytes — used for reproducible seed data. */
export class Rng {
  private s: Uint32Array;
  constructor(seed: Uint8Array) {
    this.s = new Uint32Array(4);
    for (let i = 0; i < 16; i++)
      this.s[i >> 2] = ((this.s[i >> 2] ?? 0) << 8) | (seed[i % seed.length] ?? 0);
    if (this.s.every((x) => x === 0)) this.s[0] = 1;
  }
  nextU32(): number {
    const s = this.s;
    const s0 = s[0]!,
      s1 = s[1]!,
      s2 = s[2]!,
      s3 = s[3]!;
    const r = Math.imul(rotl(Math.imul(s1, 5), 7), 9) >>> 0;
    const t = (s1 << 9) >>> 0;
    s[2] = s2 ^ s0;
    s[3] = s3 ^ s1;
    s[1] = s1 ^ s[2]!;
    s[0] = s0 ^ s[3]!;
    s[2] = s[2]! ^ t;
    s[3] = rotl(s[3]!, 11);
    return r;
  }
  next(): number {
    return this.nextU32() / 4294967296;
  }
  bytes(n: number): Uint8Array {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = this.nextU32() & 0xff;
    return out;
  }
}

function rotl(x: number, k: number) {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

export function short(h: string, n = 10): string {
  return h.length > n * 2 ? `${h.slice(0, n)}…${h.slice(-4)}` : h;
}
