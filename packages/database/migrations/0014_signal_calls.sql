-- Social calls on Signal: a giver says what they expect from the person they
-- backed, before the campaign's locked check date. No money, no points, no
-- effect on eligibility, allocation, or evaluation.
CREATE TABLE signal_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id),
  plan_id uuid NOT NULL REFERENCES campaign_evaluation_plans(id),
  giver_key varchar(66) NOT NULL CHECK (giver_key ~ '^0x[0-9a-f]{64}$'),
  recipient_key varchar(66) NOT NULL CHECK (recipient_key ~ '^0x[0-9a-f]{64}$'),
  call varchar(16) NOT NULL CHECK (call IN ('YES','UNSURE','NO')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX signal_calls_campaign_giver_idx ON signal_calls(campaign_id, giver_key);
CREATE INDEX signal_calls_campaign_recipient_idx ON signal_calls(campaign_id, recipient_key);

-- A call cannot be made or changed once the locked check date has passed.
CREATE FUNCTION protect_take_signal_call() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE plan_row campaign_evaluation_plans%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Signal calls are kept as history';
  END IF;
  SELECT * INTO plan_row FROM campaign_evaluation_plans WHERE id = NEW.plan_id;
  IF plan_row.campaign_id IS DISTINCT FROM NEW.campaign_id THEN
    RAISE EXCEPTION 'Signal call plan does not belong to the campaign';
  END IF;
  IF plan_row.evaluate_after <= now() THEN
    RAISE EXCEPTION 'Calls close when the check is due';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER protect_take_signal_call BEFORE INSERT OR UPDATE OR DELETE ON signal_calls
  FOR EACH ROW EXECUTE FUNCTION protect_take_signal_call();

-- Writes go through the authenticated API only.
ALTER TABLE signal_calls ENABLE ROW LEVEL SECURITY;
