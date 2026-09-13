ALTER TABLE eligibility_snapshot_members
  ADD COLUMN canonical_subject_key varchar(66);

UPDATE eligibility_snapshot_members
SET canonical_subject_key = subject_key
WHERE canonical_subject_key IS NULL;

ALTER TABLE eligibility_snapshot_members
  ALTER COLUMN canonical_subject_key SET NOT NULL;

CREATE INDEX eligibility_snapshot_members_canonical_subject_idx
  ON eligibility_snapshot_members(snapshot_id, canonical_subject_key);
