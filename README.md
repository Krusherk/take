# TAKE

TAKE is a social allocation system for scarce opportunities. A campaign gives each eligible participant a limited number of nominations, called TAKEs, and the community helps decide who should receive the resource.

The repository includes the protocol, API, and indexer.

## Stack

- TypeScript
- Fastify API
- PostgreSQL
- Drizzle ORM
- Foundry / Solidity
- viem
- Monad
- Privy
- QuickNode

## Repository Layout

```text
apps/api              API server and backend services
packages/shared       Domain types, schemas, hashes, constants
packages/mechanism    Pure eligibility, graph, Merkle, randomness, allocation
packages/mechanism-simulator  Deterministic adversarial simulation and reports
packages/database     Drizzle schema, migrations, seed data
packages/chain        Monad/QuickNode viem configuration
packages/contracts    Foundry smart contracts and tests
docs                  Architecture and operating documents
scripts               Local utility scripts
```

## Local Development

1. Copy environment values:

   ```bash
   cp .env.example .env
   ```

2. Install dependencies:

   ```bash
   pnpm install
   ```

3. Start Postgres:

   ```bash
   docker-compose up -d postgres
   ```

4. Generate and apply database migrations:

   ```bash
   pnpm db:generate
   pnpm db:migrate
   ```

5. Seed deterministic demo data:

   ```bash
   pnpm db:seed
   ```

6. Run API tests:

   ```bash
   pnpm test
   ```

7. Run contract tests:

   ```bash
   pnpm contracts:test
   ```

8. Deploy to Monad testnet after funding `DEPLOYER_ADDRESS`:

   ```bash
   bash scripts/deploy-monad-testnet.sh
   ```

9. Start the API:

   ```bash
   pnpm dev:api
   ```

## Current Documentation Baseline

Read these before changing integrations:

- [Architecture](docs/architecture.md)
- [Identity](docs/identity.md)
- [Source of Truth](docs/source-of-truth.md)
- [State Machine](docs/state-machine.md)
- [Transactions](docs/transactions.md)
- [Indexing](docs/indexing.md)
- [Security](docs/security.md)
- [Deployment](docs/deployment.md)
- [Mechanism Constitution](docs/mechanism-constitution.md)
- [Mechanism V1](docs/mechanism-v1.md)
- [Evidence and Eligibility](docs/evidence-and-eligibility.md)
- [Discord Evidence](docs/discord-evidence.md)
- [Randomness and Allocation](docs/randomness-and-allocation.md)
- [Mechanism Operations](docs/mechanism-operations.md)
- [Mechanism Simulation Report](docs/mechanism-simulation.md)
- [Threat Model](docs/threat-model.md)

## Important Limitations

- Public nomination mode is public. Anyone reading Monad events can reconstruct `giver -> recipient` edges.
- V0 uses a small QuickNode-backed Postgres indexer instead of Envio HyperIndex because Envio subscription/API-token access is not available right now.
- TAKE does not use Sybil scores or graph weights. Mechanism V1 records review-only graph signals and explicitly avoids claiming human uniqueness.
- Existing Monad testnet campaigns remain `LEGACY_V1`. Protected/mainnet campaigns require a separately approved V2 manager and are currently blocked.
- Monad documentation currently recommends Foundry v1.8+ with the Monad execution network enabled. Local Foundry has been upgraded to v1.8.1 for contract work.
- Real Privy auth uses Privy's app JWKS via the `@privy-io/node` SDK. `PRIVY_VERIFICATION_KEY` is optional if an environment needs to pin a specific public verification key.
