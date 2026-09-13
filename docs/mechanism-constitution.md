# TAKE Mechanism Constitution V1

This document states the invariants that implementation, simulation, operations, and review must preserve.

## Product Rule

1. An eligible identity receives exactly one TAKE for a campaign.
2. A TAKE cannot be given to the same canonical identity that owns it.
3. A TAKE can be given only once.
4. The visible action is a person choosing another person. Wallets are authorization infrastructure.

## Three Independent Layers

Eligibility, graph evidence, and allocation are separate domains.

- Eligibility produces a binary membership decision from a published finite rule set.
- Graph analysis records versioned observations and review signals.
- Allocation consumes only finalized valid nomination edges, the published strategy, seat count, and committed randomness.

No graph correlation score changes eligibility, support, rank, or winner probability in V1. A signal can open a review case, but a reviewer cannot silently rewrite an allocation.

## Evidence Rules

- Every decision references immutable evidence observations.
- `PASS`, `FAIL`, and `UNKNOWN` are distinct. Provider failure is not participant failure.
- A required `UNKNOWN` blocks snapshot locking.
- Mutable metadata such as a username never replaces an immutable provider subject.
- Provider secrets, OAuth tokens, Discord email, message content, follower counts, balances, holdings, and wealth are not evidence inputs.
- Public explanations expose rule outcomes, not restricted guild or wallet evidence.

## Campaign Commitments

- Nominator and recipient populations are declared independently.
- Protected campaigns require disjoint, closed populations and `RAW_UNIQUE_SUPPORT@2`.
- `nominationLimit` is fixed at `1` for Mechanism V1.
- `rulesHash` commits to the canonical mechanism config, resource quantity, eligibility snapshot hashes and roots, contract deployment, and randomness commitment.
- A locked revision is immutable. Changes create a new draft revision before publication.

## Allocation Rules

- Support means distinct canonical givers, never raw edge count.
- Aliases resolve before support is counted.
- Input edges are ordered by finalized chain position and committed in full.
- Objective hard-rule violations may invalidate an edge. Correlation signals may not.
- The recommended strategy is `RAW_UNIQUE_SUPPORT@2`; verified drand breaks cutoff ties for a protected deployment.
- Every result has a replayable input hash, result hash, and human-readable explanation.

## Deployment Rule

The existing Monad testnet manager at `0xc3A0178B31D8844455c49988736d51A2336056e5` is immutable and labeled `LEGACY_V1`. Existing campaigns are not migrated or overwritten.

Protected or mainnet campaigns remain disabled until a separately reviewed V2 contract is explicitly approved and deployed. Evidence services, simulations, and audit artifacts do not weaken that gate.
