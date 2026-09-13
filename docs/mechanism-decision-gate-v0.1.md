| STRATEGY | POPULATION MODE | QUALITY RECOVERY | POPULARITY | CANDIDATE SPLITTING | CARTEL SEAT CAPTURE | WEAK-CANDIDATE INCENTIVE | VOLATILITY | EXPLAINABILITY | PARAMETER SENSITIVITY | VERDICT |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| RAW_UNIQUE_SUPPORT@2 | OVERLAPPING + DISJOINT | 100.0% | support rho 1.000; seat rho 0.855; top-decile 25.0% | +0.333 seat share; best [10, 10] | m=25: 40.0% expected; P(majority) 0.0% | overlap +0.660 seats; disjoint +0 | stability 100.0%; m=25 variance 0.000 | 100.0% | No tunable parameter. | **CONTROL ONLY** |
| THRESHOLD_UNIFORM_LOTTERY@1(minimumSupport=2) | OVERLAPPING + DISJOINT | 61.4% | support rho 1.000; seat rho 0.286; top-decile 10.0% | +0.358 seat share; best [4, 4, 3, 3, 3, 3] | m=25: 38.5% expected; P(majority) 8.2% | overlap -0.194 seats; disjoint +0 | stability 27.0%; m=25 variance 1.496 | 100.0% | quality range 0.613-0.811 (span 0.198); splitting-gain range 0.169-0.365 (span 0.195); cartel-share range 0.300-0.386 (span 0.086) | **REJECT** |
| LINEAR_PPS_WITHOUT_REPLACEMENT@1 | OVERLAPPING + DISJOINT | 76.6% | support rho 1.000; seat rho 0.997; top-decile 22.5% | +0.095 seat share; best [4, 4, 3, 3, 3, 3] | m=25: 27.2% expected; P(majority) 1.0% | overlap -0.021 seats; disjoint +0 | stability 43.3%; m=25 variance 1.380 | 100.0% | No tunable parameter. | **PROMISING FOR MORE TESTING** |
| CAPPED_SUPPORT_PPS@1(minimumSupport=2,supportCap=3) | OVERLAPPING + DISJOINT | 63.4% | support rho 1.000; seat rho 0.304; top-decile 10.4% | +0.354 seat share; best [4, 4, 3, 3, 3, 3] | m=25: 35.9% expected; P(majority) 5.5% | overlap -0.149 seats; disjoint +0 | stability 27.1%; m=25 variance 1.463 | 100.0% | quality range 0.619-0.735 (span 0.116); splitting-gain range 0.179-0.369 (span 0.190); cartel-share range 0.275-0.385 (span 0.110) | **REJECT** |

# TAKE Mechanism Decision Gate V0.1

Canonical report hash: `0x77cbbc810c6b161aeaa35a9ecb0d3350a83b8952a8f12cc62d8450b7c9a172ca`  
Simulation runs per primary scenario: **10,000**  
Sensitivity runs per parameter/scenario: **2,500**  
Generated at: `2026-09-13T15:20:00.000Z`

## Decision

UNKNOWN: none of the modeled allocation strategies is adequate for a serious TAKE campaign.

No strategy is described as production-ready. `RAW_UNIQUE_SUPPORT@2` remains the frozen control. Overlapping selector/recipient campaigns remain experimental and low-assurance. Disjoint populations are the leading high-assurance structure because they remove the selector's direct weak-candidate self-interest, but they do not solve coalition capture or cheap identity acquisition.

The comparison is not an A/B test and does not establish causal real-user behavior. It is a deterministic synthetic mechanism analysis over identical canonical graphs.

## Frozen Baseline

- `docs/mechanism-experiment-v0-simulation-ci.json`: SHA-256 `8b600760188a01703238235deaf561e2e097f686f189ed32d4fd657a3daba357`; report hash `0x4b4fb86a774e2cb07b303218fd4c513c2b3822724d8557a3afebf05edd509fa1`
- `docs/mechanism-v1-simulation-ci.json`: SHA-256 `64de1b68fec538354f38faa419e7ecd9d0e0813a9a0555ac8e7847fcdcae3055`
- `docs/mechanism-v1-simulation-release.json`: SHA-256 `34f1edffd38efb225d1008ae3ba8626035a6361ab6b4f450ce98d417fc0a95c7`

The V0 files were not overwritten. Simulation seeds use the fixed `TAKE_SIMULATION_RUN_V1` domain, and this report records its run count, parameter family, generation time, and canonical hash.

