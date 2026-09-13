# Campaign State Machine

## States

`DRAFT` is offchain only.

Onchain states:

- `CREATED`
- `ACTIVE`
- `CLOSED`
- `FINALIZED`
- `CANCELLED`

Application transient state:

- `ALLOCATING`

## Transitions

| From | To | Actor | Rule |
|---|---|---|---|
| `DRAFT` | `CREATED` | authorized organization owner/admin | Publish immutable campaign config onchain. |
| `CREATED` | `ACTIVE` | organizer or anyone after `startTime` if contract permits | Cannot activate before `startTime`. |
| `ACTIVE` | `CLOSED` | organizer or anyone after `endTime` if contract permits | Nominations are rejected after `endTime` regardless of explicit close. |
| `CREATED` | `CANCELLED` | organizer | Allowed before activation. |
| `ACTIVE` | `CANCELLED` | organizer | Allowed only if campaign config permits cancellation after start. V0 default should disallow cancellation after nominations exist. |
| `CLOSED` | `ALLOCATING` | API/system | Offchain calculation in progress. |
| `ALLOCATING` | `CLOSED` | API/system | Allocation failed or was abandoned; no onchain state change. |
| `CLOSED` | `FINALIZED` | organizer | Commit final result hash. |

## Irreversible Rules

- Critical rules cannot change after `CREATED`.
- A finalized campaign cannot be reopened, cancelled, or finalized again.
- `finalResultHash` cannot mutate.
- Historical nominations cannot be deleted.

## Organizer Disappears

If `endTime` passes, the contract rejects nominations even without `closeCampaign`. Anyone may call `closeCampaign` after `endTime` in v0 to advance public state. Finalization still requires the organizer, or a later explicitly designed recovery/multisig policy.

## Allocation Fails

Allocation runs are offchain records. A failed run is marked `FAILED` and never overwritten. A new run can be created from the same snapshot.

## Finalization Never Called

The campaign remains `CLOSED` with verifiable nominations. API results can show draft/provisional allocation runs, but there is no official onchain final result until finalization.
