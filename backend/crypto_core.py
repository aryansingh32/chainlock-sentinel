"""ChainLock Crypto Core (handbook §7.1, module M1).

Interface contract exposed to every other module:
    kem_keygen / kem_encaps / kem_decaps        ML-KEM-768   (FIPS 203)
    sig_keygen / sig_sign / sig_verify          ML-DSA-65    (FIPS 204)
    slh_keygen / slh_sign / slh_verify          SLH-DSA-SHA2-128f (FIPS 205)
    aead_encrypt / aead_decrypt                 AES-256-GCM
    hkdf                                        HKDF-SHA3-256
    sha3                                        SHA3-256
    shamir_split / shamir_combine               2-of-3 over GF(256)

Pure-Python reference implementations are used (dilithium-py, kyber-py,
slh-dsa) so the service installs anywhere with `pip`. For production swap in
liboqs-python — the function signatures stay the same.
"""
from __future__ import annotations

import hashlib
import hmac
import os
import secrets

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from dilithium_py.ml_dsa import ML_DSA_65
from kyber_py.ml_kem import ML_KEM_768
import slhdsa

ALG_SIG = "ML-DSA-65 / FIPS-204"
ALG_KEM = "ML-KEM-768 / FIPS-203"
ALG_SLH = "SLH-DSA-SHA2-128f / FIPS-205"
IMPL = "dilithium-py · kyber-py · slh-dsa (pure Python reference)"

_SLH_PARAMS = slhdsa.sha2_128f


# ---------- hashing / KDF ----------

def sha3(data: bytes) -> bytes:
    return hashlib.sha3_256(data).digest()


def hkdf(ikm: bytes, info: bytes, length: int = 32, salt: bytes = b"") -> bytes:
    """HKDF-SHA3-256 (RFC 5869). Matches src/lib/engine/sha3.ts hkdfSha3."""
    prk = hmac.new(salt or bytes(32), ikm, hashlib.sha3_256).digest()
    out, prev, i = b"", b"", 1
    while len(out) < length:
        prev = hmac.new(prk, prev + info + bytes([i]), hashlib.sha3_256).digest()
        out += prev
        i += 1
    return out[:length]


# ---------- ML-DSA-65 ----------

def sig_keygen() -> tuple[bytes, bytes]:
    return ML_DSA_65.keygen()


def sig_sign(sk: bytes, msg: bytes) -> bytes:
    return ML_DSA_65.sign(sk, msg)


def sig_verify(pk: bytes, msg: bytes, sig: bytes) -> bool:
    try:
        return bool(ML_DSA_65.verify(pk, msg, sig))
    except Exception:
        return False


# ---------- ML-KEM-768 ----------

def kem_keygen() -> tuple[bytes, bytes]:
    ek, dk = ML_KEM_768.keygen()
    return ek, dk


def kem_encaps(pk: bytes) -> tuple[bytes, bytes]:
    """Returns (ciphertext, shared_secret)."""
    ss, ct = ML_KEM_768.encaps(pk)
    return ct, ss


def kem_decaps(sk: bytes, ct: bytes) -> bytes:
    return ML_KEM_768.decaps(sk, ct)


# ---------- SLH-DSA ----------

def slh_keygen() -> tuple[bytes, bytes]:
    kp = slhdsa.KeyPair.gen(_SLH_PARAMS)
    return kp.pub.digest(), kp.sec.digest()


def slh_sign(sk: bytes, msg: bytes) -> bytes:
    return slhdsa.SecretKey.from_digest(sk, _SLH_PARAMS).sign(msg)


def slh_verify(pk: bytes, msg: bytes, sig: bytes) -> bool:
    try:
        return bool(slhdsa.PublicKey.from_digest(pk, _SLH_PARAMS).verify(msg, sig))
    except Exception:
        return False


# ---------- AEAD ----------

def aead_encrypt(key: bytes, plaintext: bytes, aad: bytes | None = None) -> tuple[bytes, bytes]:
    nonce = os.urandom(12)
    return nonce, AESGCM(key).encrypt(nonce, plaintext, aad)


def aead_decrypt(key: bytes, nonce: bytes, ciphertext: bytes, aad: bytes | None = None) -> bytes:
    return AESGCM(key).decrypt(nonce, ciphertext, aad)


# ---------- Shamir 2-of-3 over GF(256) (matches src/lib/engine/shamir.ts) ----------

_EXP = [0] * 512
_LOG = [0] * 256
_x = 1
for _i in range(255):
    _EXP[_i] = _x
    _LOG[_x] = _i
    _x ^= (_x << 1) ^ (0x11B if _x & 0x80 else 0)
    _x &= 0xFF
for _i in range(255, 512):
    _EXP[_i] = _EXP[_i - 255]


def _mul(a: int, b: int) -> int:
    return 0 if a == 0 or b == 0 else _EXP[_LOG[a] + _LOG[b]]


def _div(a: int, b: int) -> int:
    return 0 if a == 0 else _EXP[(_LOG[a] + 255 - _LOG[b]) % 255]


def shamir_split(secret: bytes, n: int = 3, k: int = 2) -> list[tuple[int, bytes]]:
    coeffs = [secrets.token_bytes(len(secret)) for _ in range(k - 1)]
    shares = []
    for x in range(1, n + 1):
        y = bytearray()
        for b, s in enumerate(secret):
            acc, xp = s, 1
            for c in coeffs:
                xp = _mul(xp, x)
                acc ^= _mul(c[b], xp)
            y.append(acc)
        shares.append((x, bytes(y)))
    return shares


def shamir_combine(shares: list[tuple[int, bytes]]) -> bytes:
    out = bytearray()
    for b in range(len(shares[0][1])):
        acc = 0
        for i, (xi, yi) in enumerate(shares):
            num = den = 1
            for j, (xj, _) in enumerate(shares):
                if i != j:
                    num = _mul(num, xj)
                    den = _mul(den, xi ^ xj)
            acc ^= _mul(yi[b], _div(num, den))
        out.append(acc)
    return bytes(out)
