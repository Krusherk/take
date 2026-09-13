# TAKE Architecture

## Objective

TAKE supports real campaigns while layering versioned, replayable mechanism evidence around the immutable deployment:

1. organizer creates a campaign draft;
2. organizer publishes immutable campaign rules;
3. participant authenticates with Privy;
4. backend resolves the participant to a TAKE identity;
5. participant nominates another person;
6. nomination is recorded on Monad;
7. the QuickNode-backed indexer stores the event graph;
8. off-platform recipients can later join and claim their history;
9. campaign closes;
10. eligibility snapshots and the canonical nomination graph feed a versioned allocation;
11. final result commitment is recorded onchain.

The architecture optimizes for correctness, auditability, and mechanism replay, not for speculative adversarial scoring.

## Official Docs Checked

- Monad docs index, network information, deployment summary, differences, transactions, and Foundry deployment guide.
- Privy docs index, Node SDK setup, access-token verification, embedded wallets, EVM network config, wallet usage, linked accounts, user object, and gas sponsorship.
- Envio docs were reviewed, but v0 does not use Envio because subscription/API-token access is unavailable.
- QuickNode docs index, Monad RPC, Monad quickstart, and endpoint security.

## External-Docs Notes

- Monad mainnet chain id is `143`; Monad testnet chain id is `10143`.
- Monad supports Ethereum-compatible transaction formats, with transaction types `0`, `1`, `2`, and `4`; type `3` is not supported.
- Monad docs recommend Foundry v1.8+ with the Monad execution network enabled.
- Monad gas accounting charges by gas limit, not actual gas used. TAKE should keep transaction gas limits tight and avoid sloppy sponsorship.
- Privy Node SDK package is `@privy-io/node`.
- Privy access tokens must be verified server-side; the token can arrive via `Authorization: Bearer` or `privy-token` cookie depending on session mode.
- Privy embedded wallets support EVM-compatible chains, and Monad can be configured through viem chain definitions or custom `defineChain`.
- Privy gas sponsorship currently lists Monad and Monad Testnet under app-pays sponsorship. TAKE still needs policy restrictions before enabling sponsorship.
- V0 replaces Envio with a small Postgres-backed log indexer over QuickNode RPC.
- QuickNode supports Monad mainnet and testnet HTTP/WSS endpoints, both with chain ids matching Monad docs.
- QuickNode endpoint security supports token auth, header auth with `x-token`, referrer whitelisting, JWT auth on higher plans, multiple tokens, and rate limits.

## System Shape

```text
Privy auth/wallets
      |
      v
TAKE API -------- PostgreSQL
   |                    |
   |                    v
   |             allocation runs, audits,
   |             identities, drafts, tx lifecycle
   |
   v
QuickNode RPC ---> Monad TakeCampaignManager
                         |
                         v
                   canonical events
                         |
                         v
                    QuickNode log scanner
                         |
                         v
                   GraphQL derived views
```

## Package Boundaries

- `apps/api`: HTTP routes, auth plugin, services, reconciliation workers, structured logging.
- `packages/shared`: transport schemas, common enums, and identity-key helpers.
- `packages/mechanism`: pure versioned evidence, eligibility, Merkle, graph, randomness, and allocation domain.
- `packages/mechanism-simulator`: deterministic honest/adversarial simulation and kill reports.
- `packages/database`: Drizzle schema, migrations, query helpers, deterministic seed data.
- `packages/chain`: Monad chain definitions, viem clients, contract ABI/address config, receipt helpers.
- `packages/contracts`: `TakeCampaignManager` Solidity contract, deployment script, Foundry tests.
- API worker: QuickNode log scanning, raw chain event storage, projected campaign/nomination views.

## Deployment And Mechanism Modes

- Nomination visibility: `PUBLIC`.
- Nominator eligibility: `OPEN_REGISTERED` and `MERKLE_ALLOWLIST` shape, with v0 default open registered.
- Recipient eligibility: `EXTERNAL_ALLOWED` and Merkle-restricted shape, with v0 default external allowed.
- Existing testnet campaigns: immutable `LEGACY_V1`, explicitly low assurance.
- New versioned mechanism: `TAKE_MECHANISM_V1` with separate policies and artifact hashes.
- Recommended allocation: `RAW_UNIQUE_SUPPORT@2`.
- Protected/mainnet: disabled until a separately approved hardened V2 contract exists.

## Deliberate Non-Goals

- No token, points, XP, or transferable reputation.
- No follower, wealth, or wallet-balance weighting.
- No ML Sybil scoring.
- No X graph crawling.
- No graph database.
- No universal escrow.
- No sealed nomination implementation in v0.
