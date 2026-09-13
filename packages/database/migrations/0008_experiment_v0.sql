DO $$ BEGIN
  CREATE TYPE experiment_status AS ENUM ('DRAFT', 'LOCKED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE evidence_observations
  ADD COLUMN collected_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE campaign_experiments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  mechanism_config_id uuid NOT NULL REFERENCES campaign_mechanism_configs(id) ON DELETE RESTRICT,
  giver_snapshot_id uuid NOT NULL REFERENCES eligibility_snapshots(id) ON DELETE RESTRICT,
  recipient_snapshot_id uuid NOT NULL REFERENCES eligibility_snapshots(id) ON DELETE RESTRICT,
  experiment_version varchar(64) NOT NULL,
  variant varchar(32) NOT NULL,
  status experiment_status NOT NULL DEFAULT 'DRAFT',
  selected_popularity_proxy varchar(64) NOT NULL,
  canonical_protocol jsonb NOT NULL,
  protocol_hash varchar(66) NOT NULL,
  created_by_identity_id uuid NOT NULL REFERENCES take_identities(id),
  locked_by_identity_id uuid REFERENCES take_identities(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  CONSTRAINT campaign_experiments_campaign_idx UNIQUE (campaign_id),
  CONSTRAINT campaign_experiments_protocol_hash_idx UNIQUE (protocol_hash),
  CONSTRAINT campaign_experiments_version_check CHECK (experiment_version = 'TAKE_EXPERIMENT_V0'),
  CONSTRAINT campaign_experiments_variant_check CHECK (variant IN ('OVERLAPPING', 'DISJOINT')),
  CONSTRAINT campaign_experiments_proxy_check CHECK (
    selected_popularity_proxy IN ('X_FOLLOWER_COUNT', 'ORGANIZER_FAMILIARITY')
  ),
  CONSTRAINT campaign_experiments_lock_state_check CHECK (
    (status = 'LOCKED' AND locked_by_identity_id IS NOT NULL AND locked_at IS NOT NULL)
    OR status = 'DRAFT'
  )
);

CREATE INDEX campaign_experiments_status_idx ON campaign_experiments(status);

ALTER TABLE campaigns ADD COLUMN experiment_id uuid;
ALTER TABLE campaigns ADD CONSTRAINT campaigns_experiment_id_fk
  FOREIGN KEY (experiment_id) REFERENCES campaign_experiments(id) ON DELETE RESTRICT;

CREATE TABLE experiment_context_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id uuid NOT NULL REFERENCES campaign_experiments(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  canonical_recipient_key varchar(66) NOT NULL,
  proxy_type varchar(64) NOT NULL,
  numeric_value bigint NOT NULL,
  observed_at timestamptz NOT NULL,
  collected_at timestamptz NOT NULL DEFAULT now(),
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  observation_hash varchar(66) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT experiment_context_recipient_proxy_idx UNIQUE (
    experiment_id,
    canonical_recipient_key,
    proxy_type
  ),
  CONSTRAINT experiment_context_observation_hash_idx UNIQUE (observation_hash),
  CONSTRAINT experiment_context_value_check CHECK (numeric_value >= 0),
  CONSTRAINT experiment_context_proxy_check CHECK (
    proxy_type IN ('X_FOLLOWER_COUNT', 'ORGANIZER_FAMILIARITY')
  ),
  CONSTRAINT experiment_context_familiarity_check CHECK (
    proxy_type <> 'ORGANIZER_FAMILIARITY' OR numeric_value BETWEEN 0 AND 3
  )
);

CREATE INDEX experiment_context_campaign_idx ON experiment_context_observations(campaign_id);

CREATE TABLE recipient_discovery_exposures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id uuid NOT NULL REFERENCES campaign_experiments(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  viewer_identity_id uuid NOT NULL REFERENCES take_identities(id),
  query text NOT NULL DEFAULT '',
  ordered_recipient_keys jsonb NOT NULL,
  exposure_hash varchar(66) NOT NULL UNIQUE,
  served_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX recipient_discovery_viewer_campaign_idx
  ON recipient_discovery_exposures(viewer_identity_id, campaign_id, served_at);

CREATE TABLE nomination_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  experiment_id uuid REFERENCES campaign_experiments(id) ON DELETE SET NULL,
  giver_identity_id uuid NOT NULL REFERENCES take_identities(id),
  giver_canonical_key varchar(66) NOT NULL,
  recipient_take_identity_id uuid REFERENCES take_identities(id),
  recipient_external_identity_id uuid REFERENCES external_identities(id),
  recipient_canonical_key varchar(66),
  idempotency_key uuid,
  accepted boolean NOT NULL,
  reason_code varchar(96) NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT nomination_attempts_recipient_check CHECK (
    NOT (recipient_take_identity_id IS NOT NULL AND recipient_external_identity_id IS NOT NULL)
  )
);

CREATE INDEX nomination_attempts_campaign_giver_idx
  ON nomination_attempts(campaign_id, giver_identity_id, created_at);
CREATE INDEX nomination_attempts_idempotency_idx ON nomination_attempts(idempotency_key);

ALTER TABLE nominations ADD COLUMN experiment_id uuid REFERENCES campaign_experiments(id) ON DELETE SET NULL;
ALTER TABLE nominations ADD COLUMN nominator_snapshot_id uuid REFERENCES eligibility_snapshots(id) ON DELETE RESTRICT;
ALTER TABLE nominations ADD COLUMN recipient_snapshot_id uuid REFERENCES eligibility_snapshots(id) ON DELETE RESTRICT;

ALTER TABLE nomination_edges ADD COLUMN experiment_id uuid REFERENCES campaign_experiments(id) ON DELETE SET NULL;
ALTER TABLE nomination_edges ADD COLUMN nominator_snapshot_id uuid REFERENCES eligibility_snapshots(id) ON DELETE RESTRICT;
ALTER TABLE nomination_edges ADD COLUMN recipient_snapshot_id uuid REFERENCES eligibility_snapshots(id) ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION prevent_locked_experiment_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'LOCKED' THEN
    RAISE EXCEPTION 'locked campaign experiments are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER campaign_experiments_immutable_after_lock
BEFORE UPDATE OR DELETE ON campaign_experiments
FOR EACH ROW EXECUTE FUNCTION prevent_locked_experiment_mutation();

CREATE OR REPLACE FUNCTION prevent_locked_experiment_observation_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE experiment_state experiment_status;
BEGIN
  SELECT status INTO experiment_state
  FROM campaign_experiments
  WHERE id = COALESCE(NEW.experiment_id, OLD.experiment_id);
  IF experiment_state = 'LOCKED' THEN
    RAISE EXCEPTION 'observations for locked campaign experiments are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER experiment_context_immutable_after_lock
BEFORE INSERT OR UPDATE OR DELETE ON experiment_context_observations
FOR EACH ROW EXECUTE FUNCTION prevent_locked_experiment_observation_mutation();
