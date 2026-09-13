DROP INDEX IF EXISTS campaigns_chain_onchain_idx;

CREATE UNIQUE INDEX campaigns_chain_manager_onchain_idx
  ON campaigns(chain_id, manager_contract_address, onchain_campaign_id);
