# Source Of Truth

| Data | Canonical Source | Notes |
|---|---|---|
| Campaign draft | Postgres | Editable until publish. |
| Rich campaign metadata | Postgres | Hash/URI commitment goes onchain. |
| Published campaign id | Monad | Emitted and stored by contract. |
| Organizer address for onchain campaign | Monad | Application organization membership controls who may initiate organizer actions. |
| Organization and members | Postgres | Server-enforced auth. |
| Critical campaign rules after publish | Monad | `rulesHash`, eligibility roots, times, limits, modes. |
| Campaign lifecycle after publish | Monad | `CREATED`, `ACTIVE`, `CLOSED`, `FINALIZED`, `CANCELLED`. |
| Application allocating state | Postgres | Transient state only. |
| TAKE identity records | Postgres | Protocol key is mirrored onchain for wallet authorization. |
| Wallet authorization for giving TAKE | Monad | Contract rejects unregistered wallet/identity mismatch. |
| Privy user mapping | Postgres | Privy is auth provider, not TAKE source of truth. |
| Social account metadata | Postgres | Updated snapshots; mutable display data. |
| External identity key | Postgres and event payloads | Deterministic key from provider namespace + immutable provider id. |
| Public nomination event | Monad | Canonical proof a TAKE was given. |
| Nomination lifecycle before confirmation | Postgres | `PREPARING`, `AWAITING_SIGNATURE`, `SUBMITTED`, `FAILED`. |
| Indexed nomination graph | Postgres chain indexer | Derived from Monad events fetched through QuickNode RPC. |
| Eligibility policy | Versioned Postgres config | Canonical config hash is included in `rulesHash`. |
| Provider evidence | Immutable Postgres observations | Facts include cutoff, provenance, payload hash, and public/restricted classification. |
| Eligibility membership | Locked Postgres snapshot and onchain root | Complete artifact is restricted; root/proof is publicly verifiable. |
| Canonical nomination graph | Finalized `nomination_edges` | Derived from Monad logs, including transactions submitted outside TAKE. |
| Graph signals | Versioned Postgres snapshot | Review evidence only; never allocation weight in V1. |
| Allocation runs and simulations | Postgres | Immutable complete input/result artifacts and simulation reports. |
| Tie randomness | Verified drand artifact | Exact committed evmnet round; two agreeing relays; no fallback round. |
| Official final result commitment | Monad | Points to one result hash. |
| Notifications | Postgres | Product/app state. |
| Fraud/review evidence | Append-only Postgres cases/events/decisions | Manual decisions cannot silently rewrite V1 allocation. |
| RPC transport and log access | QuickNode | Infrastructure only; not application state. |
