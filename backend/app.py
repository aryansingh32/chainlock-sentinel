"""ChainLock Crypto Core service — FastAPI.

Run:   cd backend && pip install -r requirements.txt && uvicorn app:app --port 8000
Docs:  http://127.0.0.1:8000/docs

In this prototype one process plays several roles that are separate machines
in production: each officer's device agent (holds that officer's private
keys), the three key-release org nodes, the transparency-log signer and its
witnesses, and the SOC's bundle receiver. The keystore file stands in for
per-device hardware tokens. The React app runs the ledger, Merkle log and
Tardos tracing itself and calls this service for every post-quantum
operation.
"""
from __future__ import annotations

import base64
import json
import threading
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from starlette.requests import Request

import crypto_core as cc
import verifier

KEYSTORE = Path(__file__).parent / ".keystore" / "keys.json"
_lock = threading.Lock()

app = FastAPI(title="ChainLock Crypto Core", version="0.9", description="ML-KEM-768 · ML-DSA-65 · SLH-DSA · AES-256-GCM · HKDF-SHA3-256")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.middleware("http")
async def private_network_access(request: Request, call_next):
    # Lets a hosted HTTPS preview call this service on localhost (Chrome PNA).
    response = await call_next(request)
    response.headers["Access-Control-Allow-Private-Network"] = "true"
    return response


b64 = lambda b: base64.b64encode(b).decode()  # noqa: E731
unb64 = lambda s: base64.b64decode(s)  # noqa: E731

# ---------------- keystore ----------------

def _load() -> dict[str, Any]:
    if KEYSTORE.exists():
        return json.loads(KEYSTORE.read_text())
    return {}


_keys: dict[str, Any] = _load()


def _save() -> None:
    KEYSTORE.parent.mkdir(exist_ok=True)
    KEYSTORE.write_text(json.dumps(_keys))


GEN = {"sig": (cc.sig_keygen, cc.ALG_SIG), "kem": (cc.kem_keygen, cc.ALG_KEM), "slh": (cc.slh_keygen, cc.ALG_SLH)}


def _ensure(identity: str, scheme: str, rotate: bool = False) -> dict[str, str]:
    with _lock:
        entry = _keys.setdefault(identity, {})
        if rotate or scheme not in entry:
            pk, sk = GEN[scheme][0]()
            entry[scheme] = {"pk": pk.hex(), "sk": sk.hex()}
            _save()
        return entry[scheme]


def _public(identity: str, scheme: str) -> dict[str, Any]:
    k = _ensure(identity, scheme)
    pk = bytes.fromhex(k["pk"])
    return {"alg": GEN[scheme][1], "pk": b64(pk), "bytes": len(pk)}


def _sk(identity: str, scheme: str) -> bytes:
    return bytes.fromhex(_ensure(identity, scheme)["sk"])


def _pk(identity: str, scheme: str) -> bytes:
    return bytes.fromhex(_ensure(identity, scheme)["pk"])


# ---------------- models ----------------

class IdSpec(BaseModel):
    id: str
    schemes: list[str]


class IdentitiesReq(BaseModel):
    ids: list[IdSpec]


class RotateReq(BaseModel):
    schemes: list[str]


class SignReq(BaseModel):
    id: str
    msg: str  # hex
    scheme: str = "sig"


class BatchReq(BaseModel):
    items: list[SignReq]


class VerifyReq(BaseModel):
    alg: str
    pk: str  # base64
    msg: str  # hex
    sig: str  # base64


class WrapReq(BaseModel):
    org: str
    recipient: str
    share: str  # hex


class UnwrapReq(BaseModel):
    recipient: str
    ct: str
    nonce: str
    wrapped: str


class SealReq(BaseModel):
    device: str
    payload: dict[str, Any]


class OpenReq(BaseModel):
    device: str
    ct: str
    nonce: str
    body: str
    sig: str
    bytes: int | None = None
    alg: str | None = None


class EvidenceReq(BaseModel):
    bundle: dict[str, Any]


# ---------------- endpoints ----------------

@app.get("/api/health")
def health():
    return {"ok": True, "service": "chainlock-crypto-core", "impl": cc.IMPL, "algorithms": [cc.ALG_KEM, cc.ALG_SIG, cc.ALG_SLH, "AES-256-GCM", "HKDF-SHA3-256"], "identities": len(_keys)}


