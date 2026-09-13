ALTER TABLE randomness_artifacts
  DROP CONSTRAINT IF EXISTS randomness_artifacts_round_idx;

DROP INDEX IF EXISTS randomness_artifacts_round_idx;

CREATE UNIQUE INDEX randomness_artifacts_mechanism_idx
  ON randomness_artifacts(mechanism_config_id);

CREATE INDEX randomness_artifacts_round_lookup_idx
  ON randomness_artifacts(network, chain_hash, round);
