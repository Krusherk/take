# Identity Architecture

## Decision

TAKE uses two identity layers:

1. `TakeIdentity`: the protocol/application-native person identity.
2. `ExternalIdentity`: a provider-specific identity, such as an X account, that can exist before the person joins TAKE.

The contract cannot reason about database UUIDs, so it receives `bytes32` identity keys.

## Key Types

### Protocol Identity Key

`protocolIdentityKey` is generated when a person becomes a TAKE participant.

```text
protocolIdentityKey = keccak256(
  abi.encodePacked("TAKE_PROTOCOL_IDENTITY_V1", databaseTakeIdentityId, creationNonce)
)
```

This key is not Twitter-owned and should remain stable across wallets and social-account changes.

### External Identity Key

`externalIdentityKey` identifies a verified provider account.

```text
externalIdentityKey = keccak256(
  abi.encodePacked("TAKE_EXTERNAL_IDENTITY_V1", provider, immutableProviderUserId)
)
```

For X, `immutableProviderUserId` is Privy's Twitter `subject`, not the mutable username.

## Contract Representation

The contract stores an alias graph:

```text
wallet address -> authorized protocolIdentityKey
identityKey -> canonical protocolIdentityKey
```

For a TAKE user:

```text
identityKey = protocolIdentityKey
canonicalIdentityKey(identityKey) = protocolIdentityKey
```

For a linked external identity:

```text
identityKey = externalIdentityKey
canonicalIdentityKey(externalIdentityKey) = protocolIdentityKey
```

For an off-platform recipient who has not joined:

```text
identityKey = externalIdentityKey
canonicalIdentityKey(externalIdentityKey) = externalIdentityKey
```

The self-nomination check compares canonical forms:

```text
canonical(giverProtocolIdentityKey) != canonical(recipientIdentityKey)
```

This prevents a user from nominating their own X account after it has been linked onchain. It also preserves the ability to nominate an external X account that has never joined.

## What Identifier Does The Contract Use For The Giver?

The giver is always a registered `protocolIdentityKey`. The transaction sender must be an authorized wallet for that protocol identity.

## What Identifier Does The Contract Use For An Off-Platform Recipient?

The recipient can be an `externalIdentityKey`. The nominee does not need a wallet, a Privy user, or a TAKE account.

## How Are Provider Identities Bound To TAKE Identities?

The backend verifies provider account ownership through Privy. After verification, it writes the database link and, when needed for contract-level self-nomination prevention, submits or prepares an `registerIdentityAlias(protocolIdentityKey, externalIdentityKey)` transaction.

Alias registration is append-only onchain. Reassignment is not allowed in v0.

## Authenticated Profile Hydration

The browser sends only the Privy access token as a bearer credential. TAKE does not trust provider IDs, usernames, profile pictures, or wallet addresses supplied as request data.

For each authenticated request, the API:

1. verifies the access token with the installed Privy Node SDK;
2. reads the verified Privy DID from the verification result;
3. fetches the current Privy user server-side with that DID;
4. reconciles linked accounts and EVM wallets by immutable provider identifier;
5. resolves one stable `TakeIdentity`;
6. returns a normalized TAKE profile from `GET /me`.

Identity tokens are not required by this implementation because the backend already fetches the verified user object server-side. If TAKE later switches to identity-token hydration, the Privy dashboard's **Return user data in an identity token** setting must be enabled and the token must be verified with the official server SDK. Client-decoded claims must never become authoritative.

## Frontend Identity Source

Privy's client `user` object controls authentication and account-linking flows. TAKE's normalized `GET /me` response controls product identity in the navbar, profile, history, and account settings.

Presentation priority is:

1. X name, username, and profile picture;
2. Farcaster display name, username, and profile picture;
3. GitHub name and username;
4. Discord username;
5. email prefix for display name only;
6. neutral `TAKE member` display fallback.

TAKE never fabricates an `@handle`. Remote avatar failures use a deterministic local fallback.

`GET /me` returns:

- `user`: stable TAKE user and identity IDs plus presentation metadata;
- `socials`: normalized X, Discord, Farcaster, and GitHub connection state;
- `wallets`: connected EVM wallet metadata, with embedded and primary state;
- `takes`: confirmed given and received counts.

OAuth tokens, provider secrets, and Discord email are never included.

## Multiple Social Accounts

One `TakeIdentity` may have multiple `SocialAccount` and `ExternalIdentity` records. Each linked provider identity receives its own alias to the same protocol identity.

## Username Changes

Usernames are display metadata only. A username change updates `currentUsername` and `lastObservedAt`; it never changes `externalIdentityKey` or historical nominations.

## X Account Disconnection

Disconnecting an X account from the current login surface marks the database `SocialAccount` as inactive. It does not delete historical nominations or remove onchain aliases. Removing aliases would rewrite the meaning of past self-nomination checks and is not supported in v0.

## Nominated Before Joining

If Sarah receives TAKEs as an external X identity before joining, those nominations reference `externalIdentityKey`. When Sarah signs in with that X account, the backend links the existing `ExternalIdentity` to her `TakeIdentity` and registers the alias onchain. Historical nominations remain attached to the external key and are displayed as Sarah's received TAKE history through the database and indexer join.

## Duplicate External Records

The database enforces uniqueness on `(provider, immutableProviderUserId)` and on `externalIdentityKey`. If duplicate records appear due to legacy import or migration errors, the merge must be an audited administrative operation that preserves all nomination references.

## Future Providers

Providers are namespaced. Farcaster can use `provider = farcaster` and immutable id `fid`. The protocol identity remains provider-neutral.

## Tradeoff

This design keeps TAKE identity independent of Twitter while still allowing off-platform nomination. The privacy limitation is real: public nomination mode emits identity keys that may be linkable if provider IDs are known. Protected nomination mode later needs a different cryptographic layer, not just hashed public identifiers.
