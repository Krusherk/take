DO $$ BEGIN
  CREATE TYPE mechanism_config_status AS ENUM ('DRAFT', 'LOCKED', 'SUPERSEDED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE eligibility_snapshot_status AS ENUM ('COLLECTING', 'EVALUATING', 'READY', 'LOCKED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE eligibility_decision AS ENUM ('PASS', 'FAIL', 'UNKNOWN');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE chain_finality_status AS ENUM ('UNCONFIRMED', 'FINALIZED', 'ORPHANED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE graph_signal_status AS ENUM (
    'AUTO_CLEARED',
    'NEEDS_REVIEW',
    'NOT_RUN',
    'CONFIRMED_MANIPULATION',
    'DISMISSED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE review_case_status AS ENUM ('OPEN', 'UNDER_REVIEW', 'RESOLVED', 'APPEALED', 'CLOSED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE randomness_status AS ENUM ('COMMITTED', 'FETCHING', 'VERIFIED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE wallets ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS first_observed_at timestamptz;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS last_observed_at timestamptz;
UPDATE wallets
SET first_observed_at = COALESCE(first_observed_at, created_at),
    last_observed_at = COALESCE(last_observed_at, created_at);
ALTER TABLE wallets ALTER COLUMN first_observed_at SET DEFAULT now();
ALTER TABLE wallets ALTER COLUMN first_observed_at SET NOT NULL;
ALTER TABLE wallets ALTER COLUMN last_observed_at SET DEFAULT now();
ALTER TABLE wallets ALTER COLUMN last_observed_at SET NOT NULL;

ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS manager_contract_address varchar(42);
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS manager_version varchar(32) NOT NULL DEFAULT 'LEGACY_V1';
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS mechanism_config_id uuid;

UPDATE campaigns
SET manager_contract_address = '0xc3A0178B31D8844455c49988736d51A2336056e5'
WHERE chain_id = 10143 AND manager_contract_address IS NULL;

CREATE TABLE campaign_mechanism_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  revision integer NOT NULL,
  mechanism_version varchar(64) NOT NULL,
  status mechanism_config_status NOT NULL DEFAULT 'DRAFT',
  canonical_config jsonb NOT NULL,
  config_hash varchar(66) NOT NULL,
  supersedes_id uuid REFERENCES campaign_mechanism_configs(id) ON DELETE RESTRICT,
  created_by_identity_id uuid NOT NULL REFERENCES take_identities(id),
  locked_by_identity_id uuid REFERENCES take_identities(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  CONSTRAINT campaign_mechanism_configs_revision_positive CHECK (revision > 0),
  CONSTRAINT campaign_mechanism_configs_lock_state CHECK (
    (status = 'LOCKED' AND locked_by_identity_id IS NOT NULL AND locked_at IS NOT NULL)
    OR status <> 'LOCKED'
  ),
  CONSTRAINT campaign_mechanism_configs_revision_idx UNIQUE (campaign_id, revision),
  CONSTRAINT campaign_mechanism_configs_hash_idx UNIQUE (config_hash)
);

CREATE INDEX campaign_mechanism_configs_campaign_status_idx
  ON campaign_mechanism_configs(campaign_id, status);

ALTER TABLE campaigns
  ADD CONSTRAINT campaigns_mechanism_config_id_fk
  FOREIGN KEY (mechanism_config_id) REFERENCES campaign_mechanism_configs(id) ON DELETE RESTRICT;

CREATE TABLE discord_guild_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  guild_id varchar(20) NOT NULL,
  guild_name varchar(160),
  status varchar(32) NOT NULL DEFAULT 'PENDING',
  permissions jsonb NOT NULL DEFAULT '[]'::jsonb,
  installed_by_identity_id uuid NOT NULL REFERENCES take_identities(id),
  installed_at timestamptz,
  last_health_check_at timestamptz,
  last_error_code varchar(96),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT discord_guild_integrations_org_guild_idx UNIQUE (organization_id, guild_id)
);

ALTER TABLE eligibility_snapshots
  ADD COLUMN IF NOT EXISTS mechanism_config_id uuid REFERENCES campaign_mechanism_configs(id) ON DELETE RESTRICT;
ALTER TABLE eligibility_snapshots
  ADD COLUMN IF NOT EXISTS status eligibility_snapshot_status NOT NULL DEFAULT 'COLLECTING';
ALTER TABLE eligibility_snapshots ADD COLUMN IF NOT EXISTS policy_hash varchar(66);
ALTER TABLE eligibility_snapshots ADD COLUMN IF NOT EXISTS canonical_artifact jsonb;
ALTER TABLE eligibility_snapshots ADD COLUMN IF NOT EXISTS cutoff_at timestamptz;
ALTER TABLE eligibility_snapshots ADD COLUMN IF NOT EXISTS candidate_count integer NOT NULL DEFAULT 0;
ALTER TABLE eligibility_snapshots ADD COLUMN IF NOT EXISTS eligible_count integer NOT NULL DEFAULT 0;
ALTER TABLE eligibility_snapshots
  ADD COLUMN IF NOT EXISTS locked_by_identity_id uuid REFERENCES take_identities(id);
ALTER TABLE eligibility_snapshots ADD COLUMN IF NOT EXISTS locked_at timestamptz;
ALTER TABLE eligibility_snapshots
  ADD CONSTRAINT eligibility_snapshots_counts_check
  CHECK (candidate_count >= 0 AND eligible_count >= 0 AND eligible_count <= candidate_count);

CREATE TABLE evidence_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid REFERENCES campaigns(id) ON DELETE CASCADE,
  mechanism_config_id uuid REFERENCES campaign_mechanism_configs(id) ON DELETE CASCADE,
  subject_key varchar(66) NOT NULL,
  take_identity_id uuid REFERENCES take_identities(id) ON DELETE SET NULL,
  external_identity_id uuid REFERENCES external_identities(id) ON DELETE SET NULL,
  source varchar(64) NOT NULL,
  fact varchar(96) NOT NULL,
  status varchar(32) NOT NULL,
  scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  value jsonb,
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  provider_observed_at timestamptz,
  observed_at timestamptz NOT NULL,
  payload_hash varchar(66) NOT NULL,
  evidence_hash varchar(66) NOT NULL,
  deduplication_key varchar(66) NOT NULL,
  error_code varchar(96),
  retention_class varchar(32) NOT NULL DEFAULT 'STANDARD',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT evidence_observations_status_check CHECK (status IN ('OBSERVED', 'UNAVAILABLE')),
  CONSTRAINT evidence_observations_hash_idx UNIQUE (evidence_hash),
  CONSTRAINT evidence_observations_deduplication_idx UNIQUE (deduplication_key)
);

CREATE INDEX evidence_observations_subject_fact_idx ON evidence_observations(subject_key, fact);
CREATE INDEX evidence_observations_campaign_idx ON evidence_observations(campaign_id);

CREATE TABLE eligibility_snapshot_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id uuid NOT NULL REFERENCES eligibility_snapshots(id) ON DELETE CASCADE,
  subject_key varchar(66) NOT NULL,
  take_identity_id uuid REFERENCES take_identities(id) ON DELETE SET NULL,
  external_identity_id uuid REFERENCES external_identities(id) ON DELETE SET NULL,
  decision eligibility_decision NOT NULL,
  eligible boolean NOT NULL DEFAULT false,
  ordinal integer NOT NULL,
  merkle_leaf varchar(66),
  merkle_proof jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT eligibility_snapshot_members_eligible_check CHECK (
    (eligible = true AND decision = 'PASS') OR eligible = false
  ),
  CONSTRAINT eligibility_snapshot_members_ordinal_check CHECK (ordinal >= 0),
  CONSTRAINT eligibility_snapshot_members_subject_idx UNIQUE (snapshot_id, subject_key),
  CONSTRAINT eligibility_snapshot_members_ordinal_idx UNIQUE (snapshot_id, ordinal)
);