## Engineering Verification

- Foundry regression: **16/16 passed**; existing Solidity unchanged.
- Monad testnet: existing manager `0xc3A0178B31D8844455c49988736d51A2336056e5`, campaign `2`; create, activate, TAKE, and close events finalized.
- Canonical indexer: one valid finalized edge `353161db-a57d-4c19-8344-3b9722cd322e`; graph input hash `0xe01b0115d79ad8a58e4ccaaeab6660bf37d7150aa2f2c6aabfac27181ca0ce91`.
- Graph limitation: History-dependent wallet signals are NOT_RUN because no complete wallet-history provider is configured.
- Drand: evmnet round `20597036` verified; artifact `0x5ed34ddd4fc888452b27bc87f40421441437688fcd83f5e7ab49bfffddb9dc7c`; replay checks all passed.
- Drand operational warning: the default 8000ms attempt timed out; 30000ms configuration succeeded. Relay timeout tuning remains a pilot gate.

## Decision Rules

These are operational gates fixed before the comparative run, not scientific definitions: candidate-splitting seat-share gain <= 5%; quality recovery >= 80%; expected seat share for 25 coordinated identities in a 100-selector/10-seat campaign <= 30%; and headline parameter-family range <= 15 percentage points. A strategy must satisfy all four to become a pilot candidate.

Identity influence and allocation amplification are separate. The invariant `m` additional valid canonical givers -> at most `m` new raw support units passes for every strategy. The fixed-budget test holds TAKE count constant and asks whether redistributing those TAKEs across allied recipients increases expected seats.

## Strategy Results

### RAW_UNIQUE_SUPPORT@2: CONTROL ONLY

Frozen V0 baseline; retained for comparison despite known strategic failures.

- Latent-quality recovery: **100.0%**; mean selected quality 10.500.
- Popularity: support rho **1.000** (95% CI 1.000 to 1.000); seat rho **0.855**; top-decile seat share **25.0%**; lesser-known mean selection probability **0.0%**.
- Candidate splitting: fixed 20-TAKE coalition moves from **1.000** to **2.000** expected seats; seat-share gain **33.3%**; amplification **2.000x**; best-found split `[10, 10]`.
- Weak candidate: overlapping selector expected-seat change **+0.660**; disjoint selectors change **+0** because selectors are not candidates. Disjoint strategic nominations can still reduce quality (100.0% -> 100.0%).
- Honest density: penalty **0.0%** with identical allocation inputs.
- Behavioral boundary: reciprocity signals 1; short-cycle signals 1; invalid-attempt rates 0.0% / 0.0%; late timing changed support=false, selection=false.

Coalition seat-capture curve (100 selectors, 10 seats; best-found balanced allied-recipient split):

| m | Selector share | Best split | Expected seats | Seat share | Variance | P(0 seats) | P(majority) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 1.0% | [1] | 0.000 | 0.0% | 0.000 | 100.0% | 0.0% |
| 2 | 2.0% | [2] | 0.000 | 0.0% | 0.000 | 100.0% | 0.0% |
| 3 | 3.0% | [3] | 0.000 | 0.0% | 0.000 | 100.0% | 0.0% |
| 5 | 5.0% | [5] | 0.512 | 5.1% | 0.250 | 48.8% | 0.0% |
| 8 | 8.0% | [8] | 1.000 | 10.0% | 0.000 | 0.0% | 0.0% |
| 10 | 10.0% | [5, 5] | 1.009 | 10.1% | 0.332 | 16.2% | 0.0% |
| 15 | 15.0% | [8, 7] | 2.000 | 20.0% | 0.000 | 0.0% | 0.0% |
| 20 | 20.0% | [7, 7, 6] | 3.000 | 30.0% | 0.000 | 0.0% | 0.0% |
| 25 | 25.0% | [7, 6, 6, 6] | 4.000 | 40.0% | 0.000 | 0.0% | 0.0% |

Small-campaign behavior:

| Selectors | Seats | Quality recovery | Winner stability | Support distribution |
| --- | --- | --- | --- | --- |
| 10 | 2 | 95.5% | 66.7% | 3, 2, 2, 1, 1, 1 |
| 25 | 3 | 100.0% | 100.0% | 5, 4, 4, 3, 3, 2, 2, 1, 1 |
| 50 | 5 | 100.0% | 100.0% | 6, 6, 5, 5, 5, 4, 4, 3, 3, 3, 2, 2, 1, 1 |
| 100 | 10 | 100.0% | 100.0% | 6, 6, 6, 6, 6, 5, 5, 5, 5, 5, 4, 4, 4, 4, 3, 3, 3, 3, 3, 2, 2, 2, 2, 2, 1, 1, 1, 1 |

