#!/usr/bin/env bash
set -euo pipefail

if [[ ! -f .env ]]; then
  echo ".env is required" >&2
  exit 1
fi

set -a
source .env
set +a

if [[ -z "${TAKE_CAMPAIGN_MANAGER_ADDRESS:-}" ]]; then
  echo "TAKE_CAMPAIGN_MANAGER_ADDRESS is required" >&2
  exit 1
fi

forge script packages/contracts/script/CreateDemoCampaign.s.sol \
  --root packages/contracts \
  --rpc-url "$MONAD_TESTNET_RPC_URL" \
  --private-key "$DEPLOYER_PRIVATE_KEY" \
  --broadcast
