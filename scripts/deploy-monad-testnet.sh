#!/usr/bin/env bash
set -euo pipefail

if [[ ! -f .env ]]; then
  echo ".env is required" >&2
  exit 1
fi

set -a
source .env
set +a

if [[ -z "${MONAD_TESTNET_RPC_URL:-}" ]]; then
  echo "MONAD_TESTNET_RPC_URL is required" >&2
  exit 1
fi

if [[ -z "${DEPLOYER_PRIVATE_KEY:-}" ]]; then
  echo "DEPLOYER_PRIVATE_KEY is required" >&2
  exit 1
fi

deployer_address="${DEPLOYER_ADDRESS:-$(cast wallet address --private-key "$DEPLOYER_PRIVATE_KEY")}"
balance="$(cast balance "$deployer_address" --rpc-url "$MONAD_TESTNET_RPC_URL")"

if [[ "$balance" == "0" ]]; then
  echo "Deployer $deployer_address has zero MON on Monad testnet. Fund it before deploying." >&2
  exit 1
fi

output="$(
  forge script packages/contracts/script/DeployTakeCampaignManager.s.sol \
    --root packages/contracts \
    --rpc-url "$MONAD_TESTNET_RPC_URL" \
    --private-key "$DEPLOYER_PRIVATE_KEY" \
    --broadcast
)"

echo "$output"

broadcast_json="packages/contracts/broadcast/DeployTakeCampaignManager.s.sol/10143/run-latest.json"
contract_address="$(jq -r '.returns.manager.value // empty' "$broadcast_json")"
start_block_hex="$(jq -r '.receipts[0].blockNumber // empty' "$broadcast_json")"
start_block="$(node -e 'console.log(BigInt(process.argv[1]).toString())' "$start_block_hex")"

if [[ -z "$contract_address" || -z "$start_block" ]]; then
  echo "Could not determine deployed contract address from forge output." >&2
  exit 1
fi

node -e '
const fs = require("fs");
const [address, startBlock] = process.argv.slice(1);
let env = fs.readFileSync(".env", "utf8");
function upsert(key, value) {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  env = pattern.test(env) ? env.replace(pattern, line) : `${env.trimEnd()}\n${line}\n`;
}
upsert("TAKE_CAMPAIGN_MANAGER_ADDRESS", address);
upsert("TAKE_CAMPAIGN_MANAGER_START_BLOCK", startBlock);
fs.writeFileSync(".env", env, { mode: 0o600 });
' "$contract_address" "$start_block"

echo "TAKE_CAMPAIGN_MANAGER_ADDRESS=$contract_address"
echo "TAKE_CAMPAIGN_MANAGER_START_BLOCK=$start_block"
