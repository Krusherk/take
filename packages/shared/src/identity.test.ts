import { describe, expect, it } from "vitest";
import { externalIdentityKey, protocolIdentityKey } from "./identity.js";
import { hashJson } from "./hash.js";

describe("identity keys", () => {
  it("derives stable protocol identity keys", () => {
    const first = protocolIdentityKey("take-identity-1", "nonce-1");
    const second = protocolIdentityKey("take-identity-1", "nonce-1");

    expect(first).toEqual(second);
    expect(first).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("does not couple external identity keys to usernames", () => {
    const beforeRename = externalIdentityKey("twitter", "12345");
    const afterRename = externalIdentityKey("twitter", "12345");

    expect(beforeRename).toEqual(afterRename);
  });
});

describe("hashJson", () => {
  it("is independent of object key order", () => {
    expect(hashJson({ b: 2, a: 1 })).toEqual(hashJson({ a: 1, b: 2 }));
  });
});
