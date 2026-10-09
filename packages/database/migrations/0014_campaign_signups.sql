-- Sign-ups before lock: a draft campaign collects givers (and optionally
-- recipients) through a join link, then TAKE locks the lists and publishes.
CREATE TABLE campaign_signups (
  campaign_id uuid PRIMARY KEY REFERENCES campaigns(id) ON DELETE CASCADE,
  join_code varchar(32) NOT NULL UNIQUE,
  join_enabled boolean NOT NULL DEFAULT true,
  giver_allowlist_id uuid NOT NULL REFERENCES identity_allowlists(id),
  recipient_allowlist_id uuid NOT NULL REFERENCES identity_allowlists(id),
  recipient_self_join boolean NOT NULL DEFAULT false,
  min_x_account_age_days integer CHECK (min_x_account_age_days IS NULL OR min_x_account_age_days BETWEEN 1 AND 3650),
  signup_deadline timestamptz,
  status varchar(16) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSING','CLOSED','FAILED')),
  removed_identity_ids uuid[] NOT NULL DEFAULT '{}',
  auto_open_approved_by_identity_id uuid REFERENCES take_identities(id),
  close_requested_by_identity_id uuid REFERENCES take_identities(id),
  close_requested_at timestamptz,
  closed_at timestamptz,
  last_error text,
  close_report jsonb NOT NULL DEFAULT '{}'::jsonb,
  opened_notified_at timestamptz,
  created_by_identity_id uuid NOT NULL REFERENCES take_identities(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX campaign_signups_status_idx ON campaign_signups(status, signup_deadline);

-- "Tell me when the next campaign opens", left on a closed join link.
CREATE TABLE campaign_signup_interest (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  campaign_id uuid REFERENCES campaigns(id) ON DELETE SET NULL,
  take_identity_id uuid NOT NULL REFERENCES take_identities(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, take_identity_id)
);

-- One small MON transfer per identity from the TAKE server wallet, so new givers can pay gas.
CREATE TABLE gas_drips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  take_identity_id uuid NOT NULL UNIQUE REFERENCES take_identities(id) ON DELETE CASCADE,
  wallet_address varchar(42) NOT NULL,
  amount_wei numeric(78, 0) NOT NULL CHECK (amount_wei > 0),
  campaign_id uuid REFERENCES campaigns(id) ON DELETE SET NULL,
  status varchar(16) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','SENT','FAILED')),
  transaction_hash varchar(66),
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
CREATE INDEX gas_drips_created_idx ON gas_drips(created_at);

ALTER TABLE campaign_signups ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_signup_interest ENABLE ROW LEVEL SECURITY;
ALTER TABLE gas_drips ENABLE ROW LEVEL SECURITY;
