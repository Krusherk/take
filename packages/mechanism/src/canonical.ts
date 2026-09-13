import { canonicalJson } from "@take/shared";
import { keccak256, stringToHex, type Hex } from "viem";

export function canonicalArtifact(value: unknown): string {
  return canonicalJson(value);
}

export function domainHash(domain: string, value: unknown): Hex {
  if (!/^[A-Z0-9_:@.-]+$/.test(domain)) {
    throw new TypeError("Hash domain must be an uppercase stable identifier");
  }
  return keccak256(stringToHex(`${domain}\n${canonicalArtifact(value)}`));
}

export function mechanismConfigHash(value: unknown): Hex {
  return domainHash("TAKE_MECHANISM_CONFIG_V1", value);
}

export function evidenceHash(value: unknown): Hex {
  return domainHash("TAKE_EVIDENCE_OBSERVATION_V1", value);
}

export function eligibilitySnapshotHash(value: unknown): Hex {
  return domainHash("TAKE_ELIGIBILITY_SNAPSHOT_V1", value);
}