CREATE INDEX eligibility_snapshot_members_take_identity_idx
  ON eligibility_snapshot_members(take_identity_id);

CREATE TABLE eligibility_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id uuid NOT NULL REFERENCES eligibility_snapshots(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES eligibility_snapshot_members(id) ON DELETE CASCADE,
  rule_id varchar(96) NOT NULL,
  rule_type varchar(96) NOT NULL,
  rule_version integer NOT NULL,
  decision eligibility_decision NOT NULL,
  reason_code varchar(96) NOT NULL,
  evidence_observation_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  public_explanation text NOT NULL,
  internal_details jsonb,
  evaluator_version varchar(32) NOT NULL,
  evaluated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT eligibility_evaluations_member_rule_idx UNIQUE (member_id, rule_id)
);

CREATE INDEX eligibility_evaluations_snapshot_decision_idx
  ON eligibility_evaluations(snapshot_id, decision);

ALTER TABLE chain_indexer_cursors ADD COLUMN IF NOT EXISTS last_finalized_block bigint NOT NULL DEFAULT 0;
ALTER TABLE chain_indexer_cursors ADD COLUMN IF NOT EXISTS last_finalized_block_hash varchar(66);

ALTER TABLE chain_events ADD COLUMN IF NOT EXISTS block_hash varchar(66);
ALTER TABLE chain_events ADD COLUMN IF NOT EXISTS transaction_index integer;
ALTER TABLE chain_events ADD COLUMN IF NOT EXISTS block_timestamp timestamptz;
ALTER TABLE chain_events
  ADD COLUMN IF NOT EXISTS finality_status chain_finality_status NOT NULL DEFAULT 'UNCONFIRMED';
