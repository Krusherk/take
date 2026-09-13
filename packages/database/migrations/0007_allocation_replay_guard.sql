create unique index if not exists allocation_runs_replay_idx
  on allocation_runs (campaign_id, input_snapshot_hash, result_hash);
