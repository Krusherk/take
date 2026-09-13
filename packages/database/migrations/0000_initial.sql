CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE campaign_status AS ENUM ('DRAFT', 'CREATED', 'ACTIVE', 'CLOSED', 'ALLOCATING', 'FINALIZED', 'CANCELLED');
CREATE TYPE eligibility_mode AS ENUM ('OPEN_REGISTERED', 'MERKLE_ALLOWLIST', 'ORGANIZER_APPROVED', 'EXTERNAL_ALLOWED');
CREATE TYPE nomination_visibility_mode AS ENUM ('PUBLIC', 'SEALED');
CREATE TYPE nomination_status AS ENUM ('PREPARING', 'AWAITING_SIGNATURE', 'SUBMITTED', 'CHAIN_CONFIRMED', 'INDEXING_DELAYED', 'CONFIRMED', 'FAILED');
CREATE TYPE organization_role AS ENUM ('OWNER', 'ADMIN', 'MEMBER');
CREATE TYPE allocation_run_status AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'FINALIZED');

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  privy_user_id varchar(191) NOT NULL UNIQUE,
  display_name varchar(160),
  avatar_url text,
  status varchar(32) NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE take_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  protocol_identity_key varchar(66) NOT NULL UNIQUE,
  creation_nonce varchar(64) NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE social_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  take_identity_id uuid NOT NULL REFERENCES take_identities(id) ON DELETE CASCADE,
  provider varchar(32) NOT NULL,
  provider_user_id varchar(191) NOT NULL,
  username varchar(128),
  display_name varchar(160),
  avatar_url text,
  is_active boolean NOT NULL DEFAULT true,
  first_observed_at timestamptz NOT NULL DEFAULT now(),
  last_observed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT social_accounts_provider_user_id_idx UNIQUE (provider, provider_user_id)
);

CREATE TABLE wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  take_identity_id uuid NOT NULL REFERENCES take_identities(id) ON DELETE CASCADE,
  privy_wallet_id varchar(191),
  address varchar(42) NOT NULL UNIQUE,
  wallet_type varchar(32) NOT NULL,
  chain_type varchar(32) NOT NULL DEFAULT 'ethereum',
  is_primary boolean NOT NULL DEFAULT false,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX wallets_take_identity_id_idx ON wallets(take_identity_id);

CREATE TABLE external_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider varchar(32) NOT NULL,
  immutable_provider_user_id varchar(191) NOT NULL,
  external_identity_key varchar(66) NOT NULL UNIQUE,
  take_identity_id uuid REFERENCES take_identities(id) ON DELETE SET NULL,
  current_username varchar(128),
  display_name varchar(160),
  avatar_url text,
  first_observed_at timestamptz NOT NULL DEFAULT now(),
  last_observed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT external_identities_provider_user_id_idx UNIQUE (provider, immutable_provider_user_id)
);

CREATE INDEX external_identities_take_identity_id_idx ON external_identities(take_identity_id);

CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(160) NOT NULL,
  slug varchar(96) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE organization_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  take_identity_id uuid NOT NULL REFERENCES take_identities(id) ON DELETE CASCADE,
  role organization_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organization_members_unique_idx UNIQUE (organization_id, take_identity_id)
);

CREATE TABLE campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  created_by_identity_id uuid NOT NULL REFERENCES take_identities(id),
  onchain_campaign_id bigint,
  chain_id integer,
  status campaign_status NOT NULL DEFAULT 'DRAFT',
  title varchar(160) NOT NULL,
  description text,
  metadata_uri text,
  metadata_hash varchar(66),
  rules_hash varchar(66),
  start_time timestamptz NOT NULL,
  end_time timestamptz NOT NULL,
  nomination_limit integer NOT NULL DEFAULT 1,
  nominator_eligibility_mode eligibility_mode NOT NULL,
  recipient_eligibility_mode eligibility_mode NOT NULL,
  nomination_visibility_mode nomination_visibility_mode NOT NULL,
  nominator_eligibility_root varchar(66),
  recipient_eligibility_root varchar(66),
  final_result_hash varchar(66),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT campaigns_time_order_check CHECK (end_time > start_time),
  CONSTRAINT campaigns_nomination_limit_check CHECK (nomination_limit > 0)
);

CREATE UNIQUE INDEX campaigns_chain_onchain_idx ON campaigns(chain_id, onchain_campaign_id) WHERE chain_id IS NOT NULL AND onchain_campaign_id IS NOT NULL;
CREATE INDEX campaigns_status_idx ON campaigns(status);
CREATE INDEX campaigns_organization_id_idx ON campaigns(organization_id);

