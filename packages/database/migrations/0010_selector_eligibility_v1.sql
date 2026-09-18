CREATE TABLE campaign_eligibility_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  revision integer NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'DRAFT',
  candidate_allowlist_id uuid NOT NULL REFERENCES identity_allowlists(id) ON DELETE RESTRICT,
  final_allowlist_id uuid REFERENCES identity_allowlists(id) ON DELETE RESTRICT,
  preset varchar(64) NOT NULL,
  canonical_policy jsonb NOT NULL,
  policy_hash varchar(66) NOT NULL UNIQUE,
  created_by_identity_id uuid NOT NULL REFERENCES take_identities(id),
  locked_by_identity_id uuid REFERENCES take_identities(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  CONSTRAINT campaign_eligibility_policies_revision_idx UNIQUE (campaign_id, revision),
  CONSTRAINT campaign_eligibility_policies_status_check CHECK (status IN ('DRAFT', 'EVALUATING', 'REVIEW', 'LOCKED')),
  CONSTRAINT campaign_eligibility_policies_lock_check CHECK (
    (status = 'LOCKED' AND final_allowlist_id IS NOT NULL AND locked_by_identity_id IS NOT NULL AND locked_at IS NOT NULL)
    OR status <> 'LOCKED'
  )
);
CREATE INDEX campaign_eligibility_policies_campaign_status_idx
  ON campaign_eligibility_policies(campaign_id, status);

CREATE TABLE selector_eligibility_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  policy_id uuid NOT NULL REFERENCES campaign_eligibility_policies(id) ON DELETE CASCADE,
  take_identity_id uuid NOT NULL REFERENCES take_identities(id) ON DELETE RESTRICT,
  automatic_status varchar(32) NOT NULL,
  final_status varchar(32) NOT NULL,
  qualification_path varchar(32),
  total_points integer NOT NULL DEFAULT 0,
  category_scores jsonb NOT NULL DEFAULT '[]'::jsonb,
  missing_rule_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  integrity_status varchar(32) NOT NULL DEFAULT 'NO_DATA',
  integrity_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  assessment_artifact jsonb NOT NULL,
  assessment_hash varchar(66) NOT NULL UNIQUE,
  evaluated_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  CONSTRAINT selector_eligibility_assessments_policy_identity_idx UNIQUE (policy_id, take_identity_id),
  CONSTRAINT selector_eligibility_assessments_status_check CHECK (
    automatic_status IN ('ELIGIBLE', 'NEEDS_REVIEW', 'NOT_ELIGIBLE')
    AND final_status IN ('ELIGIBLE', 'NEEDS_REVIEW', 'NOT_ELIGIBLE')
  )
);
CREATE INDEX selector_eligibility_assessments_campaign_status_idx
  ON selector_eligibility_assessments(campaign_id, final_status);

CREATE TABLE selector_integrity_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  policy_id uuid NOT NULL REFERENCES campaign_eligibility_policies(id) ON DELETE CASCADE,
  take_identity_id uuid NOT NULL REFERENCES take_identities(id) ON DELETE RESTRICT,
  signal_type varchar(96) NOT NULL,
  evidence_family varchar(64) NOT NULL,
  strength varchar(16) NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'OBSERVED',
  public_explanation text NOT NULL,
  restricted_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  observed_at timestamptz NOT NULL,
  collected_at timestamptz NOT NULL DEFAULT now(),
  observation_hash varchar(66) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT selector_integrity_strength_check CHECK (strength IN ('WEAK', 'MODERATE', 'STRONG')),
  CONSTRAINT selector_integrity_status_check CHECK (status IN ('OBSERVED', 'NO_DATA'))
);
CREATE INDEX selector_integrity_observations_identity_idx
  ON selector_integrity_observations(policy_id, take_identity_id);

ALTER TABLE review_cases
  ADD COLUMN eligibility_policy_id uuid REFERENCES campaign_eligibility_policies(id) ON DELETE CASCADE,
  ADD COLUMN eligibility_assessment_id uuid REFERENCES selector_eligibility_assessments(id) ON DELETE CASCADE,
  ADD COLUMN subject_identity_id uuid REFERENCES take_identities(id) ON DELETE RESTRICT;

