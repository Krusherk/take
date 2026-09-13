# TAKE Mechanism V1 Threat Model

## Assets To Protect

- One TAKE per eligible canonical identity.
- Correct nominator and recipient eligibility sets.
- Immutable campaign rules and resource quantity.
- Complete finalized nomination input.
- Unbiased tie randomness.
- Reproducible allocation results.
- Historical nominations when an external recipient later joins.
- Restricted social, guild, and wallet evidence.

## Trust Boundaries

| Boundary | Trusted for | Not trusted for |
|---|---|---|
| Privy | Authenticated user and verified linked-account bindings | One-human uniqueness |
| TAKE API | Policy authorization, evidence orchestration, artifact publication | Replacing onchain events |
| Postgres | Versioned derived state and audit records | Proving an event occurred on Monad by itself |
| Monad manager | Campaign lifecycle, TAKE limit, self-nomination, public events, final commitment | V1 registrar assurance, hidden nominations, randomness verification |
| QuickNode RPC | Transporting canonical block and log data | Product identity or eligibility judgments |
| X and Discord APIs | Provider-specific facts at observation time | General personhood or social worth |
| drand evmnet | Public unpredictable randomness after the committed round | Correct nomination input or policy |

## Attacks And Controls

| Attack | Current control | Residual risk |
|---|---|---|
| Duplicate Privy login | Unique Privy user and provider-subject bindings | Multiple independently acquired social accounts |
| Mutable username evasion | Immutable provider subject is the binding key | Provider account transfer or compromise |
| External nominee duplication | External subject reconciles to the joining TAKE identity | Open external populations have lower assurance |
| Self nomination through alias | Canonical identity resolution and contract check | Legacy alias registration is self-asserted |
| Direct reciprocity | API precheck and deterministic reject-later indexing rule | Direct RPC can submit the later edge before indexing catches it |
| Short cycles and coalitions | Versioned signals and review cases | Legitimate dense communities can resemble coordination |
| Graph false positive | Signals never affect allocation in V1 | Reviewers still require careful restricted evidence handling |
| Provider outage | `UNKNOWN` blocks snapshot lock | Campaign preparation may be delayed |
| Stale evidence | Explicit cutoff and timestamps in immutable observations | Connection intervals are not fully reconstructed in V1 |
| Forged client identity | Server fetches verified Privy user and server-issued external identity IDs | Compromised upstream provider account |
| Forged Merkle proof | Contract verification and server proof construction | Legacy recipient semantics are weaker than V2 design |
| Direct-chain nomination | Canonical log indexer ingests API and non-API transactions | Indexer lag before finalized projection |
| Chain reorg | Confirmation depth, block hashes, rewind, orphan status | Reorg deeper than configured lookback requires operator intervention |
| Randomness substitution | Pinned evmnet chain, round, public key, client verification, two-relay agreement | Relay availability can delay allocation; no fallback round is allowed |
| Allocation replay/substitution | Complete input artifact, deterministic engine, unique replay key, result commitment | Legacy campaigns use a deterministic low-assurance seed |
| Allowlist enumeration | Current-user proof endpoint only; external proofs are issued during nomination preparation | Rate limits and access logs still require monitoring |

## Explicit Non-Claims

TAKE Mechanism V1 does not prove one human per identity. It is not described as Sybil-resistant on the legacy contract. It does not infer friendship from follower counts, punish community density, use wealth as legitimacy, or claim complete wallet history from the configured RPC.

Protected assurance depends on a future V2 registrar and wallet lifecycle, closed populations, credible provider evidence, canonical indexing, and a successful adversarial simulation report.
