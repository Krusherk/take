CREATE TABLE campaign_evaluation_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL UNIQUE REFERENCES campaigns(id),
  domain varchar(24) NOT NULL CHECK (domain IN ('BUILDER','CREATOR','COMMUNITY','GRANT','ACCESS','OTHER')),
  question text NOT NULL CHECK (length(trim(question)) > 0),
  criteria text NOT NULL CHECK (length(trim(criteria)) > 0),
  evaluate_after timestamptz NOT NULL,
  evidence_expected boolean NOT NULL DEFAULT true,
  created_by_identity_id uuid NOT NULL REFERENCES take_identities(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz
);
CREATE TABLE recipient_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES campaign_evaluation_plans(id),
  recipient_key varchar(66) NOT NULL CHECK (recipient_key ~ '^0x[0-9a-f]{64}$'),
  status varchar(24) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','POSITIVE','NEGATIVE','INCONCLUSIVE')),
  evidence_urls jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(evidence_urls) = 'array'),
  note text NOT NULL,
  is_public boolean NOT NULL DEFAULT false,
  evaluator_identity_id uuid NOT NULL REFERENCES take_identities(id),
  evaluated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'PENDING' AND evaluated_at IS NULL) OR (status <> 'PENDING' AND evaluated_at IS NOT NULL))
);
CREATE UNIQUE INDEX recipient_evaluations_plan_recipient_idx ON recipient_evaluations(plan_id, recipient_key);
CREATE INDEX nomination_edges_signal_giver_idx ON nomination_edges(canonical_giver_key, block_timestamp DESC)
  WHERE validity = 'VALID' AND finality_status = 'FINALIZED';

-- A locked promise cannot be rewritten or removed after the outcome is known.
CREATE FUNCTION protect_take_evaluation_plan() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE campaign_row campaigns%ROWTYPE;
BEGIN
  IF TG_OP <> 'INSERT' AND OLD.locked_at IS NOT NULL THEN
    RAISE EXCEPTION 'Locked evaluation criteria are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  SELECT * INTO campaign_row FROM campaigns WHERE id = NEW.campaign_id FOR UPDATE;
  IF campaign_row.status <> 'DRAFT' OR campaign_row.start_time <= now()
     OR EXISTS (SELECT 1 FROM campaign_lifecycle_intents WHERE campaign_id = NEW.campaign_id AND action = 'PUBLISH') THEN
    RAISE EXCEPTION 'Define evaluation criteria before publication and nominations';
  END IF;
  IF NEW.evaluate_after < campaign_row.end_time THEN
    RAISE EXCEPTION 'Evaluation date must follow the campaign window';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER protect_take_evaluation_plan BEFORE INSERT OR UPDATE OR DELETE ON campaign_evaluation_plans
  FOR EACH ROW EXECUTE FUNCTION protect_take_evaluation_plan();

-- Supabase clients cannot write outcome history directly. Fastify's database
-- role performs authenticated, authorized writes through the existing API.
ALTER TABLE campaign_evaluation_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipient_evaluations ENABLE ROW LEVEL SECURITY;
