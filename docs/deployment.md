# Deployment

## Vercel frontend (existing Fastify API + worker)

Import `Krusherk/take`, select the `main` production branch, and leave the
project Root Directory at the repository root. The root `vercel.json` builds
only `@take/web`, serves `apps/web/dist`, supports direct SPA links such as
`/operator`, and caches fingerprinted JS/CSS/fonts. Home's design is unchanged.
Use Node.js 22 (22.12 or newer) and the pnpm version pinned in `package.json`;
enable Vercel Corepack support with `ENABLE_EXPERIMENTAL_COREPACK=1` if needed.
Do not override the build with the root full-workspace build or a seed command.

Set frontend environment variables in Vercel before building:

- `VITE_API_BASE_URL`: the public HTTPS URL of the existing Fastify API, no trailing slash.
  Vercel builds reject missing/localhost HTTP targets so a published app cannot
  silently call each visitor's local computer.
- `VITE_PRIVY_APP_ID`: the existing public Privy app ID.
- `VITE_MONAD_TESTNET_RPC_URL`: a browser-safe Monad RPC endpoint. This value is
  public in the built JavaScript; never put a private QuickNode credential here.
  Leave unset to use the application's public Monad Testnet fallback.
- `VITE_PRIVY_SPONSOR_TRANSACTIONS=false`: sponsorship is not available.
- `VITE_ENABLE_DEV_FIXTURES=false`.

Deploy the Fastify API as a separate Vercel project (settings below), or keep it
on an always-running Node host. The continuous indexer/reconcilers still need
an always-running Node host. This is not a backend rewrite: Vercel's static
frontend deployment does not start `apps/api/src/worker.ts`. Do not wrap its
infinite polling loop in a Vercel Function or replace it with an unverified cron.
The API and worker must both use the same Supabase `DATABASE_URL`, manager
address, chain, and private QuickNode RPC configuration. Preserve the canonical
cursor; never reset it during deployment. Keep `DATABASE_MIGRATION_URL` only
in the migration/admin environment. Never run migration or seed scripts as part
of the frontend build.

On the backend, set `NODE_ENV=production`, `ENABLE_DEV_FIXTURES=false`,
`INTERNAL_API_TOKEN`, and `WEB_ORIGIN` to the exact production frontend origin.
Configure the same frontend origin in Privy's allowed origins/redirect settings.
Choose a backend region near the Supabase database to avoid unnecessary database
round trips. No API keys, database credentials, Privy secrets, or wallet keys
belong in `VITE_*` variables or Git.

Before sharing the deployment, verify direct-route refreshes, X login, API CORS,
the authority wallet connection, and advancing worker/canonical event state.
Private authenticated responses must not be CDN-cached. An exposed QuickNode
token is revoked in QuickNode, not by changing a Vercel environment variable.

### Separate API project on Vercel

- Branch: `main`.
- Root Directory: `apps/api` (not the repository root).
- Enable **Include source files outside of the Root Directory** for the shared
  workspace packages.
- Framework: **Fastify**; remove any dashboard Vite build/output overrides.
- Build Command: `pnpm -r --filter '@take/api...' build` (also set in
  `apps/api/vercel.json`). This builds only the API and its shared dependencies.
- Output Directory: leave unset; do not set `apps/web/dist` or `dist`.
- `server.mjs` starts the existing compiled server; it prevents detection of
  `src/app.ts`, which only exports the application factory.
- Use the same Node/Corepack settings as the frontend project.

Configure server-only `DATABASE_URL`, `PRIVY_APP_ID`, `PRIVY_APP_SECRET`,
`INTERNAL_API_TOKEN`, `WEB_ORIGIN`, `TAKE_OPERATOR_PRIVY_USER_IDS`,
`MONAD_NETWORK`, `MONAD_TESTNET_RPC_URL`, and `TAKE_CAMPAIGN_MANAGER_ADDRESS`
in the API project. Keep `ENABLE_DEV_FIXTURES=false` and `NODE_ENV=production`.
Use the existing Supabase Session pooler URL and existing API credentials, not
new identities or seed data. The worker uses the same database and chain config
on its own host; a successful API deployment does not mean the worker is running.

Deploy the API first. Then put its HTTPS URL in the frontend's
`VITE_API_BASE_URL` and redeploy the frontend. `WEB_ORIGIN` and Privy's allowed
origins must match the frontend domain. Preview-domain access requires its own
matching configuration; do not disable authentication or broadly allow origins.

## External Dashboard Setup

### Privy

Required:

- App ID
- App secret
- Access-token verification through Privy's app JWKS. The `@privy-io/node` SDK derives the app JWKS URL from the app ID; `PRIVY_VERIFICATION_KEY` is only needed as an optional override.
- Twitter/X login enabled
- Embedded EVM wallets enabled
- Monad and Monad Testnet configured as supported chains
- Gas sponsorship enabled only after TAKE sponsorship policy is implemented

### QuickNode

Required:

- Monad Testnet endpoint
- Monad Mainnet endpoint before production
- Endpoint token auth enabled
- Separate tokens per environment where plan permits
- Method/rate limits where plan permits

### Indexing

V0 uses the TAKE API's QuickNode-backed indexer worker. Configure:

- `TAKE_CAMPAIGN_MANAGER_ADDRESS`
- `TAKE_CAMPAIGN_MANAGER_START_BLOCK`
- `CHAIN_INDEXER_CONFIRMATIONS`
- `CHAIN_INDEXER_MAX_BLOCK_RANGE`
- `INTERNAL_API_TOKEN` for production access to worker controls

## Environment Variables

See `.env.example`.

## Contract Deployment

Monad docs recommend Foundry v1.8+ with Monad execution network enabled. Upgrade before Monad-faithful local tests/deployment.

Local:

```bash
cd packages/contracts
forge test
```

Monad testnet:

```bash
bash scripts/deploy-monad-testnet.sh
```

Do not commit deployment private keys or RPC secrets.
