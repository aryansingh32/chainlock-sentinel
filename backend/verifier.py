#!/usr/bin/env python3
"""ChainLock offline evidence verifier (handbook §4.7 step 6, Pillar 5).

    python verifier.py evidence-CASE-071.json

Trusts nothing but the bundle file. Re-derives every hash, Merkle inclusion
proof, checkpoint and witness signature, codeword commitment, officer
signature and Tardos accusation score. Mirrors src/lib/engine/trace.ts
verifyBundle step for step. Exit code 0 = all checks passed.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import math
import sys
from typing import Any, Iterator

TARDOS_BITS = 256
SESSION_BITS = 64
P_SCALE = 65536


# ---------------- primitives (match src/lib/engine/*.ts) ----------------

def sha3_hex(data: bytes | str) -> str:
    if isinstance(data, str):
        data = data.encode()
    return hashlib.sha3_256(data).hexdigest()


def canonical(v: Any) -> str:
    return json.dumps(v, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def hkdf(ikm: bytes, info: bytes, length: int) -> bytes:
    prk = hmac.new(bytes(32), ikm, hashlib.sha3_256).digest()
    out, prev, i = b"", b"", 1
    while len(out) < length:
        prev = hmac.new(prk, prev + info + bytes([i]), hashlib.sha3_256).digest()
        out += prev
        i += 1
    return out[:length]


def leaf_hash(data_hex: str) -> str:
    return sha3_hex(b"\x00" + bytes.fromhex(data_hex))


def node_hash(l: str, r: str) -> str:
    return sha3_hex(b"\x01" + bytes.fromhex(l) + bytes.fromhex(r))


def verify_inclusion(index: int, size: int, leaf: str, proof: list[str], root: str) -> bool:
    """RFC 9162 §2.1.3.2."""
    if index >= size:
        return False
    fn, sn, r = index, size - 1, leaf
    for p in proof:
        if sn == 0:
            return False
        if fn % 2 == 1 or fn == sn:
            r = node_hash(p, r)
            if fn % 2 == 0:
                while fn % 2 == 0 and fn != 0:
                    fn >>= 1
                    sn >>= 1
        else:
            r = node_hash(r, p)
        fn >>= 1
        sn >>= 1
    return sn == 0 and r == root


def hash_record(rec: dict[str, Any]) -> str:
    body = {k: v for k, v in rec.items() if k != "hash"}
    return sha3_hex(canonical(body))


def checkpoint_message(size: int, root: str, time: str) -> str:
    return sha3_hex(f"chainlock.navy/log/v1\n{size}\n{root}\n{time}\n")


def bits_to_hex(bits: list[int]) -> str:
    out = bytearray((len(bits) + 7) // 8)
    for i, b in enumerate(bits):
        if b:
            out[i >> 3] |= 1 << (7 - (i & 7))
    return out.hex()


def hex_to_bits(h: str, n: int) -> list[int]:
    b = bytes.fromhex(h)
    return [(b[i >> 3] >> (7 - (i & 7))) & 1 for i in range(n)]


def session_bits(nonce_hex: str, doc_id: str, recipient: str) -> list[int]:
    okm = hkdf(bytes.fromhex(nonce_hex) + doc_id.encode() + recipient.encode(), b"chainlock-session-v1", 8)
    return [(okm[i >> 3] >> (7 - (i & 7))) & 1 for i in range(SESSION_BITS)]


def commit_codeword(doc_id: str, recipient: str, bits: list[int], salt: str) -> str:
    return sha3_hex(canonical({"codeword": bits_to_hex(bits), "docId": doc_id, "recipient": recipient, "salt": salt}))


def commit_biases(doc_id: str, biases: list[int], salt: str) -> str:
    return sha3_hex(canonical({"biases": "".join(f"{q:04x}" for q in biases), "docId": doc_id, "salt": salt}))


def accusation_score(y: list[int], x: list[int], biases: list[int]) -> float:
    s = 0.0
    for i in range(TARDOS_BITS):
        yi = y[i]
        if yi < 0:
            continue
        p = biases[i] / P_SCALE
        g1, g0 = math.sqrt((1 - p) / p), math.sqrt(p / (1 - p))
        if yi == 1:
            s += g1 if x[i] == 1 else -g0
        else:
            s += g0 if x[i] == 0 else -g1
    return s


def _erfc(x: float) -> float:
    # Same Numerical Recipes approximation as the TypeScript engine.
    z = abs(x)
    t = 1 / (1 + 0.5 * z)
    r = t * math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))))
    return r if x >= 0 else 2 - r


def normal_q(z: float) -> float:
    return 0.5 * _erfc(z / math.sqrt(2))


def normal_q_inv(p: float) -> float:
    lo, hi = 0.0, 12.0
    for _ in range(80):
        mid = (lo + hi) / 2
        if normal_q(mid) > p:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def threshold(m: int, n: int, eps: float) -> float:
    return normal_q_inv(eps / max(1, n)) * math.sqrt(max(1, m))


# ---------------- signatures ----------------

def verify_sig(alg: str, pk_b64: str, msg_hex: str, sig_b64: str) -> bool | None:
    """True/False, or None if the PQC library for `alg` is not installed."""
    msg = bytes.fromhex(msg_hex)
    if alg.startswith("SIMULATED"):
        scheme = "slh" if "SLH" in alg else "sig"
        expect = base64.b64encode(hashlib.sha3_256(f"sim-sig:{scheme}".encode() + base64.b64decode(pk_b64) + msg).digest()).decode()
        return expect == sig_b64
    try:
        if alg.startswith("ML-DSA-65"):
            from dilithium_py.ml_dsa import ML_DSA_65

            return bool(ML_DSA_65.verify(base64.b64decode(pk_b64), msg, base64.b64decode(sig_b64)))
        if alg.startswith("SLH-DSA-SHA2-128f"):
            import slhdsa

            return bool(slhdsa.PublicKey.from_digest(base64.b64decode(pk_b64), slhdsa.sha2_128f).verify(msg, base64.b64decode(sig_b64)))
    except ImportError:
        return None
    except Exception:
        return False
    return False


# ---------------- verification ----------------

def verify_bundle(b: dict[str, Any]) -> Iterator[tuple[bool | None, str]]:
    yield b.get("format") == "chainlock-evidence/v1", f"Bundle {b.get('caseId')} format {b.get('format')}"
    cp = b["checkpoint"]
    recs = [(f"REGISTER #{b['register']['record']['index']}", b["register"]["record"], b["register"]["proof"])]
    recs += [(f"{s['record']['type']} #{s['record']['index']} ({s['officer']})", s["record"], s["proof"]) for s in b["sessions"]]
    if b.get("microdots") and b["microdots"].get("record"):
        recs.append((f"PRINT #{b['microdots']['record']['index']} (microdots)", b["microdots"]["record"], b["microdots"]["proof"]))
    for label, rec, proof in recs:
        yield hash_record(rec) == rec["hash"], f"{label}: record hash recomputes (SHA3-256)"
        ok = verify_inclusion(rec["index"] - 1, cp["size"], leaf_hash(rec["hash"]), proof, cp["root"])
        yield ok, f"{label}: Merkle inclusion proof -> checkpoint root {cp['root'][:12]}... (size {cp['size']})"

    msg = checkpoint_message(cp["size"], cp["root"], cp["time"])
    yield verify_sig(cp["log"]["alg"], cp["logPk"], msg, cp["log"]["sig"]), f"Checkpoint signature {cp['log']['alg']}"
    cos = 0
    for c in cp["cosigs"]:
        v = verify_sig(c["alg"], cp["witnessPks"].get(c["witness"], ""), msg, c["sig"])
        cos += 1 if v else 0
        yield v, f"Witness {c['witness']} co-signature ({c['alg']})"
    yield cos >= 2, f"Witness quorum: {cos} of {len(cp['cosigs'])} valid (>= 2 required - split-view defence)"

    t = b["tardos_parameters"]
    reg = b["register"]["record"]
    commit_map = dict(kv.split("=") for kv in str(reg.get("meta", {}).get("commitments", "")).split(",") if "=" in kv)
    yield commit_biases(b["docId"], t["biases"], t["biasSalt"]) == reg.get("meta", {}).get("biasCommitment"), "Tardos bias vector matches commitment published at REGISTER"
    for s in b["scores"]:
        bits = hex_to_bits(s["codeword"], TARDOS_BITS)
        yield commit_codeword(b["docId"], s["id"], bits, s["salt"]) == commit_map.get(s["id"]), f"{s['id']} codeword matches REGISTER commitment (cannot be fabricated after the leak)"
    for s in b["sessions"]:
        cw = next((x["codeword"] for x in b["scores"] if x["id"] == s["officer"]), "")
        full = hex_to_bits(cw, TARDOS_BITS) + session_bits(s["record"].get("sessionNonce", ""), b["docId"], s["officer"])
        yield sha3_hex("cw:" + bits_to_hex(full)) == s["record"].get("codewordHash"), f"{s['officer']} session codeword hash matches ledger record #{s['record']['index']}"
        if s.get("request") and s.get("signature"):
            req, sig = s["request"], s["signature"]
            fields = req.get("session_nonce") == s["record"].get("sessionNonce") and req.get("doc_id") == b["docId"] and req.get("recipient_id") == s["officer"]
            yield fields and sha3_hex(sig["sig"]) == s["record"].get("sigHash"), f"{s['officer']} request fields and signature hash bound to on-chain record"
            yield verify_sig(sig["alg"], sig["pk"], sha3_hex(canonical(req)), sig["sig"]), f"{s['officer']} {sig['alg']} signature over request - non-repudiation (R5)"

    y = [-1 if c == "-" else int(c) for c in b["recovered_pattern"]["symbols"]]
    m = sum(1 for v in y[:TARDOS_BITS] if v >= 0)
    Z = threshold(m, t["n"], t["epsilon"])
    for s in b["scores"]:
        score = accusation_score(y, hex_to_bits(s["codeword"], TARDOS_BITS), t["biases"])
        accused = m > 0 and score > Z
        yield abs(score - s["score"]) < 1e-3 and accused == s["accused"], f"{s['id']} Tardos score recomputed {score:.2f} {'>' if accused else '<='} {Z:.2f} -> {'ACCUSED' if accused else 'not accused'}"
    bound = min(1.0, t["n"] * normal_q(Z / math.sqrt(max(1, m))))
    yield True, f"False-accusation bound <= {bound:.2e} (Gaussian approximation, n={t['n']}, m={m})"
    if b.get("microdots"):
        r = b["microdots"].get("record")
        yield bool(r), f"Microdot ledger index 0x{b['microdots']['index']} -> " + (f"PRINT record #{r['index']} by {r['actor']}" if r else "no matching record")
    if b.get("mic"):
        yield True, f"Manufacturer MIC decoded: printer serial {b['mic']['serial']}, printed {b['mic']['time']}"


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    with open(sys.argv[1], encoding="utf-8") as f:
        bundle = json.load(f)
    print(f"ChainLock evidence verifier v1 - {sys.argv[1]} - trusts nothing but this file\n")
    fails = unknown = passed = 0
    for ok, text in verify_bundle(bundle):
        tag = "[OK]  " if ok is True else "[FAIL]" if ok is False else "[ -- ]"
        print(f"{tag} {text}")
        if ok is True:
            passed += 1
        elif ok is False:
            fails += 1
        else:
            unknown += 1
    print()
    if fails:
        print(f"VERIFICATION FAILED - {fails} check(s) failed. This bundle must not be relied on.")
        return 1
    note = f" ({unknown} signature check(s) skipped: pip install -r requirements.txt)" if unknown else ""
    print(f"ALL {passed} CHECKS PASSED - evidence independently verified{note}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
