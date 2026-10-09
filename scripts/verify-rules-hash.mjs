// Recompute a campaign's rules hash from TAKE's public API and compare it with Monad.
// Usage: node scripts/verify-rules-hash.mjs [campaignUuid]
// Build first: pnpm --filter @take/shared build && pnpm --filter @take/mechanism build
import { domainHash } from "../packages/mechanism/dist/canonical.js";

const API = process.env.TAKE_API_URL ?? "https://take-api-sand.vercel.app";
const RPC = process.env.MONAD_RPC_URL ?? "https://testnet-rpc.monad.xyz";
const campaignId = process.argv[2] ?? "30e8b781-9143-4b84-8905-eadf13b92029";

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json();
}

const artifact = await getJson(`${API}/campaigns/${campaignId}/audit-artifact`);
const selector = await fetch(`${API}/campaigns/${campaignId}/selector-eligibility`).then((r) => (r.ok ? r.json() : null));
const config = artifact.mechanism.config;
const nominator = artifact.eligibilitySnapshots.find((item) => item.subject === "NOMINATOR");
const recipient = artifact.eligibilitySnapshots.find((item) => item.subject === "RECIPIENT");

const configHash = domainHash("TAKE_MECHANISM_CONFIG_V1", config);
const rulesHash = domainHash("TAKE_CAMPAIGN_RULES_V1", {
  configHash: artifact.mechanism.configHash,
  resourceQuantity: config.resourceQuantity,
  nominatorSnapshot: { hash: nominator.snapshotHash, root: nominator.root },
  recipientSnapshot: { hash: recipient.snapshotHash, root: recipient.root },
  contract: config.contract,
  randomness: config.randomness,
  selectorEligibilityPolicyHash: selector?.policyHash ?? null,
  experimentProtocolHash: artifact.experiment?.protocolHash ?? null,
});

// campaigns(uint256) on TakeCampaignManager; rulesHash is the 12th 32-byte word.
const data = `0x141961bc${BigInt(artifact.campaign.onchainCampaignId).toString(16).padStart(64, "0")}`;
const rpc = await fetch(RPC, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: artifact.campaign.managerAddress, data }, "latest"] }),
}).then((r) => r.json());
const onchainRulesHash = `0x${rpc.result.slice(2 + 64 * 11, 2 + 64 * 12)}`;

console.log(`campaign            ${campaignId} (onchain #${artifact.campaign.onchainCampaignId})`);
console.log(`manager             ${artifact.campaign.managerAddress}`);
console.log(`configHash          ${configHash} ${configHash === artifact.mechanism.configHash ? "matches API" : "DOES NOT MATCH API"}`);
console.log(`rulesHash (rebuilt) ${rulesHash}`);
console.log(`rulesHash (Monad)   ${onchainRulesHash}`);
console.log(rulesHash === onchainRulesHash ? "MATCH: the rules on Monad are the rules in the public artifact." : "MISMATCH");
process.exitCode = rulesHash === onchainRulesHash ? 0 : 1;