### THRESHOLD_UNIFORM_LOTTERY@1(minimumSupport=2): REJECT

Fails: fixed-budget candidate splitting, quality recovery, 25-identity cartel capture, parameter sensitivity.

- Latent-quality recovery: **61.4%**; mean selected quality 6.450.
- Popularity: support rho **1.000** (95% CI 1.000 to 1.000); seat rho **0.286**; top-decile seat share **10.0%**; lesser-known mean selection probability **40.0%**.
- Candidate splitting: fixed 20-TAKE coalition moves from **0.429** to **1.504** expected seats; seat-share gain **35.8%**; amplification **3.501x**; best-found split `[4, 4, 3, 3, 3, 3]`.
- Weak candidate: overlapping selector expected-seat change **-0.194**; disjoint selectors change **+0** because selectors are not candidates. Disjoint strategic nominations can still reduce quality (100.0% -> 70.3%).
- Honest density: penalty **0.0%** with identical allocation inputs.
- Behavioral boundary: reciprocity signals 1; short-cycle signals 1; invalid-attempt rates 0.0% / 0.0%; late timing changed support=false, selection=false.

Coalition seat-capture curve (100 selectors, 10 seats; best-found balanced allied-recipient split):

| m | Selector share | Best split | Expected seats | Seat share | Variance | P(0 seats) | P(majority) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 1.0% | [1] | 0.000 | 0.0% | 0.000 | 100.0% | 0.0% |
| 2 | 2.0% | [2] | 0.554 | 5.5% | 0.247 | 44.6% | 0.0% |
| 3 | 3.0% | [3] | 0.551 | 5.5% | 0.247 | 44.9% | 0.0% |
| 5 | 5.0% | [3, 2] | 1.058 | 10.6% | 0.467 | 20.6% | 0.0% |
| 8 | 8.0% | [2, 2, 2, 2] | 1.916 | 19.2% | 0.855 | 5.7% | 0.0% |
| 10 | 10.0% | [2, 2, 2, 2, 2] | 2.273 | 22.7% | 1.013 | 3.0% | 0.0% |
| 15 | 15.0% | [2, 2, 2, 2, 2, 2, 2, 1] | 2.930 | 29.3% | 1.245 | 0.8% | 0.9% |
| 20 | 20.0% | [2, 2, 2, 2, 2, 2, 2, 2, 2, 2] | 3.679 | 36.8% | 1.539 | 0.3% | 6.9% |
| 25 | 25.0% | [3, 3, 3, 3, 3, 2, 2, 2, 2, 2] | 3.845 | 38.5% | 1.496 | 0.1% | 8.2% |

Small-campaign behavior:

| Selectors | Seats | Quality recovery | Winner stability | Support distribution |
| --- | --- | --- | --- | --- |
| 10 | 2 | 90.8% | 55.4% | 3, 2, 2, 1, 1, 1 |
| 25 | 3 | 75.0% | 30.4% | 5, 4, 4, 3, 3, 2, 2, 1, 1 |
| 50 | 5 | 73.0% | 28.1% | 6, 6, 5, 5, 5, 4, 4, 3, 3, 3, 2, 2, 1, 1 |
| 100 | 10 | 72.5% | 27.1% | 6, 6, 6, 6, 6, 5, 5, 5, 5, 5, 4, 4, 4, 4, 3, 3, 3, 3, 3, 2, 2, 2, 2, 2, 1, 1, 1, 1 |

### LINEAR_PPS_WITHOUT_REPLACEMENT@1: PROMISING FOR MORE TESTING

Fails: fixed-budget candidate splitting, quality recovery.

- Latent-quality recovery: **76.6%**; mean selected quality 8.039.
- Popularity: support rho **1.000** (95% CI 1.000 to 1.000); seat rho **0.997**; top-decile seat share **22.5%**; lesser-known mean selection probability **13.2%**.
- Candidate splitting: fixed 20-TAKE coalition moves from **0.762** to **1.048** expected seats; seat-share gain **9.5%**; amplification **1.375x**; best-found split `[4, 4, 3, 3, 3, 3]`.
- Weak candidate: overlapping selector expected-seat change **-0.021**; disjoint selectors change **+0** because selectors are not candidates. Disjoint strategic nominations can still reduce quality (100.0% -> 84.7%).
- Honest density: penalty **0.0%** with identical allocation inputs.
- Behavioral boundary: reciprocity signals 1; short-cycle signals 1; invalid-attempt rates 0.0% / 0.0%; late timing changed support=false, selection=false.