ALTER TABLE chain_events ADD COLUMN IF NOT EXISTS finalized_at timestamptz;
ALTER TABLE chain_events ADD COLUMN IF NOT EXISTS orphaned_at timestamptz;
CREATE INDEX chain_events_finality_block_idx ON chain_events(finality_status, block_number);

CREATE TABLE nomination_edges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  chain_event_id uuid NOT NULL REFERENCES chain_events(id) ON DELETE RESTRICT,
  nomination_id uuid REFERENCES nominations(id) ON DELETE SET NULL,
  chain_id integer NOT NULL,
  contract_address varchar(42) NOT NULL,
  transaction_hash varchar(66) NOT NULL,
  block_number bigint NOT NULL,
  block_hash varchar(66) NOT NULL,
  transaction_index integer NOT NULL,
  log_index integer NOT NULL,
  block_timestamp timestamptz NOT NULL,
  giver_identity_key varchar(66) NOT NULL,
  recipient_identity_key varchar(66) NOT NULL,
  canonical_giver_key varchar(66) NOT NULL,
  canonical_recipient_key varchar(66) NOT NULL,
  identity_resolution jsonb NOT NULL DEFAULT '{}'::jsonb,
  validity varchar(16) NOT NULL DEFAULT 'VALID',
  invalid_reason varchar(96),
  finality_status chain_finality_status NOT NULL DEFAULT 'UNCONFIRMED',
  indexed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT nomination_edges_validity_check CHECK (validity IN ('VALID', 'INVALID')),
  CONSTRAINT nomination_edges_invalid_reason_check CHECK (
    (validity = 'INVALID' AND invalid_reason IS NOT NULL) OR validity = 'VALID'
  ),
  CONSTRAINT nomination_edges_chain_event_idx UNIQUE (chain_event_id),
  CONSTRAINT nomination_edges_chain_log_idx UNIQUE (
    chain_id,
    contract_address,
    transaction_hash,
    log_index
  )
);

CREATE INDEX nomination_edges_campaign_giver_idx
  ON nomination_edges(campaign_id, canonical_giver_key);
