# TAKE MVP Experiment V0

## Primary questions

1. **Popularity dependence:** Does pre-existing visibility explain TAKE support or winners?
2. **Strategic behavior:** Do reciprocity, rings, trading, or weak-candidate incentives materially appear?
3. **Comprehension and participation:** Do people understand "one TAKE, someone else" and participate?
4. **Selector incentive design:** What behavioral differences appear between the overlapping and disjoint variants?
5. **Organizer trust:** Does the organizer accept the result and want to use TAKE again?

These questions are preregistered as primary. Other measurements are diagnostic and must not be promoted after seeing results.

## Variants

- **Variant A - Overlapping:** a rostered person may be both selector and recipient.
- **Variant B - Disjoint:** the locked snapshot builder requires selectors and recipients to be disjoint.

Comparisons are exploratory unless assignment and campaign conditions are genuinely randomized.

## Popularity proxy

The primary proxy is X follower count when it can be collected with provenance before announcement and protocol lock. If unavailable, every rostered recipient receives an organizer-familiarity rating before announcement:

- `3`: highly visible in this community
- `2`: moderately visible
- `1`: minimally visible / rarely seen
- `0`: organizer does not recognize them

This is an organizer-perception proxy, not objective popularity. It is immutable after protocol lock and never affects mechanism execution.

Reports show the selected proxy, observation and collection times, provenance, missingness, sample size, full support distribution, Spearman coefficient with bootstrap confidence interval, winner overlap, top-decile concentration, and Gini coefficient. Warning thresholds are operational heuristics, not scientific definitions.

## Minimum runnable path

Campaign -> locked protocol -> eligibility snapshots -> viewer-specific recipient discovery -> one TAKE -> canonical nomination edge -> close -> `RAW_UNIQUE_SUPPORT@2` -> result commitment -> exact replay.

The first milestone uses 10 selectors, 6 recipients, and 3 seats. Full research infrastructure follows only after this path succeeds.