Coalition seat-capture curve (100 selectors, 10 seats; best-found balanced allied-recipient split):

| m | Selector share | Best split | Expected seats | Seat share | Variance | P(0 seats) | P(majority) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 1.0% | [1] | 0.142 | 1.4% | 0.122 | 85.8% | 0.0% |
| 2 | 2.0% | [1, 1] | 0.280 | 2.8% | 0.236 | 73.7% | 0.0% |
| 3 | 3.0% | [1, 1, 1] | 0.413 | 4.1% | 0.338 | 63.3% | 0.0% |
| 5 | 5.0% | [1, 1, 1, 1, 1] | 0.665 | 6.6% | 0.522 | 47.3% | 0.0% |
| 8 | 8.0% | [2, 1, 1, 1, 1, 1, 1] | 1.046 | 10.5% | 0.743 | 28.8% | 0.0% |
| 10 | 10.0% | [1, 1, 1, 1, 1, 1, 1, 1, 1, 1] | 1.304 | 13.0% | 0.910 | 20.7% | 0.0% |
| 15 | 15.0% | [2, 2, 2, 2, 2, 1, 1, 1, 1, 1] | 1.817 | 18.2% | 1.116 | 9.4% | 0.1% |
| 20 | 20.0% | [2, 2, 2, 2, 2, 2, 2, 2, 2, 2] | 2.281 | 22.8% | 1.270 | 4.5% | 0.3% |
| 25 | 25.0% | [3, 3, 3, 3, 3, 2, 2, 2, 2, 2] | 2.724 | 27.2% | 1.380 | 1.9% | 1.0% |

Small-campaign behavior:

| Selectors | Seats | Quality recovery | Winner stability | Support distribution |
| --- | --- | --- | --- | --- |
| 10 | 2 | 74.9% | 28.6% | 3, 2, 2, 1, 1, 1 |
| 25 | 3 | 75.8% | 27.3% | 5, 4, 4, 3, 3, 2, 2, 1, 1 |
| 50 | 5 | 77.3% | 27.5% | 6, 6, 5, 5, 5, 4, 4, 3, 3, 3, 2, 2, 1, 1 |
| 100 | 10 | 77.2% | 27.0% | 6, 6, 6, 6, 6, 5, 5, 5, 5, 5, 4, 4, 4, 4, 3, 3, 3, 3, 3, 2, 2, 2, 2, 2, 1, 1, 1, 1 |

### CAPPED_SUPPORT_PPS@1(minimumSupport=2,supportCap=3): REJECT

Fails: fixed-budget candidate splitting, quality recovery, 25-identity cartel capture, parameter sensitivity.

- Latent-quality recovery: **63.4%**; mean selected quality 6.662.
- Popularity: support rho **1.000** (95% CI 1.000 to 1.000); seat rho **0.304**; top-decile seat share **10.4%**; lesser-known mean selection probability **37.5%**.
- Candidate splitting: fixed 20-TAKE coalition moves from **0.428** to **1.492** expected seats; seat-share gain **35.4%**; amplification **3.481x**; best-found split `[4, 4, 3, 3, 3, 3]`.
- Weak candidate: overlapping selector expected-seat change **-0.149**; disjoint selectors change **+0** because selectors are not candidates. Disjoint strategic nominations can still reduce quality (100.0% -> 75.6%).
- Honest density: penalty **0.0%** with identical allocation inputs.
- Behavioral boundary: reciprocity signals 1; short-cycle signals 1; invalid-attempt rates 0.0% / 0.0%; late timing changed support=false, selection=false.

Coalition seat-capture curve (100 selectors, 10 seats; best-found balanced allied-recipient split):

