import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "@take/database";
import { schema } from "@take/database";
import { buildGiveTakeCall, takeCampaignManagerAbi } from "@take/chain";
import { CampaignStatus, normalizeAddress, prepareNominationSchema, submitNominationTransactionSchema } from "@take/shared";
import type { z } from "zod";
import { decodeFunctionData, type Address, type Hex, type PublicClient } from "viem";
import { ServiceError } from "./errors.js";
import type { ApiEnv } from "../config/env.js";
import { EligibilitySnapshotService } from "./eligibilitySnapshots.js";
import type { NominationValidityReasonV0 } from "@take/mechanism";

type PrepareNominationInput = z.infer<typeof prepareNominationSchema>;
type SubmitNominationTransactionInput = z.infer<typeof submitNominationTransactionSchema>;

export class NominationService {
  private readonly snapshots: EligibilitySnapshotService;

  constructor(
    private readonly db: Database,
    env: ApiEnv
  ) {
    this.snapshots = new EligibilitySnapshotService(db, env);
  }

  async prepare(
    campaignId: string,
    giverIdentityId: string,
    giverProtocolIdentityKey: string,
    contractAddress: string,
    chainId: number,
    input: PrepareNominationInput
  ) {
    try {
      return await this.prepareUnchecked(
        campaignId,
        giverIdentityId,
        giverProtocolIdentityKey,
        contractAddress,
        chainId,
        input
      );
    } catch (error) {
      await this.recordRejectedAttempt({
        campaignId,
        giverIdentityId,
        giverProtocolIdentityKey,
        input,
        reason: objectiveReason(error)
      }).catch(() => undefined);
      throw error;
    }
  }