@app.post("/api/identities")
def identities(req: IdentitiesReq):
    return {s.id: {scheme: _public(s.id, scheme) for scheme in s.schemes} for s in req.ids}


@app.post("/api/identities/{identity}/rotate")
def rotate(identity: str, req: RotateReq):
    out = {}
    for scheme in req.schemes:
        _ensure(identity, scheme, rotate=True)
        out[scheme] = _public(identity, scheme)
    return out


def _sign(r: SignReq) -> dict[str, Any]:
    msg = bytes.fromhex(r.msg)
    if r.scheme == "slh":
        sig = cc.slh_sign(_sk(r.id, "slh"), msg)
        alg = cc.ALG_SLH
    else:
        sig = cc.sig_sign(_sk(r.id, "sig"), msg)
        alg = cc.ALG_SIG
    return {"alg": alg, "sig": b64(sig), "bytes": len(sig)}


@app.post("/api/sign")
def sign(r: SignReq):
    return _sign(r)


@app.post("/api/sign-batch")
def sign_batch(r: BatchReq):
    return [_sign(i) for i in r.items]


@app.post("/api/verify")
def verify(r: VerifyReq):
    return {"valid": verifier.verify_sig(r.alg, r.pk, r.msg, r.sig)}


@app.post("/api/quorum/wrap")
def quorum_wrap(r: WrapReq):
    """Org node wraps its key-set share to the recipient's ML-KEM-768 key (§4.3 step 5)."""
    ct, ss = cc.kem_encaps(_pk(r.recipient, "kem"))
    kek = cc.hkdf(ss, b"chainlock-share-v1")
    nonce, wrapped = cc.aead_encrypt(kek, bytes.fromhex(r.share), aad=r.org.encode())
    return {"ct": b64(ct), "nonce": nonce.hex(), "wrapped": b64(wrapped + r.org.encode().ljust(8, b"\0")[:8]), "ctBytes": len(ct), "alg": cc.ALG_KEM}


@app.post("/api/agent/unwrap")
def agent_unwrap(r: UnwrapReq):
    """Recipient device decapsulates with its private KEM key (§4.3 step 6)."""
    raw = unb64(r.wrapped)
    body, org = raw[:-8], raw[-8:].rstrip(b"\0")
    ss = cc.kem_decaps(_sk(r.recipient, "kem"), unb64(r.ct))
    kek = cc.hkdf(ss, b"chainlock-share-v1")
    try:
        share = cc.aead_decrypt(kek, bytes.fromhex(r.nonce), body, aad=org)
    except Exception as e:  # authentication tag failure
        raise HTTPException(400, "share authentication failed") from e
    return {"share": share.hex()}


@app.post("/api/bundle/seal")
def bundle_seal(r: SealReq):
    """SENTINEL-MESH bundle: encrypt to SOC (ML-KEM-768 + AES-256-GCM), sign as workstation (ML-DSA-65)."""
    payload = json.dumps(r.payload, separators=(",", ":")).encode()
    ct, ss = cc.kem_encaps(_pk("SOC", "kem"))
    kek = cc.hkdf(ss, b"sentinel-bundle-v1")
    nonce, body = cc.aead_encrypt(kek, payload)
    sig = cc.sig_sign(_sk(r.device, "sig"), cc.sha3(ct + nonce + body))
    return {"ct": b64(ct), "nonce": nonce.hex(), "body": b64(body), "sig": b64(sig), "bytes": len(payload), "alg": "ML-KEM-768 + ML-DSA-65 + AES-256-GCM"}


@app.post("/api/bundle/open")
def bundle_open(r: OpenReq):
    ct, nonce, body = unb64(r.ct), bytes.fromhex(r.nonce), unb64(r.body)
    if not cc.sig_verify(_pk(r.device, "sig"), cc.sha3(ct + nonce + body), unb64(r.sig)):
        return {"valid": False, "payload": None}
    ss = cc.kem_decaps(_sk("SOC", "kem"), ct)
    try:
        payload = cc.aead_decrypt(cc.hkdf(ss, b"sentinel-bundle-v1"), nonce, body)
    except Exception:
        return {"valid": False, "payload": None}
    return {"valid": True, "payload": json.loads(payload)}


@app.post("/api/evidence/verify")
def evidence_verify(r: EvidenceReq):
    lines = list(verifier.verify_bundle(r.bundle))
    return {"ok": all(ok is not False for ok, _ in lines), "lines": [{"ok": ok, "text": t} for ok, t in lines]}