| m | Selector share | Best split | Expected seats | Seat share | Variance | P(0 seats) | P(majority) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 1.0% | [1] | 0.000 | 0.0% | 0.000 | 100.0% | 0.0% |
| 2 | 2.0% | [2] | 0.439 | 4.4% | 0.246 | 56.1% | 0.0% |
| 3 | 3.0% | [3] | 0.568 | 5.7% | 0.245 | 43.2% | 0.0% |
| 5 | 5.0% | [3, 2] | 0.950 | 9.5% | 0.465 | 25.9% | 0.0% |
| 8 | 8.0% | [2, 2, 2, 2] | 1.522 | 15.2% | 0.806 | 12.1% | 0.0% |
| 10 | 10.0% | [2, 2, 2, 2, 2] | 1.818 | 18.2% | 0.951 | 7.8% | 0.0% |
| 15 | 15.0% | [3, 2, 2, 2, 2, 2, 2] | 2.489 | 24.9% | 1.185 | 2.3% | 0.2% |
| 20 | 20.0% | [2, 2, 2, 2, 2, 2, 2, 2, 2, 2] | 3.096 | 31.0% | 1.461 | 1.0% | 2.2% |
| 25 | 25.0% | [3, 3, 3, 3, 3, 2, 2, 2, 2, 2] | 3.591 | 35.9% | 1.463 | 0.2% | 5.5% |

Small-campaign behavior:

| Selectors | Seats | Quality recovery | Winner stability | Support distribution |
| --- | --- | --- | --- | --- |
| 10 | 2 | 92.3% | 56.0% | 3, 2, 2, 1, 1, 1 |
| 25 | 3 | 77.8% | 31.0% | 5, 4, 4, 3, 3, 2, 2, 1, 1 |
| 50 | 5 | 75.0% | 28.3% | 6, 6, 5, 5, 5, 4, 4, 3, 3, 3, 2, 2, 1, 1 |
| 100 | 10 | 74.9% | 27.6% | 6, 6, 6, 6, 6, 5, 5, 5, 5, 5, 4, 4, 4, 4, 3, 3, 3, 3, 3, 2, 2, 2, 2, 2, 1, 1, 1, 1 |

## Parameter Robustness

### THRESHOLD_UNIFORM_LOTTERY

quality range 0.613-0.811 (span 0.198); splitting-gain range 0.169-0.365 (span 0.195); cartel-share range 0.300-0.386 (span 0.086)

| Parameters | Quality | Split gain | Best split / qualified allies | Qualified candidates | Weak candidate admitted | Support-to-seat rho | Cartel m=25 | Popularity top-decile | Winner stability |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| min=1 | 61.9% | 36.2% | [4, 4, 3, 3, 3, 3] / 6 | 12 | 66.6% | -0.137 | 34.5% | 9.8% | 26.8% |
| min=2 | 61.3% | 36.5% | [4, 4, 3, 3, 3, 3] / 6 | 12 | 67.2% | -0.636 | 38.6% | 9.7% | 26.4% |
| min=3 | 66.9% | 35.7% | [4, 4, 3, 3, 3, 3] / 6 | 11 | 0.0% | 0.531 | 36.2% | 11.0% | 30.4% |
| min=5 | 71.5% | 27.2% | [5, 5, 5, 5] / 4 | 10 | 0.0% | 0.435 | 38.3% | 16.7% | 52.4% |
| min=8 | 81.1% | 16.9% | [10, 10] / 2 | 8 | 0.0% | 0.847 | 30.0% | 20.0% | 68.1% |

### CAPPED_SUPPORT_PPS

quality range 0.619-0.735 (span 0.116); splitting-gain range 0.179-0.369 (span 0.190); cartel-share range 0.275-0.385 (span 0.110)

