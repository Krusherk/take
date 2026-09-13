# Transaction Lifecycle

## GIVE TAKE

1. Client calls `POST /campaigns/:id/nominations/prepare` with an idempotency key.
2. API verifies the Privy access token server-side.
3. `IdentityService` resolves the authenticated user to `TakeIdentity`, social accounts, and authorized wallet.
4. `CampaignService` loads campaign state.
5. `EligibilityService` checks obvious offchain eligibility and recipient policy.
6. `NominationService` resolves recipient to either `recipientTakeIdentityId` or `recipientExternalIdentityId`.
7. Service rejects obvious self-nomination using known database aliases.
8. Service creates or reuses a `PREPARING` nomination intent by idempotency key.
9. `ChainService` prepares the `giveTake(campaignId, giverProtocolIdentityKey, recipientIdentityKey, proof)` transaction payload.
10. API marks nomination `AWAITING_SIGNATURE`.
11. User signs/submits through Privy wallet UX.
12. Client reports submitted hash, or server-side Privy wallet action returns a hash when that route is used.
13. API marks chain transaction `SUBMITTED`.
14. Receipt watcher checks Monad through QuickNode.
15. If reverted, mark `FAILED`.
16. If confirmed, mark `CHAIN_CONFIRMED`.
17. The QuickNode-backed indexer scans and stores `TakeGiven`.
18. Reconciliation matches `(transactionHash, logIndex)` and marks nomination indexed.
19. Notification is created for the recipient identity.

## States

- `PREPARING`
- `AWAITING_SIGNATURE`
- `SUBMITTED`
- `CHAIN_CONFIRMED`
- `INDEXING_DELAYED`
- `CONFIRMED`
- `FAILED`

`CHAIN_CONFIRMED` means Monad accepted the event. `CONFIRMED` means the application has reconciled the chain event and indexed view.

## Retry Rules

- API preparation requires an idempotency key.
- Contract enforces nomination limit regardless of API retry behavior.
- `(transactionHash, logIndex)` is unique for indexed chain events.
- Failed signature requests do not consume a TAKE.
- Reverted transactions are recorded and do not become permanent success.

## Monad-Specific Notes

Monad uses Ethereum-compatible transaction formats and supports EIP-1559 transactions. Transactions must set chain id. Because Monad charges by gas limit, sponsorship must use constrained calldata and well-estimated gas limits.
