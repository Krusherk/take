# QuickNode-Backed Indexing

TAKE v0 does not use Envio HyperIndex because the project currently cannot rely on an Envio subscription/API token.

Monad remains canonical. QuickNode is RPC transport. Postgres stores derived indexed state.

## Why This Is Acceptable For V0

The first campaigns are expected to involve roughly 30-100 people. A simple cursor-based log indexer over a single `TakeCampaignManager` contract is enough for:

- campaign lifecycle events;
- public nomination edges;
- identity registration events;
- allocation finalization events;
- app reconciliation and notification creation.

This does not preclude moving to Envio, QuickNode Streams, or another indexing layer later.

## Flow

```text
TakeCampaignManager event
  -> QuickNode Monad RPC getLogs
  -> TAKE QuickNodeIndexer worker
  -> chain_events raw event table
  -> projected Postgres rows
  -> TAKE API
```

## Tables

- `chain_indexer_cursors`: one cursor per chain/contract.
- `chain_events`: raw deduped contract logs.
- `campaigns`: projected lifecycle and final result data.
- `nominations`: API transaction-intent and reconciliation lifecycle data.
- `nomination_edges`: canonical finalized graph edges, including direct onchain calls outside the API.

## Deduplication

`chain_events` enforces uniqueness on:

```text
chainId + transactionHash + logIndex
```

`nomination_edges` additionally keys by chain, manager address, transaction hash, and log index. Campaign identity includes manager address/version so deployments can coexist.

## Lag Handling

The app still distinguishes:

- `SUBMITTED`: transaction hash known.
- `CHAIN_CONFIRMED`: receipt confirmed on Monad.
- `INDEXING_DELAYED`: receipt exists, local indexer has not consumed the event yet.
- `CONFIRMED`: local indexer reconciled the event.

## Finality And Reorg Policy

The worker scans only through `latest - CHAIN_INDEXER_CONFIRMATIONS`, records block hash, transaction index, block timestamp, and finality, and stores the finalized cursor block hash. Before each range it verifies that cursor hash against Monad. On mismatch it rewinds by `CHAIN_INDEXER_REORG_LOOKBACK`, marks affected events and edges `ORPHANED`, returns linked nominations to `INDEXING_DELAYED`, and replays canonical blocks.

A reorg deeper than the configured lookback is an operator incident and blocks protected snapshot or allocation work.

The current QuickNode Monad testnet endpoint rejects `eth_getLogs` requests above a 1,000 block range, so `CHAIN_INDEXER_MAX_BLOCK_RANGE` is capped at `1000`.

The worker exposes two internal controls:

- `POST /internal/indexer/run-once`: scan one bounded block window.
- `POST /internal/indexer/catch-up`: scan repeated bounded windows, up to `maxIterations`.

In production, internal controls require `INTERNAL_API_TOKEN`.

## Future Options

- Envio HyperIndex if subscription/API-token constraints change.
- QuickNode Streams if polling becomes insufficient.
- Dedicated worker process if API-embedded indexing becomes operationally awkward.