  private async prepareUnchecked(
    campaignId: string,
    giverIdentityId: string,
    giverProtocolIdentityKey: string,
    contractAddress: string,
    chainId: number,
    input: PrepareNominationInput
  ) {
    const [campaign] = await this.db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, campaignId))
      .limit(1);

    if (!campaign) {
      throw new ServiceError("CAMPAIGN_NOT_FOUND", "Campaign not found", 404);
    }
    if (campaign.status !== CampaignStatus.ACTIVE) {
      throw new ServiceError("INVALID_CAMPAIGN_STATE", "Campaign is not active", 409);
    }

    const now = new Date();
    if (now < campaign.startTime || now >= campaign.endTime) {
      throw new ServiceError("INVALID_CAMPAIGN_STATE", "Campaign is outside nomination window", 409);
    }
    if (!campaign.onchainCampaignId) {
      throw new ServiceError("INVALID_CAMPAIGN_STATE", "Campaign is not published onchain", 409);
    }
    const onchainCampaignId = campaign.onchainCampaignId;
    const experiment = campaign.experimentId
      ? await this.db.select().from(schema.campaignExperiments)
          .where(eq(schema.campaignExperiments.id, campaign.experimentId)).limit(1)
          .then((rows) => rows[0])
      : undefined;
    if (campaign.experimentId && experiment?.status !== "LOCKED") {
      throw new ServiceError("INVALID_CAMPAIGN_STATE", "The V0 experiment protocol is not locked", 409);
    }

    const nominatorProof = campaign.mechanismConfigId
      ? await this.snapshots.getProof({
          campaignId,
          audience: "NOMINATOR",
          takeIdentityId: giverIdentityId
        })
      : null;
    const effectiveContractAddress = campaign.managerContractAddress ?? contractAddress;
    const effectiveChainId = campaign.chainId ?? chainId;

    return this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(schema.nominations)
        .where(eq(schema.nominations.idempotencyKey, input.idempotencyKey))
        .limit(1);

      if (existing && (existing.campaignId !== campaignId || existing.giverIdentityId !== giverIdentityId)) {
        throw new ServiceError(
          "IDEMPOTENCY_KEY_REUSED",
          "This idempotency key belongs to a different nomination request",
          409
        );
      }
      if (experiment && !existing) {
        const [used] = await tx
          .select({ id: schema.nominations.id })
          .from(schema.nominations)
          .where(and(
            eq(schema.nominations.campaignId, campaignId),
            eq(schema.nominations.giverIdentityId, giverIdentityId),
            inArray(schema.nominations.status, [
              "AWAITING_SIGNATURE",
              "SUBMITTED",
              "CHAIN_CONFIRMED",
              "INDEXING_DELAYED",
              "CONFIRMED"
            ])
          ))
          .limit(1);
        if (used) {
          throw new ServiceError(
            "SECOND_TAKE_FROM_CANONICAL_GIVER",
            "This canonical giver has already used their one TAKE",
            409
          );
        }
      }

      if (input.recipient.type === "take_identity") {
        if (existing && (
          existing.recipientTakeIdentityId !== input.recipient.takeIdentityId
          || existing.recipientExternalIdentityId !== null
        )) {
          throw new ServiceError(
            "IDEMPOTENCY_KEY_REUSED",
            "This idempotency key belongs to a different nomination recipient",
            409
          );
        }
        if (input.recipient.takeIdentityId === giverIdentityId) {
          throw new ServiceError("KNOWN_CANONICAL_SELF_NOMINATION", "Self nomination is not allowed", 409);
        }

        const [recipientIdentity] = await tx
          .select()
          .from(schema.takeIdentities)
          .where(eq(schema.takeIdentities.id, input.recipient.takeIdentityId))
          .limit(1);
        if (!recipientIdentity) {
          throw new Error("Recipient identity not found");
        }
        const recipientProof = campaign.mechanismConfigId
          ? await this.snapshots.getProof({
              campaignId,
              audience: "RECIPIENT",
              takeIdentityId: input.recipient.takeIdentityId
            })
          : null;
        if (!experiment) {
          await this.assertNoDirectReciprocity(
            campaignId,
            giverProtocolIdentityKey,
            recipientIdentity.protocolIdentityKey
          );
        }

        const nomination = existing ?? (await tx
          .insert(schema.nominations)
          .values({
            campaignId,
            giverIdentityId,
            experimentId: experiment?.id,
            nominatorSnapshotId: experiment?.giverSnapshotId,
            recipientSnapshotId: experiment?.recipientSnapshotId,
            recipientTakeIdentityId: input.recipient.takeIdentityId,
            idempotencyKey: input.idempotencyKey,
            status: "AWAITING_SIGNATURE"
          })
          .returning())[0];
        if (!nomination) throw new Error("Failed to create nomination");
        if (experiment && !existing) {
          await tx.insert(schema.nominationAttempts).values({
            campaignId,
            experimentId: experiment.id,
            giverIdentityId,
            giverCanonicalKey: giverProtocolIdentityKey.toLowerCase(),
            recipientTakeIdentityId: input.recipient.takeIdentityId,
            recipientCanonicalKey: recipientIdentity.protocolIdentityKey.toLowerCase(),
            idempotencyKey: input.idempotencyKey,
            accepted: true,
            reasonCode: "VALID"
          });
        }

        return {
          nomination,
          transaction: buildGiveTakeCall({
            contractAddress: effectiveContractAddress as Address,
            chainId: effectiveChainId,
            campaignId: onchainCampaignId,
            giverProtocolIdentityKey: giverProtocolIdentityKey as Hex,
            recipientIdentityKey: recipientIdentity.protocolIdentityKey as Hex,
            nominatorProof: (nominatorProof?.proof ?? []) as Hex[],
            recipientProof: (recipientProof?.proof ?? []) as Hex[]
          })
        };
      }

      const [external] = await tx
        .select()
        .from(schema.externalIdentities)
        .where(eq(schema.externalIdentities.id, input.recipient.externalIdentityId))
        .limit(1);

      if (!external) {
        throw new ServiceError("EXTERNAL_RECIPIENT_NOT_FOUND", "External recipient was not issued by TAKE", 404);
      }
      if (existing && (
        existing.recipientExternalIdentityId !== external.id
        || existing.recipientTakeIdentityId !== null
      )) {
        throw new ServiceError(
          "IDEMPOTENCY_KEY_REUSED",
          "This idempotency key belongs to a different nomination recipient",
          409
        );
      }

      const [linkedSelf] = await tx
        .select()
        .from(schema.externalIdentities)
        .where(
          and(
            eq(schema.externalIdentities.id, external.id),
            eq(schema.externalIdentities.takeIdentityId, giverIdentityId)
          )
        )
        .limit(1);

      if (linkedSelf) {
        throw new ServiceError("KNOWN_CANONICAL_SELF_NOMINATION", "Self nomination is not allowed", 409);
      }
      const recipientProof = campaign.mechanismConfigId
        ? await this.snapshots.getProof({
            campaignId,
            audience: "RECIPIENT",
            takeIdentityId: giverIdentityId,
            externalIdentityId: external.id
          })
        : null;
      const canonicalRecipientKey = external.takeIdentityId
        ? (await tx
            .select({ key: schema.takeIdentities.protocolIdentityKey })
            .from(schema.takeIdentities)
            .where(eq(schema.takeIdentities.id, external.takeIdentityId))
            .limit(1))[0]?.key ?? external.externalIdentityKey
        : external.externalIdentityKey;
      if (!experiment) {
        await this.assertNoDirectReciprocity(
          campaignId,
          giverProtocolIdentityKey,
          canonicalRecipientKey
        );
      }

      const nomination = existing ?? (await tx
        .insert(schema.nominations)
        .values({
          campaignId,
          giverIdentityId,
          experimentId: experiment?.id,
          nominatorSnapshotId: experiment?.giverSnapshotId,
          recipientSnapshotId: experiment?.recipientSnapshotId,
          recipientExternalIdentityId: external.id,
          idempotencyKey: input.idempotencyKey,
          status: "AWAITING_SIGNATURE"
        })
        .returning())[0];
      if (!nomination) throw new Error("Failed to create nomination");
      if (experiment && !existing) {
        await tx.insert(schema.nominationAttempts).values({
          campaignId,
          experimentId: experiment.id,
          giverIdentityId,
          giverCanonicalKey: giverProtocolIdentityKey.toLowerCase(),
          recipientExternalIdentityId: external.id,
          recipientCanonicalKey: canonicalRecipientKey.toLowerCase(),
          idempotencyKey: input.idempotencyKey,
          accepted: true,
          reasonCode: "VALID"
        });
      }

      return {
        nomination,
        transaction: buildGiveTakeCall({
          contractAddress: effectiveContractAddress as Address,
          chainId: effectiveChainId,
          campaignId: onchainCampaignId,
          giverProtocolIdentityKey: giverProtocolIdentityKey as Hex,
          recipientIdentityKey: external.externalIdentityKey as Hex,
          nominatorProof: (nominatorProof?.proof ?? []) as Hex[],
          recipientProof: (recipientProof?.proof ?? []) as Hex[]
        })
      };
    });
  }

  private async recordRejectedAttempt(input: {
    campaignId: string;
    giverIdentityId: string;
    giverProtocolIdentityKey: string;
    input: PrepareNominationInput;
    reason: NominationValidityReasonV0;
  }) {
    const [campaign] = await this.db.select({ experimentId: schema.campaigns.experimentId })
      .from(schema.campaigns).where(eq(schema.campaigns.id, input.campaignId)).limit(1);
    if (!campaign?.experimentId) return;
    await this.db.insert(schema.nominationAttempts).values({
      campaignId: input.campaignId,
      experimentId: campaign.experimentId,
      giverIdentityId: input.giverIdentityId,
      giverCanonicalKey: input.giverProtocolIdentityKey.toLowerCase(),
      recipientTakeIdentityId: input.input.recipient.type === "take_identity"
        ? input.input.recipient.takeIdentityId
        : undefined,
      recipientExternalIdentityId: input.input.recipient.type === "external_identity"
        ? input.input.recipient.externalIdentityId
        : undefined,
      idempotencyKey: input.input.idempotencyKey,
      accepted: false,
      reasonCode: input.reason
    });
  }

  async recordSubmitted(input: {
    campaignId: string;
    nominationId: string;
    actorIdentityId: string;
    transaction: SubmitNominationTransactionInput;
    chainId: number;
    contractAddress: string;
    publicClient: PublicClient;
  }) {
    const [nomination] = await this.db
      .select({
        id: schema.nominations.id,
        campaignId: schema.nominations.campaignId,
        giverIdentityId: schema.nominations.giverIdentityId,
        status: schema.nominations.status,
        recipientTakeIdentityId: schema.nominations.recipientTakeIdentityId,
        recipientExternalIdentityId: schema.nominations.recipientExternalIdentityId,
        onchainCampaignId: schema.campaigns.onchainCampaignId,
        giverKey: schema.takeIdentities.protocolIdentityKey,
        managerContractAddress: schema.campaigns.managerContractAddress,
        campaignChainId: schema.campaigns.chainId
      })
      .from(schema.nominations)
      .innerJoin(schema.campaigns, eq(schema.campaigns.id, schema.nominations.campaignId))
      .innerJoin(schema.takeIdentities, eq(schema.takeIdentities.id, schema.nominations.giverIdentityId))
      .where(
        and(
          eq(schema.nominations.id, input.nominationId),
          eq(schema.nominations.campaignId, input.campaignId),
          eq(schema.nominations.giverIdentityId, input.actorIdentityId)
        )
      )
      .limit(1);
    if (!nomination || !nomination.onchainCampaignId) {
      throw new ServiceError("NOMINATION_NOT_FOUND", "Nomination does not belong to the authenticated actor and campaign", 404);
    }
    if (!["AWAITING_SIGNATURE", "SUBMITTED"].includes(nomination.status)) {
      throw new ServiceError("NOMINATION_NOT_SUBMITTABLE", "Nomination is not awaiting this transaction", 409);
    }

    const recipientKey = await this.recipientIdentityKey(nomination);
    const chainTransaction = await input.publicClient
      .getTransaction({ hash: input.transaction.transactionHash as Hex })
      .catch(() => undefined);
    if (!chainTransaction) {
      throw new ServiceError("TRANSACTION_NOT_FOUND", "The submitted transaction is not available from the configured RPC", 409);
    }
    const expectedManager = normalizeAddress(nomination.managerContractAddress ?? input.contractAddress);
    if (nomination.campaignChainId && nomination.campaignChainId !== input.chainId) {
      throw new ServiceError("TRANSACTION_CHAIN_MISMATCH", "Submitted transaction chain does not match the campaign", 400);
    }
    if (!chainTransaction.to || normalizeAddress(chainTransaction.to) !== expectedManager) {
      throw new ServiceError("TRANSACTION_DESTINATION_MISMATCH", "Transaction was not sent to the TAKE campaign manager", 400);
    }
    if (input.transaction.fromAddress && normalizeAddress(input.transaction.fromAddress) !== normalizeAddress(chainTransaction.from)) {
      throw new ServiceError("TRANSACTION_SENDER_MISMATCH", "Reported transaction sender does not match the chain transaction", 400);
    }
    const [ownedWallet] = await this.db
      .select({ id: schema.wallets.id })
      .from(schema.wallets)
      .where(
        and(
          eq(schema.wallets.takeIdentityId, input.actorIdentityId),
          eq(schema.wallets.address, normalizeAddress(chainTransaction.from)),
          eq(schema.wallets.isActive, true)
        )
      )
      .limit(1);
    if (!ownedWallet) {
      throw new ServiceError("TRANSACTION_SENDER_NOT_AUTHORIZED", "Transaction sender is not an active wallet for this TAKE identity", 403);
    }
    let decoded: { functionName: string; args?: readonly unknown[] };
    try {
      decoded = decodeFunctionData({
        abi: takeCampaignManagerAbi,
        data: chainTransaction.input
      });
    } catch {
      throw new ServiceError("TRANSACTION_CALLDATA_INVALID", "Transaction calldata is not a TAKE nomination", 400);
    }
    if (decoded.functionName !== "giveTake" || !decoded.args) {
      throw new ServiceError("TRANSACTION_CALLDATA_INVALID", "Transaction does not call giveTake", 400);
    }
    const args = decoded.args as readonly [bigint, Hex, Hex, readonly Hex[], readonly Hex[]];
    if (
      args[0] !== nomination.onchainCampaignId
      || args[1].toLowerCase() !== nomination.giverKey.toLowerCase()
      || args[2].toLowerCase() !== recipientKey.toLowerCase()
    ) {
      throw new ServiceError("TRANSACTION_NOMINATION_MISMATCH", "Transaction campaign, giver, or recipient does not match the prepared nomination", 400);
    }

    return this.db.transaction(async (tx) => {
      await tx
        .insert(schema.chainTransactions)
        .values({
          chainId: input.chainId,
          transactionHash: input.transaction.transactionHash,
          fromAddress: normalizeAddress(chainTransaction.from),
          toAddress: expectedManager,
          status: "SUBMITTED",
          submittedAt: new Date()
        })
        .onConflictDoNothing();

      const [nomination] = await tx
        .update(schema.nominations)
        .set({
          chainId: input.chainId,
          transactionHash: input.transaction.transactionHash,
          status: "SUBMITTED",
          submittedAt: new Date()
        })
        .where(
          and(
            eq(schema.nominations.id, input.nominationId),
            eq(schema.nominations.campaignId, input.campaignId),
            eq(schema.nominations.giverIdentityId, input.actorIdentityId)
          )
        )
        .returning();

      if (!nomination) {
        throw new Error("Nomination not found");
      }

      return nomination;
    });
  }

  private async recipientIdentityKey(nomination: {
    recipientTakeIdentityId: string | null;
    recipientExternalIdentityId: string | null;
  }) {
    if (nomination.recipientTakeIdentityId) {
      const [identity] = await this.db
        .select({ key: schema.takeIdentities.protocolIdentityKey })
        .from(schema.takeIdentities)
        .where(eq(schema.takeIdentities.id, nomination.recipientTakeIdentityId))
        .limit(1);
      if (identity) return identity.key as Hex;
    }
    if (nomination.recipientExternalIdentityId) {
      const [identity] = await this.db
        .select({ key: schema.externalIdentities.externalIdentityKey })
        .from(schema.externalIdentities)
        .where(eq(schema.externalIdentities.id, nomination.recipientExternalIdentityId))
        .limit(1);
      if (identity) return identity.key as Hex;
    }
    throw new ServiceError("RECIPIENT_IDENTITY_MISSING", "Prepared recipient identity no longer exists", 409);
  }

  private async assertNoDirectReciprocity(
    campaignId: string,
    giverCanonicalKey: string,
    recipientCanonicalKey: string
  ) {
    const [reverse] = await this.db
      .select({ id: schema.nominationEdges.id })
      .from(schema.nominationEdges)
      .where(
        and(
          eq(schema.nominationEdges.campaignId, campaignId),
          eq(schema.nominationEdges.canonicalGiverKey, recipientCanonicalKey.toLowerCase()),
          eq(schema.nominationEdges.canonicalRecipientKey, giverCanonicalKey.toLowerCase()),
          eq(schema.nominationEdges.validity, "VALID"),
          eq(schema.nominationEdges.finalityStatus, "FINALIZED")
        )
      )
      .limit(1);
    if (reverse) {
      throw new ServiceError(
        "DIRECT_RECIPROCITY",
        "A direct reverse TAKE is not permitted in this campaign",
        409
      );
    }
  }

  async markChainConfirmed(nominationId: string, blockNumber: bigint) {
    return this.db.transaction(async (tx) => {
      const [nomination] = await tx
        .update(schema.nominations)
        .set({
          status: "CHAIN_CONFIRMED",
          blockNumber,
          confirmedAt: new Date()
        })
        .where(eq(schema.nominations.id, nominationId))
        .returning();

      if (!nomination?.transactionHash) {
        throw new Error("Submitted nomination not found");
      }

      await tx
        .update(schema.chainTransactions)
        .set({
          status: "CHAIN_CONFIRMED",
          blockNumber,
          confirmedAt: new Date()
        })
        .where(eq(schema.chainTransactions.transactionHash, nomination.transactionHash));

      return nomination;
    });
  }
}

function objectiveReason(error: unknown): NominationValidityReasonV0 {
  if (error instanceof ServiceError) {
    if (error.code === "SECOND_TAKE_FROM_CANONICAL_GIVER") return "SECOND_TAKE_FROM_CANONICAL_GIVER";
    if (error.code === "KNOWN_CANONICAL_SELF_NOMINATION") return "KNOWN_CANONICAL_SELF_NOMINATION";
    if (error.code === "NOT_ELIGIBLE") return "GIVER_NOT_ELIGIBLE";
    if (error.code === "ELIGIBILITY_NOT_LOCKED" || error.code === "LEGACY_CAMPAIGN") return "INVALID_SNAPSHOT_PROOF";
    if (error.code === "INVALID_CAMPAIGN_STATE" || error.code === "CAMPAIGN_NOT_FOUND") return "INVALID_CAMPAIGN_STATE";
  }
  return "MALFORMED_NOMINATION";
}
