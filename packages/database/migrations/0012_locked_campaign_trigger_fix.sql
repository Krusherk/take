-- A draft experiment is preregistered before mechanism lock. The campaign becomes
-- immutable when lock writes rules_hash, not merely when draft references exist.
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
