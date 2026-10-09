<p align="center"><img src="docs/brand/take-logo-1024.png" alt="TAKE" width="160" /></p>

# TAKE

A community hands out a scarce spot (a grant, a beta seat, an event ticket). Each person on the giver list gets one TAKE. They give it to one other person, never themselves. The rules are locked on Monad before anyone gives, and the result is committed on Monad when the campaign is finalized.

- Live app: https://takemetropolis.vercel.app (Monad testnet)
- Live API: https://take-api-sand.vercel.app
- Contract: [`0xc3A0178B31D8844455c49988736d51A2336056e5`](https://testnet.monadvision.com/address/0xc3A0178B31D8844455c49988736d51A2336056e5) (`TakeCampaignManager`, Monad testnet, chain 10143)
- Demo video: `<DEMO VIDEO LINK>` (TODO)
- Pitch video: `<PITCH VIDEO LINK>` (TODO)

## How it works

1. An organizer creates a campaign: the opportunity, the giver list, the recipient list, and the end time. TAKE locks these rules and writes their hash to Monad (`createCampaign`, then `activateCampaign`).
2. Each person on the giver list gets one TAKE for that campaign.
3. A giver picks one person from the recipient list and signs `giveTake` from their wallet. The contract rejects a second TAKE, a TAKE to yourself, and anyone not in the locked lists.
4. The campaign closes at its end time. The operator runs the allocation and commits the result hash to Monad (`finalizeAllocation`).
5. Signal shows each person who they backed and who backed them.

## Try it

`TODO (infra): fill the placeholders below once the judge campaign and test logins exist.`

1. Open https://takemetropolis.vercel.app on your phone or desktop.
2. Tap **Sign in**, then **Continue with email**. Use `<JUDGE LOGIN 1 EMAIL>` and code `<JUDGE LOGIN 1 CODE>`. Spare logins: `<JUDGE LOGIN 2>`, `<JUDGE LOGIN 3>`.
3. Tap **Enter TAKE** on the welcome screen.
4. Open **Explore** and pick **`<JUDGE CAMPAIGN NAME>`** (campaign `<JUDGE CAMPAIGN ID>`), or go to `https://takemetropolis.vercel.app/campaign/<JUDGE CAMPAIGN UUID>`.
5. Tap **Give your TAKE**, choose a person, and review.
6. Tap **Give to …** and approve the transaction in the wallet prompt. The judge wallets already hold testnet MON for gas. TAKE does not pay gas.
7. Wait for **You gave … your TAKE.** Tap **View receipt** to see the `TakeGiven` event on the explorer.
8. Open **Signal** to see who you backed.

Each login can give one TAKE in the judge campaign. A second attempt is rejected by the contract.

## Verify onchain

Campaign 4, "TAKE Demo", is live on the contract above.

| Step | Transaction |
|---|---|
| Publish (rules hash written) | [`0xe13da5ad…a5df`](https://testnet.monadvision.com/tx/0xe13da5adb9cd36ca907cc03054d6494c6ba4d4cf0ae469f5cad9e0b5b6faa5df) |
| Open nominations | [`0x0b237126…4c8f`](https://testnet.monadvision.com/tx/0x0b2371262ba43176ed3a0e721ca724827495a6958ecca9ba1a8bd9d7e3244c8f) |
| A TAKE given | [`0x4ee2c55c…9065`](https://testnet.monadvision.com/tx/0x4ee2c55cf2c1e733ae06133582712fb3e66d8822ffd0d3ec078e075189c09065) |
| Result committed | `<FINALIZE TX>` (TODO, after close) |

Public read endpoints:

- `GET /campaigns`: live and published campaigns
- `GET /campaigns/:id/audit-artifact`: locked config, eligibility roots, randomness commitment
- `GET /campaigns/:id/mechanism`, `/selector-eligibility`, `/experiment-v0`, `/after`
- `GET /health`: API, database, chain head, indexer lag

Rebuild the rules hash from the public artifact and compare it with the value stored on Monad:

```bash
git clone https://github.com/Krusherk/take && cd take
pnpm install
pnpm verify:rules 30e8b781-9143-4b84-8905-eadf13b92029
```

Expected output ends with `MATCH: the rules on Monad are the rules in the public artifact.` The script ([`scripts/verify-rules-hash.mjs`](scripts/verify-rules-hash.mjs)) reads `/campaigns/:id/audit-artifact` and `/campaigns/:id/selector-eligibility`, rebuilds `configHash` and `rulesHash`, then reads `campaigns(4)` from Monad over public RPC.

## Architecture

- `packages/contracts`: `TakeCampaignManager.sol` (Foundry). Campaigns, Merkle giver and recipient lists, one TAKE per identity, no self-give, result hash.
- `apps/web`: React + Vite. Privy for sign-in (X, email, wallet) and the embedded wallet that signs.
- `apps/api`: Fastify on Vercel. Campaign setup, eligibility snapshots, Merkle proofs, allocation, Signal.
- Postgres (Supabase) through Drizzle (`packages/database`).
- `packages/mechanism`: eligibility rules, Merkle trees, graph checks, allocation, hashing.
- Monad testnet through viem (`packages/chain`). Receipts reconciled from RPC.

## What works / what's not built yet

Works on testnet:

- Rules locked and hashed on Monad before anyone gives; reproducible with `pnpm verify:rules`.
- One TAKE per eligible identity per campaign, no self-give, and Merkle-checked lists, enforced by the contract.
- Sign-in with X, email, or wallet; giving from the Privy embedded wallet.
- Managed campaigns: anyone can draft; a TAKE operator publishes.
- Signal: who you backed and who backed you.

Not built, or not proven yet:

- No campaign has been finalized onchain yet. Allocation and `finalizeAllocation` are built but not yet run on a live campaign.
- Not Sybil-resistant. One TAKE per identity, not per human. Privy links accounts; it does not prove one person.
- Popular people can still win. One-person-one-TAKE does not fix that.
- Gives are public on Monad as soon as they are sent. The app only hides running totals.
- Eligibility evidence: the shipped create form checks the organizer's lists and a connected wallet. X account age, Discord membership, and a GitHub link exist as rules but are not used in a live campaign. Wallet history, social graph, and GitHub activity are not collected.
- Operator integrity checks: mutual TAKEs (the later one is rejected by a published rule), short cycles, and bursts. Coalition, cross-campaign, and timing-sync checks are designed, not implemented.
- Signal has no evaluated outcomes yet.
- Gas is not sponsored. The indexer is behind; new TAKEs are recorded from transaction receipts.
- The allocation rule in use (`RAW_UNIQUE_SUPPORT@2`) is a baseline. Our own simulations ([docs/mechanism-decision-gate-v0.1.md](docs/mechanism-decision-gate-v0.1.md)) did not find a rule good enough for high-stakes campaigns.

## Repo map

```text
apps/web                      React app (takemetropolis.vercel.app)
apps/api                      Fastify API and workers
packages/contracts            Solidity contract and Foundry tests
packages/mechanism            Eligibility, Merkle, graph, allocation, hashing
packages/mechanism-simulator  Adversarial simulations and reports
packages/database             Drizzle schema and migrations
packages/chain                Monad config and transaction builders
packages/shared               Shared types and schemas
scripts                       Deploy and verify scripts
docs                          Design, mechanism, security, brand assets
```

## Run locally

```bash
cp .env.example .env          # fill in Postgres, Privy, Monad RPC
pnpm install
docker-compose up -d postgres
pnpm db:migrate
pnpm dev:api                  # API
pnpm dev:web                  # web app
pnpm test                     # all package tests
pnpm contracts:test           # Foundry tests (needs forge)
```

`pnpm db:seed` loads demo data into a local database only. Never run it against the pilot database.

## More docs

[Architecture](docs/architecture.md) · [Identity](docs/identity.md) · [Evidence and eligibility](docs/evidence-and-eligibility.md) · [Mechanism V1](docs/mechanism-v1.md) · [Randomness and allocation](docs/randomness-and-allocation.md) · [Threat model](docs/threat-model.md) · [Security](docs/security.md) · [Deployment](docs/deployment.md) · [Where we are](docs/where-we-are.md) · [Brand assets](docs/brand/)
