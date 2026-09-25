// RFC 6962 / RFC 9162 style Merkle tree over SHA3-256.
//   leaf  = SHA3(0x00 || data)
//   node  = SHA3(0x01 || left || right)
import { concat, fromHex, toHex } from "./bytes";
import { sha3_256 } from "./sha3";

export function leafHash(dataHex: string): string {
  return toHex(sha3_256(concat(new Uint8Array([0]), fromHex(dataHex))));
}

export function nodeHash(l: string, r: string): string {
  return toHex(sha3_256(concat(new Uint8Array([1]), fromHex(l), fromHex(r))));
}

function largestPow2Below(n: number) {
  let k = 1;
  while (k * 2 < n) k *= 2;
  return k;
}

/** Merkle Tree Hash of the leaf hashes `leaves[0..n)`. */
export function merkleRoot(leaves: string[]): string {
  if (leaves.length === 0) return toHex(sha3_256(new Uint8Array(0)));
  if (leaves.length === 1) return leaves[0]!;
  const k = largestPow2Below(leaves.length);
  return nodeHash(merkleRoot(leaves.slice(0, k)), merkleRoot(leaves.slice(k)));
}

/** Audit path for leaf `m` in the tree of `leaves` (RFC 6962 PATH(m, D[n])). */
export function inclusionProof(m: number, leaves: string[]): string[] {
  const n = leaves.length;
  if (n <= 1) return [];
  const k = largestPow2Below(n);
  if (m < k) return [...inclusionProof(m, leaves.slice(0, k)), merkleRoot(leaves.slice(k))];
  return [...inclusionProof(m - k, leaves.slice(k)), merkleRoot(leaves.slice(0, k))];
}

/** RFC 9162 §2.1.3.2 inclusion verification. */
export function verifyInclusion(
  index: number,
  size: number,
  leaf: string,
  proof: string[],
  root: string,
): boolean {
  if (index >= size) return false;
  let fn = index;
  let sn = size - 1;
  let r = leaf;
  for (const p of proof) {
    if (sn === 0) return false;
    if (fn % 2 === 1 || fn === sn) {
      r = nodeHash(p, r);
      if (fn % 2 === 0) {
        while (fn % 2 === 0 && fn !== 0) {
          fn >>= 1;
          sn >>= 1;
        }
      }
    } else {
      r = nodeHash(r, p);
    }
    fn >>= 1;
    sn >>= 1;
  }
  return sn === 0 && r === root;
}
