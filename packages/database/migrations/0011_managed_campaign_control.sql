CREATE TABLE campaign_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  requested_by_identity_id uuid NOT NULL REFERENCES take_identities(id),
  status varchar(32) NOT NULL DEFAULT 'DRAFT',
  title varchar(160) NOT NULL,
  description text NOT NULL,
  resource_name varchar(160) NOT NULL,
  resource_description text,
  seat_count integer NOT NULL CHECK (seat_count > 0),
  start_time timestamptz NOT NULL,
  end_time timestamptz NOT NULL,
  selector_mode varchar(32) NOT NULL DEFAULT 'DISJOINT',
  eligibility_description text,
  operator_note text,
  provisioned_campaign_id uuid,
  submitted_at timestamptz,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT campaign_requests_status_check CHECK (status IN ('DRAFT','SUBMITTED','CHANGES_REQUESTED','PROVISIONED','REJECTED')),
  CONSTRAINT campaign_requests_selector_mode_check CHECK (selector_mode IN ('DISJOINT','OVERLAPPING')),
  CONSTRAINT campaign_requests_time_check CHECK (end_time > start_time)
);
CREATE INDEX campaign_requests_organization_idx ON campaign_requests(organization_id, status);
CREATE INDEX campaign_requests_requester_idx ON campaign_requests(requested_by_identity_id, created_at);

ALTER TABLE campaigns
  ADD COLUMN campaign_request_id uuid REFERENCES campaign_requests(id) ON DELETE SET NULL,
  ADD COLUMN eligibility_description text,
  ADD COLUMN image_url text,
  ADD COLUMN launch_approved_by_identity_id uuid REFERENCES take_identities(id),
  ADD COLUMN launch_approved_at timestamptz,
  ADD COLUMN onchain_operator_wallet_address varchar(42),
  ADD COLUMN onchain_organizer_address varchar(42);

ALTER TABLE campaign_requests
  ADD CONSTRAINT campaign_requests_provisioned_campaign_fk
  FOREIGN KEY (provisioned_campaign_id) REFERENCES campaigns(id) ON DELETE SET NULL;

CREATE TABLE campaign_lifecycle_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  action varchar(24) NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'PREPARING',
  chain_id integer NOT NULL,
  contract_address varchar(42) NOT NULL,
  required_from_address varchar(42),
  expected_calldata text NOT NULL,
  expected_rules_hash varchar(66),
  transaction_hash varchar(66) UNIQUE,
  event_name varchar(96) NOT NULL,
  event_log_index integer,
  event_block_number bigint,
  emitted_onchain_campaign_id bigint,
  emitted_organizer_address varchar(42),
  error_code varchar(96),
  error_message text,
  created_by_identity_id uuid NOT NULL REFERENCES take_identities(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  confirmed_at timestamptz,
  indexed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT campaign_lifecycle_action_check CHECK (action IN ('PUBLISH','ACTIVATE','CLOSE','FINALIZE')),
  CONSTRAINT campaign_lifecycle_status_check CHECK (status IN ('PREPARING','WAITING_FOR_WALLET','SUBMITTED','CONFIRMING','INDEXING','COMPLETED','FAILED')),
  CONSTRAINT campaign_lifecycle_intents_action_idx UNIQUE (campaign_id, action)
);
CREATE INDEX campaign_lifecycle_intents_transaction_idx ON campaign_lifecycle_intents(chain_id, transaction_hash);

ALTER TABLE chain_transactions
  ADD COLUMN campaign_id uuid REFERENCES campaigns(id) ON DELETE CASCADE,
  ADD COLUMN lifecycle_intent_id uuid REFERENCES campaign_lifecycle_intents(id) ON DELETE SET NULL,
  ADD COLUMN action varchar(32),
  ADD COLUMN submitted_by_identity_id uuid REFERENCES take_identities(id);

CREATE OR REPLACE FUNCTION prevent_locked_campaign_rule_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.rules_hash IS NOT NULL THEN
    IF ROW(
      NEW.title, NEW.description, NEW.start_time, NEW.end_time, NEW.nomination_limit,
      NEW.nominator_eligibility_mode, NEW.recipient_eligibility_mode,
      NEW.nomination_visibility_mode, NEW.nominator_eligibility_root,
      NEW.recipient_eligibility_root, NEW.mechanism_config_id, NEW.experiment_id,
      NEW.rules_hash
    ) IS DISTINCT FROM ROW(
      OLD.title, OLD.description, OLD.start_time, OLD.end_time, OLD.nomination_limit,
      OLD.nominator_eligibility_mode, OLD.recipient_eligibility_mode,
      OLD.nomination_visibility_mode, OLD.nominator_eligibility_root,
      OLD.recipient_eligibility_root, OLD.mechanism_config_id, OLD.experiment_id,
      OLD.rules_hash
    ) THEN
      RAISE EXCEPTION 'locked campaign rule inputs are immutable';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER campaigns_rule_inputs_immutable_after_lock
BEFORE UPDATE ON campaigns
FOR EACH ROW EXECUTE FUNCTION prevent_locked_campaign_rule_mutation();
