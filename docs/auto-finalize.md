# Automatic close, allocation and finalization

`GET|POST /internal/cron/finalize` (auth: `Authorization: Bearer <CRON_SECRET or INTERNAL_API_TOKEN>`) runs:

1. One indexer catch-up pass (up to ~18 s).
2. For every published campaign on the configured manager in `CREATED`, `ACTIVE`, `CLOSED` or `ALLOCATING`:
   - **Activate** a campaign the server wallet organizes once its start time passes.
   - **Close** it after its end time. The contract lets any wallet close after `endTime`, so this works for every campaign, including ones the server wallet does not organize.
   - **Allocate** with the locked rules once the committed drand round exists (it waits up to 20 s if the round is about to publish; otherwise it retries on the next run).
   - **Finalize** (`finalizeAllocation`) only when the server wallet is the campaign's onchain organizer. Otherwise it reports `SKIP SERVER_WALLET_NOT_ORGANIZER`, and the organizer finalizes from `/operator`.

Every step is idempotent. Lifecycle intents are unique per campaign and action. The server wallet signs locally, records the transaction hash on the intent in one conditional update (only one run can claim it), and only then broadcasts. A claimed transaction that never reaches Monad is released after 5 minutes. Allocation runs are deduplicated by input and result hashes. Reruns send nothing once a campaign is finalized.

## Who may do what onchain (TakeCampaignManager)

| Function | Who |
|---|---|
| `createCampaign` | anyone; `msg.sender` becomes the campaign's permanent `organizer` |
| `activateCampaign` | anyone, inside the campaign window |
| `closeCampaign` | the organizer at any time; anyone after `endTime` |
| `finalizeAllocation`, `cancelCampaign` | the organizer only |

There are no roles, owner, or organizer transfer. To let the server finalize a campaign, the server wallet must publish it: operators click **Use TAKE server wallet** when signing the publish step (`POST /operator/campaigns/:id/lifecycle/publish/server-sign`).

## Configuration (take-api Vercel project)

- `FINALIZER_PRIVATE_KEY`: the server wallet key (0x + 64 hex). Never logged or returned; `/operator/server-wallet` shows only the address and balance.
- `CRON_SECRET`: Vercel Cron sends it as a bearer token. The project's `vercel.json` schedules a daily run (Hobby plans allow daily crons only).
- `AUTO_FINALIZE_ENABLED=false` turns the campaign steps off (the indexer pass still runs).
- For a 10-minute schedule use `.github/workflows/auto-finalize.yml` (GitHub Actions) with the repository secret `TAKE_CRON_SECRET` (the take-api `CRON_SECRET` value).

Gas (Monad bills the gas limit; the wallet uses estimate × 1.2): close ≈ 41k, finalize ≈ 65k, activate ≈ 42k, publish ≈ 186k gas. At ~102 gwei: ≈ 0.011 MON to close and finalize a campaign, ≈ 0.023 MON more when the server also publishes and activates it (≈ 0.035 MON in total).
