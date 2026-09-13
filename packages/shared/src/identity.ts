import { encodePacked, keccak256, stringToHex, type Hex } from "viem";

export const TAKE_PROTOCOL_IDENTITY_NAMESPACE = "TAKE_PROTOCOL_IDENTITY_V1";
export const TAKE_EXTERNAL_IDENTITY_NAMESPACE = "TAKE_EXTERNAL_IDENTITY_V1";

export type IdentityProvider = "twitter" | "farcaster" | "github" | "discord";

export function protocolIdentityKey(takeIdentityId: string, creationNonce: string): Hex {
  return keccak256(
    encodePacked(
      ["bytes", "string", "string"],
      [stringToHex(TAKE_PROTOCOL_IDENTITY_NAMESPACE), takeIdentityId, creationNonce]
    )
  );
}

export function externalIdentityKey(provider: IdentityProvider, immutableProviderUserId: string): Hex {
  return keccak256(
    encodePacked(
      ["bytes", "string", "string"],
      [stringToHex(TAKE_EXTERNAL_IDENTITY_NAMESPACE), provider, immutableProviderUserId]
    )
  );
}

export function normalizeAddress(address: string): Lowercase<string> {
  return address.toLowerCase() as Lowercase<string>;
}
