# Security Model

## Authentication

- Verify Privy access tokens server-side with `@privy-io/node`.
- Accept tokens from `Authorization: Bearer`.
- Never trust client-submitted Privy user ids, wallet addresses, Twitter ids, or TAKE identity ids.

## Authorization

- Organization actions require server-side membership checks.
- Roles are `OWNER`, `ADMIN`, `MEMBER`.
- Only `OWNER` and `ADMIN` can publish, close, run allocation, finalize, or export.

## Database

- Use foreign keys and unique constraints.
- Enforce unique Privy users, social accounts, wallet addresses, external identity keys, onchain event identities, and idempotency keys.
- Never overwrite allocation runs.
- Do not expose complete eligibility populations or identity-level graph evidence through public routes.
- The proof route returns only the authenticated identity; external recipient proof resolution stays inside nomination preparation.

## Contract

- Enforce nomination limits.
- Enforce self-nomination rejection using canonical identity aliases.
- Enforce active time window.
- Enforce organizer-only mutations.
- Enforce immutable final result hash.

## Sponsorship

Privy app-pays sponsorship currently lists Monad and Monad Testnet as supported. TAKE must still restrict sponsorship to:

- approved chain id;
- approved `TakeCampaignManager` address;
- approved function selector;
- authenticated TAKE identity;
- campaign-specific rate limits;
- one pending nomination transaction per identity/campaign unless explicitly retried by idempotency.

No arbitrary sponsored transactions.

## QuickNode

- Store endpoint URLs/tokens only in environment variables.
- Prefer server-side RPC use. Do not expose privileged QuickNode endpoints to browsers.
- Use QuickNode token/header auth, rate limiting, and referrer controls where applicable.

## Mechanism Evidence

- Treat `UNKNOWN` provider evidence as an operational blocker, not an ineligibility result.
- Restrict raw Discord guild and wallet evidence to organization owners/admins.
- Never persist provider access tokens in evidence observations.
- Graph correlations open review cases but never change support or allocation in V1.
- Protected campaigns are hard-disabled until a separately approved V2 manager exists.

## Logging

Log structured request ids, campaign ids, identity ids, tx hashes, state transitions, and reconciliation status. Do not log bearer tokens, Privy secrets, QuickNode secrets, private keys, or raw OAuth credentials.
