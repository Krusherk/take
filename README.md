<p align="center"><img src="docs/brand/take-logo-1024.png" alt="TAKE" width="160" /></p>

# TAKE

A community hands out a scarce spot (a grant, a beta seat, an event ticket). Each person on the giver list gets one TAKE. They give it to one other person, never themselves. The rules are locked on Monad before anyone gives, and the result is committed on Monad when the campaign is finalized.

- Live app: https://takemetropolis.vercel.app (Monad testnet)
- Live API: https://take-api-sand.vercel.app
- Contract: [`0xc3A0178B31D8844455c49988736d51A2336056e5`](https://testnet.monadvision.com/address/0xc3A0178B31D8844455c49988736d51A2336056e5) (`TakeCampaignManager`, Monad testnet, chain 10143)
- Demo video: `<DEMO VIDEO LINK>` (TODO)
- Pitch video: `<PITCH VIDEO LINK>` (TODO)

## How it works

1. **Sign-ups.** An organizer creates a campaign as a draft and shares its join link. People sign in with X and join as givers (or as recipients, if the organizer allows it). The organizer can remove people. Sign-ups stay open until a deadline or until the organizer presses **Close sign-ups and open**.
2. **Lock and publish.** At close, TAKE locks the giver and recipient lists, writes the rules hash to Monad from the TAKE server wallet (`createCampaign`), and opens nominations (`activateCampaign`). Givers get a notification.
3. **Give.** Each giver has one TAKE. They pick one person from the recipient list and sign `giveTake` from their wallet. The contract rejects a second TAKE, a TAKE to yourself, and anyone not in the locked lists.
4. **Close, allocate, finalize.** A scheduled job runs every 10 minutes (cron-job.org, plus a daily Vercel cron and a GitHub Actions workflow as backups). After the end time it closes the campaign; once the committed drand round is out (about 10 minutes later) it runs the allocation and commits the result hash to Monad (`finalizeAllocation`).
5. **Signal** shows each person who they backed and who backed them.

## Try it

1. Open a campaign's join link on your phone: `https://takemetropolis.vercel.app/join/<code>`. A recipient's share link (`/join/<code>?for=@handle`) shows "Back @handle on TAKE"; you can still give to anyone on the list.
2. Tap **Sign in with X to join**. TAKE creates an embedded wallet for you. Finish the welcome screen.
3. Tap **Join as giver**. TAKE sends your wallet a one-time 0.05 MON top-up from the TAKE server wallet to cover gas.
4. When sign-ups close, nominations open and you get a notification. Open the campaign, pick a recipient and give. The first give asks for two wallet approvals (register identity, then give).
5. Open **Signal** to see who you backed, who got the spot, and any check the team records later.
6. Open **Organize** to create a campaign: the opportunity, sign-ups or fixed lists, the end time, and an optional check ("In 30 days: did they ship?").

Without a join link you can browse **Explore** and open **TAKE Demo** (campaign 4): https://takemetropolis.vercel.app/campaign/30e8b781-9143-4b84-8905-eadf13b92029. It shows the locked rules, who can give, who can receive, and the Monad links. Its lists were set before sign-ups existed, so a new sign-in cannot give there.

## Verify onchain

Contract source is verified on Sourcify (exact match): https://repo.sourcify.dev/10143/0xc3A0178B31D8844455c49988736d51A2336056e5. Deployed in tx [`0xb8e2945d…332e`](https://testnet.monadvision.com/tx/0xb8e2945deda4874bfbc8c40fd28108cdb880dbb82cc458b5d3117dcd0f42332e) (block 59399034). Build settings: solc 0.8.30, optimizer 200 runs, via_ir, EVM prague. `cd packages/contracts && forge test` runs 16 tests.

Campaign 4, "TAKE Demo", is live on the contract above. Nominations end 13 Oct 2026, 10:49 UTC.

| Step | Transaction |
|---|---|
| Publish (rules hash written) | [`0xe13da5ad…a5df`](https://testnet.monadvision.com/tx/0xe13da5adb9cd36ca907cc03054d6494c6ba4d4cf0ae469f5cad9e0b5b6faa5df) |
| Open nominations | [`0x0b237126…4c8f`](https://testnet.monadvision.com/tx/0x0b2371262ba43176ed3a0e721ca724827495a6958ecca9ba1a8bd9d7e3244c8f) |
| A TAKE given | [`0x4ee2c55c…9065`](https://testnet.monadvision.com/tx/0x4ee2c55cf2c1e733ae06133582712fb3e66d8822ffd0d3ec078e075189c09065) |
| Result committed | Not yet. `finalizeAllocation` can run after close, from 13 Oct 2026 10:59 UTC (drand round 21456034). `<FINALIZE TX>` |

Public read endpoints:

- `GET /campaigns`: live and published campaigns
- `GET /campaigns/:id/audit-artifact`: locked config, eligibility roots, randomness commitment
- `GET /campaigns/:id/mechanism`, `/selector-eligibility`, `/experiment-v0`, `/after` (recipients, the scheduled check, and recorded outcomes after finalization)
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
- Sign-ups through a join link, with recipient share links and a deadline; the TAKE server wallet locks, publishes and opens the campaign.
- Gas for givers: a one-time 0.05 MON top-up per identity from the server wallet (daily cap 3 MON).
- Automatic close, allocation and finalization after the end, every 10 minutes.
- Managed campaigns: anyone can draft; a TAKE operator publishes.
- Signal: who you backed and who backed you, with a track from Given → Chosen → Check → Outcome.
- Checks after the TAKE: an organizer can lock a question and a date ("In 30 days: did they ship?") when creating a campaign. It can't be changed or added after publication. After the result is committed and the date arrives, the campaign team (the organizer and TAKE operators) records Yes, No, or Unclear with a note and a link. Signal shows it to everyone.

Not built, or not proven yet:

- No campaign has been finalized on Monad testnet yet (as of 10 Oct 2026). The full flow (sign-ups → publish → give → close → allocate → finalize) has run end to end on a local fork of Monad testnet.
- Campaign 4 must be finalized by its organizer after 13 Oct. It was published before the server wallet, so the scheduled job cannot finalize it.
- People who arrive after sign-ups close cannot give in that campaign. The contract cannot change the lists after publish; the join link offers to notify them about the next campaign.
- Not Sybil-resistant. One TAKE per identity, not per human. Privy links accounts; it does not prove one person.
- Popular people can still win. One-person-one-TAKE does not fix that.
- Gives are public on Monad as soon as they are sent. The app only hides running totals.
- Eligibility evidence: the shipped create form checks the organizer's lists and a connected wallet. X account age, Discord membership, and a GitHub link exist as rules but are not used in a live campaign. Wallet history, social graph, and GitHub activity are not collected.
- Operator integrity checks: mutual TAKEs (the later one is rejected by a published rule), short cycles, and bursts. Coalition, cross-campaign, and timing-sync checks are designed, not implemented.
- Signal has no recorded outcomes yet. No live campaign has a scheduled check; campaign 4 was published before checks were in the create form.
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
