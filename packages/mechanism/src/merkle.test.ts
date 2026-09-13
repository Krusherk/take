import { describe, expect, it } from "vitest";
import { domainHash } from "./canonical.js";
import { buildMerkleSet, hashMerklePair, verifyMerkleProof } from "./merkle.js";

describe("identity-key Merkle sets", () => {
  const keys = [0, 1, 2].map((value) => domainHash("TAKE_TEST_IDENTITY_V1", { value }));

  it("uses raw bytes32 leaves, sorted pairs, and promotes an odd leaf", () => {
    const tree = buildMerkleSet([keys[2]!, keys[0]!, keys[1]!, keys[1]!]);
    const sorted = [...keys].sort();
    const expected = hashMerklePair(hashMerklePair(sorted[0]!, sorted[1]!), sorted[2]!);

    expect(tree.leaves).toEqual(sorted);
    expect(tree.root).toBe(expected);
    for (const leaf of tree.leaves) {
      expect(verifyMerkleProof(leaf, tree.proofs.get(leaf) ?? [], tree.root)).toBe(true);
    }
  });

  it("rejects a proof for another identity", () => {
    const tree = buildMerkleSet(keys);
    const outsider = domainHash("TAKE_TEST_IDENTITY_V1", { value: "outsider" });
    expect(verifyMerkleProof(outsider, tree.proofs.get(keys[0]!) ?? [], tree.root)).toBe(false);
  });
});
