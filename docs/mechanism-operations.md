# Mechanism Operations

## Before A Campaign

1. Confirm the campaign is still `DRAFT` and its resource quantity is final.
2. Create a versioned mechanism draft.
3. Confirm every requested provider is configured and healthy.
4. For Discord rules, install the TAKE bot into the exact organizer guild.
5. Lock organizer allowlists before using them as candidate populations.
6. Build nominator and recipient evidence snapshots.
7. Resolve all `UNKNOWN` outcomes. Never relabel an outage as participant failure.
8. Confirm candidate counts, eligible counts, roots, cutoff, and disjoint-population validation.
9. Lock the mechanism, then verify the config hash and `rulesHash` before publication.

## During A Campaign

- Keep the canonical indexer within operational lag.
- Monitor provider and indexer errors without refreshing locked evidence.
- Do not expose live aggregate rankings.
- Treat API nomination rows as transaction lifecycle state; finalized `nomination_edges` are the graph source.

## Closing And Allocation

1. Close the campaign on the campaign's persisted manager address.
2. Catch the indexer up through the configured finalized head.
3. Verify there are no unresolved deep-reorg conditions.
4. Generate the graph snapshot. Review signals are audit-only.
5. After the exact committed time, retrieve and verify the exact drand round.
6. Run allocation as an organization owner/admin. Seat count comes from the locked resource.
7. Independently replay the input and result hashes.
8. Prepare and submit the final result commitment to the same campaign manager.

## Internal Jobs

Internal endpoints require `INTERNAL_API_TOKEN` in production:

- `POST /internal/indexer/run-once`
- `POST /internal/indexer/catch-up`
- `POST /internal/campaigns/:id/graph/analyze`
- `POST /internal/campaigns/:id/randomness/retrieve`

The RPC currently limits `eth_getLogs` to 1,000 blocks, so catch-up intentionally runs in bounded repeated windows.

## Incident Rules

- Provider outage before lock: leave evidence `UNKNOWN`, fix provider health, rebuild.
- Indexer reorg inside lookback: orphan affected records, rewind, replay canonical blocks.
- Reorg deeper than lookback: stop snapshot/allocation work and perform an operator-reviewed rewind.
- drand relay failure or disagreement: do not allocate; retry the same committed round.
- Allocation failure: preserve the failed record; rerun from the same immutable input only after diagnosing it.
- Post-finalization finding: append a linked review record. Never rewrite the finalized allocation.

## Environment

See `.env.example` for X, Discord, indexer, evidence concurrency, and drand settings. Provider credentials, RPC credentials, Privy secrets, state-signing secrets, and private keys must remain deployment secrets and must never enter evidence payloads or logs.
