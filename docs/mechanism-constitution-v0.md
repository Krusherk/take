# TAKE Mechanism Experiment V0 Constitution

## Product rule

One eligible canonical giver receives one TAKE per campaign. A TAKE cannot be used on the giver, and each valid TAKE contributes exactly one raw support unit to one canonical recipient.

V0 pilots use rostered recipients for experimental control. This does not replace TAKE's broader ability to support external and off-platform recipients.

## Four separate records

1. **Nomination validity** records whether a TAKE satisfied objective rules frozen before participation.
2. **Allocation input** records the canonical recipient and one support unit produced by each valid canonical giver.
3. **Behavioral observation** records reciprocity, cycles, timing, coalition patterns, and other diagnostics.
4. **Allocation result** records the output of the locked allocation mechanism.

Behavioral observations do not mutate nomination validity or allocation input in V0.

> A suspicious pattern is not, by itself, permission to erase a person's choice.

> TAKE should remain useful even when some strategic real-human coordination cannot be detected.

> Research-only variables may never influence a production allocation unless a future versioned mechanism explicitly declares them as allocation inputs.

Follower count, organizer familiarity, social centrality, roles, prior contribution, popularity proxies, research labels, and behavioral diagnostics are research data. They do not affect eligibility, discovery order, nomination validity, TAKE weight, or V0 allocation.

## Information model

TAKE hides nomination-derived social proof in the product while a V0 campaign is active, including from organizers where operationally possible. V0 does not provide cryptographic ballot secrecy. Public nomination events may be reconstructed from Monad and must never be described as private, sealed, or cryptographically blinded.

## Objective validity

V0 rejects a nomination only when the giver is not eligible, its snapshot proof is invalid, the same canonical giver has already used a TAKE, the nomination is a known canonical self-nomination, the request or transaction is malformed, or the campaign is in an invalid lifecycle state.

Reciprocity, short cycles, temporal bursts, giver-set similarity, repeated coalitions, and other correlations are observational. They may create an auditable signal or review record, but they do not discount or invalidate a TAKE.

## Allocation

The production V0 strategy is `RAW_UNIQUE_SUPPORT@2`: count distinct valid canonical givers per canonical recipient, rank by support, and use committed deterministic randomness only to resolve the seat-cutoff tie. No popularity or research field is available to the allocation function.
