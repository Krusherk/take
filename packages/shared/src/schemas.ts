import { z } from "zod";
import {
  CampaignStatus,
  EligibilityMode,
  NominationStatus,
  NominationVisibilityMode
} from "./enums.js";

export const hex32Schema = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
export const evmAddressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/);

export const campaignStatusSchema = z.enum(CampaignStatus);
export const eligibilityModeSchema = z.enum(EligibilityMode);
export const nominationVisibilityModeSchema = z.enum(NominationVisibilityMode);
export const nominationStatusSchema = z.enum(NominationStatus);

export const createCampaignSchema = z.object({
  organizationId: z.uuid(),
  title: z.string().min(1).max(160),
  description: z.string().max(5000).optional(),
  resource: z.object({
    type: z.string().min(1).max(64),
    name: z.string().min(1).max(160),
    description: z.string().max(2000).optional(),
    quantity: z.number().int().positive(),
    unitValue: z.string().optional(),
    chain: z.string().optional(),
    contractAddress: evmAddressSchema.optional(),
    tokenId: z.string().optional(),
    claimInstructions: z.string().optional()
  }),
  startTime: z.coerce.date(),
  endTime: z.coerce.date(),
  nominationLimit: z.literal(1).default(1),
  nominatorEligibilityMode: eligibilityModeSchema.default(EligibilityMode.OPEN_REGISTERED),
  recipientEligibilityMode: eligibilityModeSchema.default(EligibilityMode.EXTERNAL_ALLOWED),
  nominationVisibilityMode: nominationVisibilityModeSchema.default(NominationVisibilityMode.PUBLIC)
});

export const prepareNominationSchema = z.object({
  idempotencyKey: z.uuid(),
  recipient: z.discriminatedUnion("type", [
    z.object({ type: z.literal("take_identity"), takeIdentityId: z.uuid() }),
    z.object({
      type: z.literal("external_identity"),
      externalIdentityId: z.uuid()
    })
  ])
});

export const submitNominationTransactionSchema = z.object({
  transactionHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  fromAddress: evmAddressSchema.optional()
});