CREATE INDEX nomination_edges_campaign_recipient_idx
  ON nomination_edges(campaign_id, canonical_recipient_key);
CREATE INDEX nomination_edges_campaign_order_idx
  ON nomination_edges(campaign_id, block_number, transaction_index, log_index);

CREATE TABLE graph_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  edge_cutoff_block bigint NOT NULL,
  edge_cutoff_block_hash varchar(66) NOT NULL,
  input_hash varchar(66) NOT NULL UNIQUE,
  algorithm_version varchar(32) NOT NULL,
  artifact jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX graph_snapshots_campaign_idx ON graph_snapshots(campaign_id, created_at);

CREATE TABLE graph_signal_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  graph_snapshot_id uuid NOT NULL REFERENCES graph_snapshots(id) ON DELETE CASCADE,
  signal_hash varchar(66) NOT NULL UNIQUE,
  signal_type varchar(96) NOT NULL,
  algorithm_version varchar(32) NOT NULL,
  status graph_signal_status NOT NULL,
  strength_basis_points integer,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  limitation text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT graph_signal_strength_check CHECK (
    strength_basis_points IS NULL OR strength_basis_points BETWEEN 0 AND 10000
  )
);

CREATE INDEX graph_signal_observations_snapshot_status_idx
  ON graph_signal_observations(graph_snapshot_id, status);

CREATE TABLE graph_signal_subjects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  graph_signal_id uuid NOT NULL REFERENCES graph_signal_observations(id) ON DELETE CASCADE,
  subject_key varchar(66) NOT NULL,
  nomination_edge_id uuid REFERENCES nomination_edges(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX graph_signal_subjects_unique_idx
  ON graph_signal_subjects(
    graph_signal_id,
    subject_key,
    COALESCE(nomination_edge_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );
CREATE INDEX graph_signal_subjects_lookup_idx ON graph_signal_subjects(subject_key);

CREATE TABLE review_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  graph_signal_id uuid REFERENCES graph_signal_observations(id) ON DELETE SET NULL,
  case_type varchar(96) NOT NULL,
  status review_case_status NOT NULL DEFAULT 'OPEN',
  public_summary text,
  restricted_summary text,
  opened_by_identity_id uuid REFERENCES take_identities(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX review_cases_campaign_status_idx ON review_cases(campaign_id, status);

CREATE TABLE review_case_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_case_id uuid NOT NULL REFERENCES review_cases(id) ON DELETE CASCADE,
  sequence integer NOT NULL,
  event_type varchar(96) NOT NULL,
  actor_identity_id uuid REFERENCES take_identities(id),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT review_case_events_sequence_check CHECK (sequence > 0),
  CONSTRAINT review_case_events_sequence_idx UNIQUE (review_case_id, sequence)
);

CREATE TABLE review_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_case_id uuid NOT NULL REFERENCES review_cases(id) ON DELETE CASCADE,
  revision integer NOT NULL,
  decision varchar(64) NOT NULL,
  reason_code varchar(96) NOT NULL,
  public_explanation text NOT NULL,
  restricted_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  decided_by_identity_id uuid NOT NULL REFERENCES take_identities(id),
  decided_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT review_decisions_revision_check CHECK (revision > 0),
  CONSTRAINT review_decisions_revision_idx UNIQUE (review_case_id, revision)
);

CREATE TABLE randomness_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  mechanism_config_id uuid NOT NULL REFERENCES campaign_mechanism_configs(id) ON DELETE RESTRICT,
  source varchar(32) NOT NULL,
  network varchar(32) NOT NULL,
  chain_hash varchar(66) NOT NULL,
  round bigint NOT NULL,
  not_before timestamptz NOT NULL,
  status randomness_status NOT NULL DEFAULT 'COMMITTED',
  randomness varchar(66),
  signature text,
  previous_signature text,
  public_key text,
  scheme_id varchar(96),
  period_seconds integer,
  genesis_time bigint,
  relay_responses jsonb NOT NULL DEFAULT '[]'::jsonb,
  artifact_hash varchar(66),
  verified_at timestamptz,
  error_code varchar(96),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT randomness_artifacts_round_idx UNIQUE (network, chain_hash, round),
  CONSTRAINT randomness_artifacts_verified_check CHECK (
    status <> 'VERIFIED'
    OR (randomness IS NOT NULL AND signature IS NOT NULL AND verified_at IS NOT NULL AND artifact_hash IS NOT NULL)
  )
);