| Parameters | Quality | Split gain | Best split / qualified allies | Qualified candidates | Weak candidate admitted | Support-to-seat rho | Cartel m=25 | Popularity top-decile | Winner stability |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| min=1, cap=2 | 62.8% | 35.5% | [4, 4, 3, 3, 3, 3] / 6 | 12 | 66.9% | 0.664 | 36.2% | 10.2% | 27.5% |
| min=1, cap=3 | 63.3% | 36.9% | [4, 4, 3, 3, 3, 3] / 6 | 12 | 54.7% | 0.091 | 34.2% | 10.1% | 27.8% |
| min=1, cap=5 | 66.2% | 27.0% | [4, 4, 3, 3, 3, 3] / 6 | 12 | 39.5% | 0.594 | 28.9% | 11.7% | 29.0% |
| min=1, cap=8 | 69.8% | 19.1% | [4, 4, 3, 3, 3, 3] / 6 | 12 | 35.6% | 0.846 | 27.5% | 13.0% | 31.7% |
| min=2, cap=2 | 61.9% | 36.5% | [4, 4, 3, 3, 3, 3] / 6 | 12 | 67.8% | -0.084 | 38.3% | 10.4% | 26.9% |
| min=2, cap=3 | 63.1% | 34.9% | [4, 4, 3, 3, 3, 3] / 6 | 12 | 53.6% | 0.207 | 35.5% | 10.6% | 27.8% |
| min=2, cap=5 | 65.6% | 27.2% | [4, 4, 3, 3, 3, 3] / 6 | 12 | 41.3% | 0.399 | 29.8% | 12.1% | 28.7% |
| min=2, cap=8 | 69.9% | 18.2% | [4, 4, 4, 4, 4] / 5 | 12 | 32.7% | 0.860 | 28.3% | 13.4% | 30.9% |
| min=3, cap=2 | 66.6% | 36.3% | [4, 4, 3, 3, 3, 3] / 6 | 11 | 0.0% | 0.217 | 36.1% | 11.2% | 30.3% |
| min=3, cap=3 | 66.3% | 35.2% | [4, 4, 3, 3, 3, 3] / 6 | 11 | 0.0% | -0.291 | 36.1% | 10.8% | 30.9% |
| min=3, cap=5 | 68.2% | 27.9% | [4, 4, 3, 3, 3, 3] / 6 | 11 | 0.0% | 0.517 | 30.9% | 11.9% | 31.1% |
| min=3, cap=8 | 71.7% | 19.4% | [4, 4, 3, 3, 3, 3] / 6 | 11 | 0.0% | 0.783 | 29.8% | 13.9% | 34.5% |
| min=5, cap=2 | 71.3% | 25.4% | [5, 5, 5, 5] / 4 | 10 | 0.0% | 0.319 | 38.4% | 16.7% | 52.0% |
| min=5, cap=3 | 71.5% | 27.6% | [5, 5, 5, 5] / 4 | 10 | 0.0% | 0.474 | 38.3% | 16.7% | 51.3% |
| min=5, cap=5 | 71.3% | 26.0% | [5, 5, 5, 5] / 4 | 10 | 0.0% | 0.193 | 38.5% | 16.4% | 52.4% |
| min=5, cap=8 | 73.5% | 17.9% | [5, 5, 5, 5] / 4 | 10 | 0.0% | 0.639 | 37.0% | 17.0% | 52.6% |

## Interpretation

- `RAW_UNIQUE_SUPPORT@2` preserves the community signal and quality well, but deterministic top-K turns recipient splitting into extra seats and produces a large overlapping weak-candidate incentive. It remains control-only.
- Threshold lottery softens small support differences only after qualification. It creates a new cliff at the threshold and lets a fixed coalition manufacture multiple qualified allies. Parameter choice materially changes quality and capture.
- Linear PPS preserves marginal support information and softens deterministic cliffs, but randomness does not remove fixed-budget splitting: separate allied candidates create multiple without-replacement draw opportunities. It also has real winner variance.
- Capped PPS limits the marginal return to concentrated popularity, but the cap makes splitting especially attractive because each allied recipient receives a fresh cap. The minimum-support and cap choices are consequential and arbitrary at this evidence level.
- Disjoint selector/recipient populations should be the default structure for any future serious test. This is a provisional synthetic conclusion, not evidence that real people will behave the same way.

## Real Pilot Gate

Foundry, live Monad indexing, and verified drand replay have been exercised. Exact V0 replay and active-support suppression were previously verified. However, no allocation alternative reaches `PILOT CANDIDATE`, so a valuable real-world campaign is not recommended. A deliberately low-value campaign may use `RAW_UNIQUE_SUPPORT@2` only if it is explicitly described as a research control and the organizer's resource/delivery commitment is defined.

## Required Properties of a Future Candidate

- Independent genuine support remains consequential and monotone.
- Redistributing a fixed coalition TAKE budget cannot materially increase expected seat control.
- Small support differences do not become deterministic opportunity cliffs.
- The rule remains legible and exactly replayable from public artifacts.
- Disjoint selectors and recipients remain compatible with the rule.
- Parameter choices are robust across small campaign sizes.

## Final Answer

**Given what we now know, what should determine the recipients of a serious TAKE campaign?** UNKNOWN: none of the modeled allocation strategies is adequate for a serious TAKE campaign.

The defensible product direction is disjoint selectors and recipients, frozen eligibility, one TAKE per canonical giver, and public replay artifacts. But the allocation rule that should convert valid support into seats is still unresolved. That is the result of this gate, not a missing marketing answer.
