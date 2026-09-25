# ChainLock + SENTINEL — SIH26237 prototype

**Cryptographic attribution and immutable decryption provenance for multi-recipient encrypted document distribution.**
Smart India Hackathon 2026 · Ministry of Defence · Indian Navy (WESEE) · Software · Blockchain & Cybersecurity.

> "We do not add a watermark after decryption. The decryption itself is the watermark."

This is a working web prototype of the design in the team handbook: a React console for every role (Officer, HQ Sender,
Investigator, SENTINEL SOC) plus a small Python **Crypto Core** service that does the real post-quantum cryptography.

## Run it

```sh
# 1. Web app (works on its own — "SIMULATED" signatures)
npm i            # or: bun install
npm run dev      # http://localhost:5173 (or the port Vite prints)

# 2. Crypto Core (optional, turns on real ML-DSA-65 / ML-KEM-768 / SLH-DSA)
cd backend
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app:app --port 8000                          # API docs: http://127.0.0.1:8000/docs
python selftest.py                                   # crypto round-trips + TS/Python vectors
```

The top bar shows **Crypto core LIVE** once the backend is reachable (click the badge to change its URL). If the ledger
was first built in simulated mode, a banner offers **Rebuild with real PQC**. Press **D** anywhere for the demo control
panel; **Briefing → Jury demo script** has the 12-step run-sheet from handbook Part 8 with one-click "Go" buttons.

Tip: open the SOC dashboard in a second window on the projector — state syncs across tabs, so the officer's actions
show up there live.

## What is real in this prototype

| Area | Status | Where |
| --- | --- | --- |
| SHA3-256 hash-chained ledger, RFC 6962 Merkle log, inclusion proofs | **Real** | `src/lib/engine/ledger.ts`, `merkle.ts` |
| Checkpoints signed by the log + 3 witnesses (split-view defence), tamper and history-rewrite detection | **Real** (SLH-DSA when backend is live) | Ledger Explorer |
| Log-before-decrypt: signed request → 2-of-3 endorsement → commit → quorum verifies proof → key release | **Real** protocol, ML-DSA-65 + ML-KEM-768 when live | `src/lib/app.ts` `openDocument` |
| Shamir 2-of-3 split of each recipient's key set (GF(256)) | **Real** | `shamir.ts` |
| Tardos codes: 256 fixed bits + 64 session bits, symmetric accusation score, threshold, false-accusation bound | **Real** | `tardos.ts` |
| A/B variant rendering: line shift, word shift, micro-pattern, optional lexical (prose-only) | **Real** (canvas) | `render.ts` |
| Forensic extractor: page split, DCT pHash, line-centroid decoding, erasures, microdots + printer MIC decode | **Real** — runs on the pixels of the leaked image | `forensics.ts` |
| Collusion attack (splice two copies) → both named | **Real** | Trace → "Merged copy" |
| Evidence bundle + offline verifier (browser **and** `backend/verifier.py`) | **Real** — Python verifies bundles exported by the browser | Evidence page |
| SENTINEL-MESH bundles: ML-KEM encrypt to SOC + ML-DSA sign, sequence-gap and heartbeat-silence detection | **Real** crypto, simulated radio | Relay Mesh, SOC |
| Hyperledger Fabric network | Simulated by an in-process 3-org ledger | production path: Fabric 2.5 + hybrid ML-DSA/ECDSA |
| Canary server, pHash crawler, MFP scan hook, LoRa hardware | Events simulated from the demo panel | production path in handbook §5 |
| PDF/DOCX parsing | `.txt/.md` uploads are segmented and marked; other formats use the synthetic template | PyMuPDF in production |

All documents, units, call signs and coordinates are **synthetic exercise data**.

### Try the forensics yourself
1. Open a document as an officer → **Simulate leak (10-page PNG)** or **Simulate phone photo p3** (or print, then
   **Export scan of printout**).
2. Drop the file on **Trace a Leak**. The extractor identifies the page by pHash, reads the 32 marks per page from the
   pixels and scores every recipient. A full document names the officer with a huge margin; a single page gives a
   moderate result; a cropped paragraph is honestly reported as **low confidence** with no accusation.
3. **Seal evidence bundle** → **Export JSON bundle** → `python backend/verifier.py evidence-CASE-0xx.json` with the web app
   switched off.

## Code map

```
src/lib/engine/     pure TypeScript engine (no dependencies)
  sha3.ts           SHA3-256, HMAC, HKDF-SHA3-256
  ledger.ts merkle.ts  records, checkpoints, verification, tamper
  tardos.ts shamir.ts  fingerprint code and secret sharing
  render.ts forensics.ts trace.ts  marking, extraction, accusation, evidence
  crypto-core.ts    LIVE (backend) / SIMULATED crypto provider
  seed.ts ops.ts    the "Operation Order 7" scenario of handbook §1.2
src/lib/app.ts      state + actions (persisted, cross-tab)
src/components/pages/*   one file per screen
src/routes/         TanStack file routes (_app.* share the shell)
backend/            FastAPI Crypto Core, offline verifier, self-test
```

Handbook interface contracts (§7.1): the Crypto Core exposes `kem_*`, `sig_*`, `slh_*`, `aead_*`, `hkdf`,
`shamir_split/combine` in `backend/crypto_core.py`; M2/M3/M4 can replace the in-browser ledger and extractor behind the
same shapes. The pure-Python PQC libraries can be swapped for `liboqs-python` without changing the API.

## Honest limits
Analogue hole, unmanaged cameras, heavy crops, doubled package size, Fabric's internal ECDSA, MFP SDK cost and RF
accreditation are all addressed on **Briefing → Honest limits & viva**. The Tardos bias window was tuned by simulation for
the short-code regime (L = 256, n ≤ 50, coalitions ≤ 3): 400/400 two-colluder traces named both colluders with zero false
accusations.

---
This project is connected to [Lovable](https://lovable.dev/projects/2f54811d-44ad-4e71-b5ee-d215cb07504d); commits to this
branch sync back to the editor.
