// Crypto Core provider (handbook §7.1, M1 interface contract).
//
// LIVE       → the Python FastAPI service in /backend performs real
//              ML-DSA-65 (FIPS 204), ML-KEM-768 (FIPS 203), SLH-DSA (FIPS 205)
//              and AES-256-GCM operations. Private keys stay in its keystore,
//              which stands in for each device's hardware token.
// SIMULATED  → no backend reachable (e.g. hosted preview). Signatures are
//              SHA3 placeholders, clearly labelled, so every flow still runs.
//              Hash chains, Merkle proofs, Shamir and Tardos stay real.
import { concat, fromB64, fromHex, toB64, toHex, utf8 } from "./bytes";
import { hkdfSha3, sha3, sha3_256 } from "./sha3";

export type CryptoMode = "LIVE" | "SIMULATED";
export type Scheme = "sig" | "slh" | "kem";

export const ALG = {
  sig: "ML-DSA-65 / FIPS-204",
  slh: "SLH-DSA-SHA2-128f / FIPS-205",
  kem: "ML-KEM-768 / FIPS-203",
  sim: "SIMULATED (start backend for ML-DSA-65)",
  simSlh: "SIMULATED (start backend for SLH-DSA)",
} as const;

export type PublicKeys = Partial<Record<Scheme, { alg: string; pk: string; bytes: number }>>;
export type Signature = { alg: string; sig: string; bytes: number };
export type WrappedShare = {
  ct: string;
  nonce: string;
  wrapped: string;
  ctBytes: number;
  alg: string;
};
export type SealedBundle = {
  ct: string;
  nonce: string;
  body: string;
  sig: string;
  bytes: number;
  alg: string;
};

const DEFAULT_URL =
  (import.meta.env?.["VITE_CRYPTO_CORE_URL"] as string | undefined) ?? "http://127.0.0.1:8000";

class Core {
  mode: CryptoMode = "SIMULATED";
  url = DEFAULT_URL;
  impl = "";
  private listeners = new Set<() => void>();