CREATE TABLE campaign_resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  type varchar(64) NOT NULL,
  name varchar(160) NOT NULL,
  description text,
  quantity integer NOT NULL,
  unit_value varchar(96),
  chain varchar(64),
  contract_address varchar(42),
  token_id varchar(128),
  claim_instructions text,
  escrow_status varchar(32) NOT NULL DEFAULT 'NONE',
  CONSTRAINT campaign_resources_quantity_check CHECK (quantity > 0)
);

CREATE TABLE eligibility_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  subject varchar(32) NOT NULL,
  mode eligibility_mode NOT NULL,
  root varchar(66),
  snapshot_hash varchar(66) NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX eligibility_snapshots_campaign_subject_idx ON eligibility_snapshots(campaign_id, subject);

CREATE TABLE chain_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id integer NOT NULL,
  transaction_hash varchar(66) NOT NULL UNIQUE,
  from_address varchar(42),
  to_address varchar(42),
  status varchar(32) NOT NULL DEFAULT 'SUBMITTED',
  block_number bigint,
  error_message text,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz
);

CREATE TABLE chain_indexer_cursors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id integer NOT NULL,
  contract_address varchar(42) NOT NULL,
  last_scanned_block bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chain_indexer_cursors_chain_contract_idx UNIQUE (chain_id, contract_address)
);

CREATE TABLE chain_events (
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

CREATE INDEX chain_events_name_block_idx ON chain_events(event_name, block_number);

CREATE TABLE nominations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  giver_identity_id uuid NOT NULL REFERENCES take_identities(id),
  recipient_take_identity_id uuid REFERENCES take_identities(id),
  recipient_external_identity_id uuid REFERENCES external_identities(id),
  idempotency_key uuid NOT NULL UNIQUE,
  chain_id integer,
  transaction_hash varchar(66),
  log_index integer,
  block_number bigint,
  status nomination_status NOT NULL,
  source varchar(32) NOT NULL DEFAULT 'api',
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  confirmed_at timestamptz,
  indexed_at timestamptz,
  CONSTRAINT nominations_exactly_one_recipient_check CHECK (
    (recipient_take_identity_id IS NOT NULL AND recipient_external_identity_id IS NULL)
    OR (recipient_take_identity_id IS NULL AND recipient_external_identity_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX nominations_chain_event_idx ON nominations(chain_id, transaction_hash, log_index) WHERE chain_id IS NOT NULL AND transaction_hash IS NOT NULL AND log_index IS NOT NULL;
CREATE INDEX nominations_campaign_giver_idx ON nominations(campaign_id, giver_identity_id);
CREATE INDEX nominations_recipient_take_identity_idx ON nominations(recipient_take_identity_id);
CREATE INDEX nominations_recipient_external_identity_idx ON nominations(recipient_external_identity_id);

CREATE TABLE allocation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  strategy_id varchar(96) NOT NULL,
  strategy_version varchar(32) NOT NULL,
  configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
  input_snapshot_hash varchar(66) NOT NULL,
  randomness_seed varchar(128),
  status allocation_run_status NOT NULL DEFAULT 'PENDING',
  result_hash varchar(66),
  created_by_identity_id uuid REFERENCES take_identities(id),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE allocation_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  allocation_run_id uuid NOT NULL REFERENCES allocation_runs(id) ON DELETE CASCADE,
  recipient_take_identity_id uuid REFERENCES take_identities(id),
  recipient_external_identity_id uuid REFERENCES external_identities(id),
  score integer NOT NULL,
  selected boolean NOT NULL DEFAULT false,
  explanation jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT allocation_results_exactly_one_recipient_check CHECK (
    (recipient_take_identity_id IS NOT NULL AND recipient_external_identity_id IS NULL)
    OR (recipient_take_identity_id IS NULL AND recipient_external_identity_id IS NOT NULL)
  )
);

CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_take_identity_id uuid REFERENCES take_identities(id),
  recipient_external_identity_id uuid REFERENCES external_identities(id),
  type varchar(64) NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notifications_at_least_one_recipient_check CHECK (
    recipient_take_identity_id IS NOT NULL OR recipient_external_identity_id IS NOT NULL
  )
);

CREATE TABLE audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_identity_id uuid REFERENCES take_identities(id),
  organization_id uuid REFERENCES organizations(id),
  campaign_id uuid REFERENCES campaigns(id),
  action varchar(96) NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
