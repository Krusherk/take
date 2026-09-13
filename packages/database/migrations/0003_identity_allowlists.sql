CREATE TABLE identity_allowlists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name varchar(160) NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'DRAFT',
  artifact_hash varchar(66),
  created_by_identity_id uuid NOT NULL REFERENCES take_identities(id),
  locked_by_identity_id uuid REFERENCES take_identities(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  CONSTRAINT identity_allowlists_status_check CHECK (status IN ('DRAFT', 'LOCKED')),
  CONSTRAINT identity_allowlists_lock_state_check CHECK (
    (status = 'LOCKED' AND artifact_hash IS NOT NULL AND locked_by_identity_id IS NOT NULL AND locked_at IS NOT NULL)
    OR status = 'DRAFT'
  )
);

CREATE INDEX identity_allowlists_organization_idx
  ON identity_allowlists(organization_id, status);

CREATE TABLE identity_allowlist_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  allowlist_id uuid NOT NULL REFERENCES identity_allowlists(id) ON DELETE CASCADE,
  subject_key varchar(66) NOT NULL,
  take_identity_id uuid REFERENCES take_identities(id) ON DELETE SET NULL,
  external_identity_id uuid REFERENCES external_identities(id) ON DELETE SET NULL,
  source varchar(32) NOT NULL DEFAULT 'ORGANIZER',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  added_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT identity_allowlist_members_identity_check CHECK (
    NOT (take_identity_id IS NOT NULL AND external_identity_id IS NOT NULL)
  ),
  CONSTRAINT identity_allowlist_members_subject_idx UNIQUE (allowlist_id, subject_key)
);
