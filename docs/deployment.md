# Deployment

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
