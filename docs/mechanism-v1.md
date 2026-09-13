# TAKE Mechanism V1

## Domain Packages

- `packages/mechanism` contains pure schemas, canonical hashing, evidence evaluation, Merkle proofs, graph observations, reciprocity handling, deterministic randomness, and allocation strategies.
- `packages/mechanism-simulator` contains deterministic honest and attack scenarios, metrics, kill criteria, a CLI, and optional Postgres persistence.
- `apps/api` owns authorization, provider calls, snapshot lifecycle, canonical chain projection, reviews, drand retrieval, and HTTP presentation.

The pure package has no database, provider, or HTTP dependency. The same serialization and strategy code is used by API execution, tests, and simulation.

## Versioned Configuration

`CampaignMechanismConfigV1` commits to:

- mechanism, evidence, evaluator, and graph versions;
- campaign and organization IDs;
- selector/recipient overlap policy;
- one-TAKE nomination limit;
- separate typed nominator and recipient policies;
- reject-later direct reciprocity;
- allocation strategy and resource quantity;
- evidence cutoff;
- randomness source and committed round;
- chain, manager address, and manager version.

Policies use a finite discriminated union and a flat `allOf`. There is no organizer-supplied expression language or hidden score.

## Lifecycle

```text
DRAFT CONFIG
  -> COLLECT EVIDENCE
  -> EVALUATE NOMINATORS AND RECIPIENTS
  -> READY
  -> LOCK SNAPSHOTS AND RULES HASH
  -> PUBLISH
  -> ACTIVATE
  -> INDEX FINALIZED NOMINATIONS
  -> GRAPH SNAPSHOT
  -> VERIFIED RANDOMNESS
  -> ALLOCATION
  -> FINAL RESULT COMMITMENT
```

`PUT /campaigns/:id/mechanism-draft` creates a new immutable revision and supersedes any earlier unlocked draft. `POST /campaigns/:id/evidence-snapshots` builds both audience snapshots. `POST /campaigns/:id/mechanism/lock` rejects missing, failed, or unknown evidence and disjoint-population overlap.

## Deployment Classes

- `LEGACY_V1`: current immutable Monad testnet manager and low-assurance campaigns.
- `V2`: reserved for a separately approved hardened manager.

The API hard-rejects protected configs today, even if a client submits a structurally valid V2 config. This is intentional. No V2 deployment has been approved.

## Public APIs

- `GET /campaigns/:id/mechanism`
- `GET /campaigns/:id/eligibility/me`
- `GET /campaigns/:id/eligibility/proof?audience=NOMINATOR|RECIPIENT`
- `GET /campaigns/:id/audit-artifact`
- `GET /campaigns/:id/graph-snapshot` (redacted aggregate only)

The proof route returns only the authenticated user's membership. A selected external recipient proof is resolved server-side inside nomination preparation; arbitrary external identity enumeration is not exposed.

## Organizer And Internal APIs

- mechanism draft, snapshot build/detail, and lock routes;
- organization allowlist create/member/lock routes;
- Discord integration routes;
- restricted review case routes;
- internal graph analysis, drand retrieval, and indexer controls;
- authorized allocation and finalization preparation routes.

Only organization owners and admins may mutate policy, collect restricted snapshot detail, lock, review, allocate, or finalize.