  onChange(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  async probe(url = this.url): Promise<CryptoMode> {
    this.url = url;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 1200);
      const r = await fetch(`${url}/api/health`, { signal: ctrl.signal });
      clearTimeout(t);
      const j = (await r.json()) as { ok?: boolean; impl?: string };
      this.mode = j.ok ? "LIVE" : "SIMULATED";
      this.impl = j.impl ?? "";
    } catch {
      this.mode = "SIMULATED";
      this.impl = "";
    }
    this.listeners.forEach((f) => f());
    return this.mode;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const r = await fetch(`${this.url}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`${path} → HTTP ${r.status}`);
    return (await r.json()) as T;
  }

  /** Ensure identities exist and return their public keys. */
  async identities(ids: { id: string; schemes: Scheme[] }[]): Promise<Record<string, PublicKeys>> {
    if (this.mode === "LIVE") return this.post("/api/identities", { ids });
    const out: Record<string, PublicKeys> = {};
    for (const { id, schemes } of ids) {
      out[id] = {};
      for (const s of schemes)
        out[id]![s] = {
          alg: s === "slh" ? ALG.simSlh : s === "kem" ? "SIMULATED" : ALG.sim,
          pk: simPk(id, s),
          bytes: 32,
        };
    }
    return out;
  }

  async rotate(id: string, schemes: Scheme[]): Promise<PublicKeys> {
    if (this.mode === "LIVE") return this.post(`/api/identities/${id}/rotate`, { schemes });
    const out: PublicKeys = {};
    const epoch = Date.now().toString(36);
    for (const s of schemes)
      out[s] = {
        alg: s === "slh" ? ALG.simSlh : ALG.sim,
        pk: simPk(id + ":" + epoch, s),
        bytes: 32,
      };
    return out;
  }

  async sign(
    id: string,
    msgHex: string,
    scheme: "sig" | "slh" = "sig",
    pkHint?: string,
  ): Promise<Signature> {
    if (this.mode === "LIVE") return this.post("/api/sign", { id, scheme, msg: msgHex });
    return simSign(pkHint ?? simPk(id, scheme), msgHex, scheme);
  }

  async signBatch(
    items: { id: string; msg: string; scheme: "sig" | "slh"; pk?: string }[],
  ): Promise<Signature[]> {
    if (!items.length) return [];
    if (this.mode === "LIVE")
      return this.post("/api/sign-batch", {
        items: items.map(({ id, msg, scheme }) => ({ id, msg, scheme })),
      });
    return items.map((i) => simSign(i.pk ?? simPk(i.id, i.scheme), i.msg, i.scheme));
  }

  async verify(alg: string, pk: string, msgHex: string, sig: string): Promise<boolean> {
    if (alg.startsWith("SIMULATED"))
      return simSign(pk, msgHex, alg.includes("SLH") ? "slh" : "sig").sig === sig;
    if (this.mode !== "LIVE") throw new Error("Crypto Core offline — cannot verify " + alg);
    const r = await this.post<{ valid: boolean }>("/api/verify", { alg, pk, msg: msgHex, sig });
    return r.valid;
  }

  /** Org node wraps its key-set share to the recipient's ML-KEM public key (§4.3 step 5). */
  async wrapShare(
    org: string,
    recipient: string,
    shareHex: string,
    recipientKemPk: string,
  ): Promise<WrappedShare> {
    if (this.mode === "LIVE")
      return this.post("/api/quorum/wrap", { org, recipient, share: shareHex });
    const pad = hkdfSha3(
      fromHex(sha3(recipientKemPk + org)),
      new Uint8Array(0),
      "chainlock-share-v1",
      shareHex.length / 2,
    );
    const wrapped = fromHex(shareHex).map((b, i) => b ^ pad[i]!);
    return {
      ct: toB64(fromHex(sha3(org + recipient))),
      nonce: sha3(org).slice(0, 24),
      wrapped: toB64(wrapped),
      ctBytes: 32,
      alg: "SIMULATED",
    };
  }

  /** Recipient device unwraps with its ML-KEM private key (§4.3 step 6). */
  async unwrapShare(
    recipient: string,
    org: string,
    w: WrappedShare,
    recipientKemPk: string,
  ): Promise<string> {
    if (this.mode === "LIVE") {
      const r = await this.post<{ share: string }>("/api/agent/unwrap", {
        recipient,
        ct: w.ct,
        nonce: w.nonce,
        wrapped: w.wrapped,
      });
      return r.share;
    }
    const bytes = fromB64(w.wrapped);
    const pad = hkdfSha3(
      fromHex(sha3(recipientKemPk + org)),
      new Uint8Array(0),
      "chainlock-share-v1",
      bytes.length,
    );
    return toHex(bytes.map((b, i) => b ^ pad[i]!));
  }

  /** SENTINEL-MESH event bundle: encrypt to SOC (ML-KEM), sign as workstation (ML-DSA) — §5.6. */
  async sealBundle(
    device: string,
    payload: Record<string, string | number>,
  ): Promise<SealedBundle> {
    if (this.mode === "LIVE") return this.post("/api/bundle/seal", { device, payload });
    const body = toB64(utf8(JSON.stringify(payload)).map((b, i) => b ^ ((i * 31 + 7) % 256)));
    return {
      ct: toB64(fromHex(sha3("ct" + device + body))),
      nonce: sha3(body).slice(0, 24),
      body,
      sig: simSign(simPk(device, "sig"), sha3(body), "sig").sig,
      bytes: 120,
      alg: "SIMULATED",
    };
  }

  async openBundle(
    device: string,
    b: SealedBundle,
  ): Promise<{ valid: boolean; payload: Record<string, string | number> | null }> {
    if (this.mode === "LIVE") return this.post("/api/bundle/open", { device, ...b });
    const raw = fromB64(b.body).map((x, i) => x ^ ((i * 31 + 7) % 256));
    const valid = simSign(simPk(device, "sig"), sha3(b.body), "sig").sig === b.sig;
    return {
      valid,
      payload: valid
        ? (JSON.parse(new TextDecoder().decode(raw)) as Record<string, string | number>)
        : null,
    };
  }
}

function simPk(id: string, scheme: string) {
  return toB64(sha3_256(utf8(`sim-pk:${scheme}:${id}`)));
}

function simSign(pk: string, msgHex: string, scheme: "sig" | "slh"): Signature {
  const sig = toB64(sha3_256(concat(utf8("sim-sig:" + scheme), fromB64(pk), fromHex(msgHex))));
  return { alg: scheme === "slh" ? ALG.simSlh : ALG.sim, sig, bytes: 32 };
}

export const cryptoCore = new Core();
