-- Join-link member list: when set, only people whose linked X handle or wallet is on
-- the list can join this campaign's sign-ups.
CREATE TABLE campaign_member_lists (
  campaign_id uuid PRIMARY KEY REFERENCES campaigns(id) ON DELETE CASCADE,
  community_label varchar(120) NOT NULL,
  x_handles text[] NOT NULL DEFAULT '{}',
  wallet_addresses text[] NOT NULL DEFAULT '{}',
  updated_by_identity_id uuid NOT NULL REFERENCES take_identities(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Opportunity-type template for the check after the TAKE, locked with the plan.
-- NFT_HOLD is checked automatically by the cron (balanceOf on the declared chain).
CREATE TABLE evaluation_plan_templates (
  plan_id uuid PRIMARY KEY REFERENCES campaign_evaluation_plans(id) ON DELETE CASCADE,
  template varchar(24) NOT NULL CHECK (template IN ('BUILDER_GRANT','CREATOR_PROGRAM','NFT_HOLD','BETA_ACCESS','EVENT_TICKET','CUSTOM')),
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  auto_checked_at timestamptz,
  auto_check_report jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE campaign_member_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE evaluation_plan_templates ENABLE ROW LEVEL SECURITY;

-- The template and its parameters are locked with the plan; only the automatic
-- check's result may be written later.
CREATE OR REPLACE FUNCTION protect_take_evaluation_template() RETURNS trigger AS $$
DECLARE campaign_status text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT c.status INTO campaign_status FROM campaign_evaluation_plans p JOIN campaigns c ON c.id = p.campaign_id WHERE p.id = NEW.plan_id;
    IF campaign_status IS DISTINCT FROM 'DRAFT' OR EXISTS (
      SELECT 1 FROM campaign_lifecycle_intents i JOIN campaign_evaluation_plans p ON p.campaign_id = i.campaign_id
      WHERE p.id = NEW.plan_id AND i.action = 'PUBLISH') THEN
      RAISE EXCEPTION 'Choose the evaluation template before publication';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' OR NEW.plan_id IS DISTINCT FROM OLD.plan_id OR NEW.template IS DISTINCT FROM OLD.template
     OR NEW.params IS DISTINCT FROM OLD.params OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Locked evaluation templates are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER evaluation_plan_templates_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON evaluation_plan_templates
  FOR EACH ROW EXECUTE FUNCTION protect_take_evaluation_template();
