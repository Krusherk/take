CREATE TABLE IF NOT EXISTS chain_indexer_cursors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id integer NOT NULL,
  contract_address varchar(42) NOT NULL,
  last_scanned_block bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chain_indexer_cursors_chain_contract_idx UNIQUE (chain_id, contract_address)
);

CREATE TABLE IF NOT EXISTS chain_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id integer NOT NULL,
  contract_address varchar(42) NOT NULL,
  event_name varchar(96) NOT NULL,
  transaction_hash varchar(66) NOT NULL,
  log_index integer NOT NULL,
  block_number bigint NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  indexed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chain_events_unique_log_idx UNIQUE (chain_id, transaction_hash, log_index)
);

CREATE INDEX IF NOT EXISTS chain_events_name_block_idx ON chain_events(event_name, block_number);
