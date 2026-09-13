import { describe, expect, it } from "vitest";
import { canonicalArtifact, domainHash } from "./canonical.js";

describe("canonical artifacts", () => {
  it("sorts object keys recursively and preserves array order", () => {
    expect(canonicalArtifact({ z: 1, nested: { b: true, a: "take" }, list: [2, 1] }))
      .toBe('{"list":[2,1],"nested":{"a":"take","b":true},"z":1}');
  });

  it("produces stable domain-separated hashes", () => {
    const left = domainHash("TAKE_TEST_V1", { b: 2, a: 1 });
    const right = domainHash("TAKE_TEST_V1", { a: 1, b: 2 });
    expect(left).toBe(right);
    expect(domainHash("TAKE_TEST_V2", { a: 1, b: 2 })).not.toBe(left);
  });

  it("rejects values whose serialization would be ambiguous", () => {
    expect(() => canonicalArtifact({ at: new Date() })).toThrow(/Date/);
    expect(() => canonicalArtifact({ amount: 1n })).toThrow(/bigint/);
    expect(() => domainHash("lowercase", {})).toThrow(/domain/i);
  });
});
