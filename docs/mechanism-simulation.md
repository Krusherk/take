# TAKE Experiment V0 Simulation

## Scope

The simulator evaluates allocation behavior. It does not claim that Privy, X, Discord, wallets, or the eligibility rules prove one human per identity.

The V0 catalog covers honest uniform and latent-quality choices, dense and sparse communities, popularity skew, newcomers, low-visibility recipients, overlapping and disjoint populations, eligible-identity attacks, candidate splitting, reciprocal pairs, short cycles, repeated coalitions, synchronized bursts, and late coordination. Common-funder, funding-ancestry, and wallet-sequence analysis remain `NOT_RUN` without complete historical data.

`RAW_UNIQUE_SUPPORT@2` is the only production-eligible V0 strategy. Threshold lottery, linear PPS, and capped-support PPS are simulator-only.

## Metric Boundaries

- **Influence conservation:** `m` additional valid canonical givers may add at most `m` raw support units.
- **Matched-coalition parity:** equally sized valid coalitions produce equal raw support before allocation.
- **Seat capture:** reports the expected seat share obtained as eligible identities are added.
- **Allocation sensitivity:** separately reports candidate splitting, weak-candidate incentives, density effects, and monotonicity.

Passing influence conservation does not establish Sybil resistance. Identity integrity and seat capture remain separate questions.

Popularity diagnostics report the preregistered proxy, sample size, missingness, full support distribution, Spearman coefficient, bootstrap interval, winner overlap, top-decile seat share, and Gini coefficient. These are diagnostic and never allocation inputs.

## Current 10,000-Run Result

The current CI artifact is [mechanism-experiment-v0-simulation-ci.json](mechanism-experiment-v0-simulation-ci.json), with report hash:

```text
0x4b4fb86a774e2cb07b303218fd4c513c2b3822724d8557a3afebf05edd509fa1
```

`RAW_UNIQUE_SUPPORT@2`:

- passes valid-identity influence conservation at exactly `1.0` support unit per added identity;
- reaches 25% and 50% seat share at eight additional eligible identities in the two-seat attack scenario;
- cannot reach 100% because that scenario contains one attacker-owned recipient;
- fails candidate splitting with measured gain `1.0` against a `0.05` gate;
- fails the overlapping weak-candidate criterion with measured gain `0.6597` against a `0.02` gate;
- is therefore not a release candidate under the full research gates, despite being the only production-configurable V0 baseline.

All three simulator-only strategies also fail candidate splitting. None is promoted to production.

The synthetic popularity-skew scenario reports Spearman `1.0`, 95% bootstrap interval `[1.0, 1.0]`, winner overlap `1.0`, top-decile seat share `0.25`, support Gini `0.4983`, and sample size `10`. This validates the reporting path; it is not an empirical claim about a real TAKE community.

## Historical Artifacts

`mechanism-v1-simulation-ci.json` and `mechanism-v1-simulation-release.json` predate V0 and use the rejected zero-baseline `SYBIL_SUPERLINEARITY` metric. They are retained only for provenance and must not be cited as current V0 findings.

## Reproduction

```bash
pnpm mechanism:simulate -- --runs 10000 --output docs/mechanism-experiment-v0-simulation-ci.json
```

Every scenario/run seed is domain-separated and replayable. The report records complete strategy configurations, scenario outputs, capture curves, criteria, and its canonical report hash.
