# Evidence And Eligibility V1

## Candidate Populations

- TAKE identities created by the cutoff.
- Known external identities first observed by the cutoff, scoped to X, Discord, or GitHub.
- A locked organizer allowlist.
- Open external recipients for explicitly low-assurance campaigns only.

Nominators and recipients are resolved independently. Canonical aliases are deduplicated before evaluation. A disjoint mechanism cannot lock if one canonical identity appears in both eligible sets.

## Implemented Rules

- TAKE account required.
- X connected, created before a date, or minimum account age.
- Discord connected, account creation date/age from Snowflake, guild member, joined before, and required role IDs.
- GitHub connected.
- Wallet connected and TAKE-observed first-seen cutoff.
- TAKE-member recipient or explicitly allowed external recipient provider.
- Locked organizer Merkle allowlist.

`WALLET_MIN_ACTIVE_MONTHS` with chain history and proof-of-human rules are typed adapters but yield unavailable evidence until a credible provider is configured. They must not be enabled in a lockable policy yet.

## Evidence Semantics

Each observation stores source, fact, canonical subject, scope, value or error, provider time, TAKE observation time, provenance, retention class, payload hash, and evidence hash. Deduplication is deterministic.

Historical social and wallet rows preserve first and last observation when an account is unlinked. V1 can prove that TAKE had observed a connection by the cutoff; it does not reconstruct every active/inactive interval. Policy language and public copy must not overstate that fact.

Provider outcomes are interpreted as follows:

- Verified fact that fails a rule: `FAIL` with a stable public reason.
- Provider outage, malformed response, missing integration, or unsupported source: `UNKNOWN`.
- Every rule passes: subject `PASS` and one Merkle membership leaf.

A required `UNKNOWN` makes the snapshot fail to become lock-ready. Operators must resolve the provider problem and build a new snapshot; they must not turn `UNKNOWN` into `FAIL` or silently waive it.

## Merkle Format

- Leaves are sorted unique raw `bytes32` canonical identity keys.
- Pair hashing sorts the two `bytes32` values before `keccak256`.
- An odd final node is promoted unchanged.
- Proof generation and verification live in `@take/mechanism` and match `TakeCampaignManager`.

Public APIs expose a user's proof, root, and outcome. Complete candidate artifacts, restricted evidence, and per-subject graph evidence are organizer-only.

## Provider Requirements

X account creation evidence requires `X_API_BEARER_TOKEN` and X API v2 user lookup with `created_at`. Without it, age rules remain `UNKNOWN`.

Discord guild rules require the TAKE bot installation described in [Discord Evidence](discord-evidence.md). GitHub connectivity is based on the verified Privy binding only; no GitHub activity or popularity data is collected.
