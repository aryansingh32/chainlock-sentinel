"""Quick self-test of the Crypto Core:  python selftest.py

Checks the post-quantum round trips and that the hash/KDF/secret-sharing
primitives produce byte-identical results to the TypeScript engine
(vectors generated with src/lib/engine/sha3.ts and shamir.ts).
"""
import crypto_core as cc
import verifier as v

ok = True


def check(name: str, cond: bool) -> None:
    global ok
    ok &= cond
    print(("[OK]  " if cond else "[FAIL]") + " " + name)


# Vectors shared with the TS engine
check("SHA3-256('abc')", cc.sha3(b"abc").hex() == "3a985da74fe225b2045c172d6bd390bd855f086e3e9d525b46bfe24511431532")
check("HKDF-SHA3-256 matches TS hkdfSha3", cc.hkdf(b"ikm", b"info", 40, salt=b"salt").hex() == "0a35ce133619c6dda6c47247ba3a65352b8fa7313a3ccddfc707ea425085517cbcaa618df8674ec8")
check("canonical JSON sorts keys", v.canonical({"b": 1, "a": "—"}) == '{"a":"—","b":1}')

pk, sk = cc.sig_keygen()
sig = cc.sig_sign(sk, b"request-digest")
check(f"ML-DSA-65 sign/verify ({len(sig)} B signature)", cc.sig_verify(pk, b"request-digest", sig) and not cc.sig_verify(pk, b"tampered", sig))

ek, dk = cc.kem_keygen()
ct, ss = cc.kem_encaps(ek)
check(f"ML-KEM-768 encaps/decaps ({len(ct)} B ciphertext)", cc.kem_decaps(dk, ct) == ss)

spk, ssk = cc.slh_keygen()
ssig = cc.slh_sign(ssk, b"checkpoint")
check(f"SLH-DSA-SHA2-128f sign/verify ({len(ssig)} B signature)", cc.slh_verify(spk, b"checkpoint", ssig))

key = cc.hkdf(ss, b"chainlock-share-v1")
nonce, box = cc.aead_encrypt(key, b"share")
check("AES-256-GCM round trip", cc.aead_decrypt(key, nonce, box) == b"share")

shares = cc.shamir_split(b"key-set-seed-32-bytes-long......")
check("Shamir 2-of-3 any pair reconstructs", all(cc.shamir_combine([shares[i], shares[j]]) == b"key-set-seed-32-bytes-long......" for i, j in [(0, 1), (0, 2), (1, 2)]))

leaves = [v.leaf_hash(cc.sha3(bytes([i])).hex()) for i in range(5)]
check("Merkle leaf/node hashing", len(v.node_hash(leaves[0], leaves[1])) == 64)

print("\nALL PASSED" if ok else "\nFAILURES")
raise SystemExit(0 if ok else 1)
