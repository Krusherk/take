# Randomness And Allocation

## Canonical Input

Allocation consumes `nomination_edges`, not API intent rows. Edges must be finalized, chain ordered, and frozen with raw and canonical identity resolution. Every invalid edge records an objective reason.

The input hash commits to campaign, strategy, resource quantity, and every ordered edge. The result hash commits to the input hash, seed, strategy, seat count, ranking, selected set, tie breakers, and explanations.

## Strategies

- `RAW_TOP_K@1`: distinct canonical-giver support, with seeded cutoff tie order.
- `RAW_UNIQUE_SUPPORT@2`: corrected recommended strategy; aliases merge before distinct support is counted.
- `THRESHOLD_UNIFORM_LOTTERY@1`: experimental uniform sample above a fixed support threshold.
- `LINEAR_PPS_WITHOUT_REPLACEMENT@1`: experimental sequential weighted sample with fixed distinct-support weights.

Graph signals are never passed to a strategy. Manual review decisions have no allocation effect in V1.

## drand Commitment

Protected allocation is designed for drand `evmnet`, pinned to chain hash:

```text
04f1e9062b8a81f848fded9c12306733282b2727ecced50032187751166ec8c3
```

The committed round is the first round at or after `campaign.endTime + 600 seconds`. TAKE never substitutes a later or fallback round.

Retrieval:

1. Query every configured HTTPS relay for the committed round.
2. Verify chain hash, public key, period, genesis time, round, and BLS beacon through `drand-client`.
3. Require two relays to agree on round, randomness, and signature.
4. Persist relay outcomes, signature, chain info, verification time, and artifact hash.
5. Domain-separate that randomness with campaign, deployment, rules, and input hashes to derive the allocation seed.

Legacy campaigns without a randomness commitment use a clearly labeled deterministic low-assurance seed. They must not be described as protected.

Official references: [drand developer docs](https://docs.drand.love/developer/) and [drand protocol specification](https://docs.drand.love/docs/specification/).

## Replay

```bash
pnpm mechanism:simulate -- --runs 10000 --output docs/mechanism-v1-simulation-ci.json
pnpm mechanism:report -- --output docs/mechanism-v1-simulation-release.json
```

Add `--persist` with `DATABASE_URL` to store a run and its report hash. Add `--campaign <uuid>` to bind it to the campaign's selected mechanism revision.
