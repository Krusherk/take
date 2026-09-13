import { concatHex, keccak256, zeroHash, type Hex } from "viem";

export interface MerkleSet {
  root: Hex;
  leaves: Hex[];
  proofs: ReadonlyMap<Hex, Hex[]>;
}

export function normalizeIdentityKey(value: string): Hex {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new TypeError(`Invalid bytes32 identity key: ${value}`);
  }
  return value.toLowerCase() as Hex;
}

export function hashMerklePair(left: Hex, right: Hex): Hex {
  const [first, second] = left.toLowerCase() <= right.toLowerCase()
    ? [left, right]
    : [right, left];
  return keccak256(concatHex([first, second]));
}

export function buildMerkleSet(identityKeys: readonly string[]): MerkleSet {
  const leaves = [...new Set(identityKeys.map(normalizeIdentityKey))].sort(compareHex);
  if (leaves.length === 0) {
    return { root: zeroHash, leaves, proofs: new Map() };
  }

  const levels: Hex[][] = [leaves];
  while ((levels.at(-1)?.length ?? 0) > 1) {
    const current = levels.at(-1)!;
    const next: Hex[] = [];
    for (let index = 0; index < current.length; index += 2) {
      const left = current[index]!;
      const right = current[index + 1];
      next.push(right ? hashMerklePair(left, right) : left);
    }
    levels.push(next);
  }

  const proofs = new Map<Hex, Hex[]>();
  for (let leafIndex = 0; leafIndex < leaves.length; leafIndex += 1) {
    let index = leafIndex;
    const proof: Hex[] = [];
    for (let levelIndex = 0; levelIndex < levels.length - 1; levelIndex += 1) {
      const level = levels[levelIndex]!;
      const siblingIndex = index % 2 === 0 ? index + 1 : index - 1;
      const sibling = level[siblingIndex];
      if (sibling) proof.push(sibling);
      index = Math.floor(index / 2);
    }
    proofs.set(leaves[leafIndex]!, proof);
  }

  return { root: levels.at(-1)![0]!, leaves, proofs };
}

export function verifyMerkleProof(leafValue: string, proofValues: readonly string[], rootValue: string): boolean {
  let computed = normalizeIdentityKey(leafValue);
  const root = normalizeIdentityKey(rootValue);
  for (const proofElement of proofValues) {
    computed = hashMerklePair(computed, normalizeIdentityKey(proofElement));
  }
  return computed === root;
}

function compareHex(left: Hex, right: Hex): number {
  return left.toLowerCase().localeCompare(right.toLowerCase());
}