CREATE TABLE selector_evidence_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  policy_id uuid NOT NULL REFERENCES campaign_eligibility_policies(id) ON DELETE CASCADE,
  assessment_id uuid NOT NULL REFERENCES selector_eligibility_assessments(id) ON DELETE CASCADE,
  review_case_id uuid NOT NULL REFERENCES review_cases(id) ON DELETE CASCADE UNIQUE,
  submitted_by_identity_id uuid NOT NULL REFERENCES take_identities(id),
  submission_type varchar(40) NOT NULL,
  target_rule_id varchar(96),
  evidence_type varchar(64),
  explanation text NOT NULL,
  links jsonb NOT NULL DEFAULT '[]'::jsonb,
  status varchar(32) NOT NULL DEFAULT 'PENDING',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT selector_evidence_submission_type_check CHECK (
    submission_type IN ('ELIGIBILITY_APPEAL', 'NEWCOMER_APPLICATION', 'INTEGRITY_CLARIFICATION')
  ),
  CONSTRAINT selector_evidence_submission_status_check CHECK (
    status IN ('PENDING', 'MORE_INFO_REQUESTED', 'VERIFIED', 'REJECTED')
  )
);
CREATE INDEX selector_evidence_submissions_assessment_idx
  ON selector_evidence_submissions(assessment_id, status);

CREATE OR REPLACE FUNCTION prevent_locked_selector_eligibility_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE policy_state varchar(32);
DECLARE policy_key uuid;
BEGIN
  IF TG_TABLE_NAME = 'campaign_eligibility_policies' THEN
    IF TG_OP = 'INSERT' AND EXISTS (
      SELECT 1 FROM campaign_eligibility_policies
      WHERE campaign_id = NEW.campaign_id AND status = 'LOCKED'
    ) THEN
      RAISE EXCEPTION 'locked selector eligibility policies cannot be replaced';
    END IF;
    IF TG_OP <> 'INSERT' AND OLD.status = 'LOCKED' THEN
      RAISE EXCEPTION 'locked selector eligibility policies are immutable';
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  policy_key := COALESCE(NEW.policy_id, OLD.policy_id);
  SELECT status INTO policy_state FROM campaign_eligibility_policies WHERE id = policy_key;
  IF policy_state = 'LOCKED' THEN
    RAISE EXCEPTION 'selector eligibility data is immutable after lock';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER campaign_eligibility_policy_immutable_after_lock
BEFORE INSERT OR UPDATE OR DELETE ON campaign_eligibility_policies
FOR EACH ROW EXECUTE FUNCTION prevent_locked_selector_eligibility_mutation();
CREATE TRIGGER selector_assessment_immutable_after_lock
BEFORE INSERT OR UPDATE OR DELETE ON selector_eligibility_assessments
FOR EACH ROW EXECUTE FUNCTION prevent_locked_selector_eligibility_mutation();
CREATE TRIGGER selector_integrity_immutable_after_lock
BEFORE INSERT OR UPDATE OR DELETE ON selector_integrity_observations
FOR EACH ROW EXECUTE FUNCTION prevent_locked_selector_eligibility_mutation();
CREATE TRIGGER selector_submission_immutable_after_lock
BEFORE INSERT OR UPDATE OR DELETE ON selector_evidence_submissions
FOR EACH ROW EXECUTE FUNCTION prevent_locked_selector_eligibility_mutation();

CREATE OR REPLACE FUNCTION prevent_locked_selector_review_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE policy_state varchar(32);
BEGIN
  SELECT p.status INTO policy_state
  FROM review_cases c
  JOIN campaign_eligibility_policies p ON p.id = c.eligibility_policy_id
  WHERE c.id = COALESCE(NEW.review_case_id, OLD.review_case_id);
  IF policy_state = 'LOCKED' THEN
    RAISE EXCEPTION 'selector eligibility reviews are immutable after lock';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER selector_review_events_immutable_after_lock
BEFORE INSERT OR UPDATE OR DELETE ON review_case_events
FOR EACH ROW EXECUTE FUNCTION prevent_locked_selector_review_mutation();
CREATE TRIGGER selector_review_decisions_immutable_after_lock
BEFORE INSERT OR UPDATE OR DELETE ON review_decisions
FOR EACH ROW EXECUTE FUNCTION prevent_locked_selector_review_mutation();

CREATE OR REPLACE FUNCTION prevent_locked_selector_review_case_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE policy_state varchar(32);
DECLARE policy_key uuid;
BEGIN
  policy_key := COALESCE(NEW.eligibility_policy_id, OLD.eligibility_policy_id);
  IF policy_key IS NULL THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  SELECT status INTO policy_state FROM campaign_eligibility_policies WHERE id = policy_key;
  IF policy_state = 'LOCKED' THEN
    RAISE EXCEPTION 'selector eligibility review cases are immutable after lock';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER selector_review_cases_immutable_after_lock
BEFORE INSERT OR UPDATE OR DELETE ON review_cases
FOR EACH ROW EXECUTE FUNCTION prevent_locked_selector_review_case_mutation();