CREATE INDEX randomness_artifacts_campaign_idx ON randomness_artifacts(campaign_id);

ALTER TABLE allocation_runs
  ADD COLUMN IF NOT EXISTS mechanism_config_id uuid REFERENCES campaign_mechanism_configs(id) ON DELETE RESTRICT;
ALTER TABLE allocation_runs
  ADD COLUMN IF NOT EXISTS nominator_snapshot_id uuid REFERENCES eligibility_snapshots(id) ON DELETE RESTRICT;
ALTER TABLE allocation_runs
  ADD COLUMN IF NOT EXISTS recipient_snapshot_id uuid REFERENCES eligibility_snapshots(id) ON DELETE RESTRICT;
ALTER TABLE allocation_runs
  ADD COLUMN IF NOT EXISTS graph_snapshot_id uuid REFERENCES graph_snapshots(id) ON DELETE RESTRICT;
ALTER TABLE allocation_runs
  ADD COLUMN IF NOT EXISTS randomness_artifact_id uuid REFERENCES randomness_artifacts(id) ON DELETE RESTRICT;
ALTER TABLE allocation_runs ADD COLUMN IF NOT EXISTS artifact_version varchar(32) NOT NULL DEFAULT '1';
ALTER TABLE allocation_runs ADD COLUMN IF NOT EXISTS code_version varchar(96);
ALTER TABLE allocation_runs ADD COLUMN IF NOT EXISTS input_artifact jsonb;
ALTER TABLE allocation_runs ADD COLUMN IF NOT EXISTS result_artifact jsonb;

ALTER TABLE allocation_results ADD COLUMN IF NOT EXISTS recipient_key varchar(66);
ALTER TABLE allocation_results ADD COLUMN IF NOT EXISTS rank integer;
ALTER TABLE allocation_results ADD COLUMN IF NOT EXISTS selection_order integer;
ALTER TABLE allocation_results ADD COLUMN IF NOT EXISTS tie_breaker varchar(66);

CREATE TABLE simulation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid REFERENCES campaigns(id) ON DELETE SET NULL,
  mechanism_config_id uuid REFERENCES campaign_mechanism_configs(id) ON DELETE SET NULL,
  config_hash varchar(66),
  simulator_version varchar(32) NOT NULL,
  run_count integer NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'RUNNING',
  report jsonb,
  report_hash varchar(66) UNIQUE,
  kill_criteria_passed boolean,
  created_by_identity_id uuid REFERENCES take_identities(id),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT simulation_runs_count_check CHECK (run_count > 0),
  CONSTRAINT simulation_runs_status_check CHECK (status IN ('RUNNING', 'COMPLETED', 'FAILED'))
);

CREATE INDEX simulation_runs_campaign_idx ON simulation_runs(campaign_id, started_at);

CREATE OR REPLACE FUNCTION take_prevent_immutable_row_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% rows are append-only', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER evidence_observations_immutable
BEFORE UPDATE OR DELETE ON evidence_observations
FOR EACH ROW EXECUTE FUNCTION take_prevent_immutable_row_mutation();

CREATE TRIGGER review_case_events_immutable
BEFORE UPDATE OR DELETE ON review_case_events
FOR EACH ROW EXECUTE FUNCTION take_prevent_immutable_row_mutation();

CREATE TRIGGER review_decisions_immutable
BEFORE UPDATE OR DELETE ON review_decisions
FOR EACH ROW EXECUTE FUNCTION take_prevent_immutable_row_mutation();
