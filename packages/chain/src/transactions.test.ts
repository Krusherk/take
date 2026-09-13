import { decodeFunctionData } from "viem";
import { describe, expect, it } from "vitest";
import { takeCampaignManagerAbi } from "./takeCampaignManagerAbi.js";
import {
  buildCreateCampaignCall,
  buildFinalizeAllocationCall,
  buildGiveTakeCall,
} from "./transactions.js";

const manager = "0xc3A0178B31D8844455c49988736d51A2336056e5" as const;
const giver = `0x${"11".repeat(32)}` as const;
const recipient = `0x${"22".repeat(32)}` as const;
const root = `0x${"33".repeat(32)}` as const;
const resultHash = `0x${"44".repeat(32)}` as const;

describe("campaign manager transaction encoding", () => {
  it("encodes campaign, identity keys, and separate eligibility proofs", () => {
    const call = buildGiveTakeCall({
      contractAddress: manager,
      chainId: 10143,
      campaignId: 7n,
      giverProtocolIdentityKey: giver,
      recipientIdentityKey: recipient,
      nominatorProof: [root],
      recipientProof: [],
    });
    const decoded = decodeFunctionData({ abi: takeCampaignManagerAbi, data: call.data });

    expect(call).toMatchObject({ to: manager, chainId: 10143, value: "0x0" });
    expect(decoded.functionName).toBe("giveTake");
    expect(decoded.args).toEqual([7n, giver, recipient, [root], []]);
  });

  it("encodes all locked campaign commitments without substituting roots", () => {
    const call = buildCreateCampaignCall({
      contractAddress: manager,
      chainId: 10143,
      metadataHash: giver,
      startTime: 1_800_000_000n,
      endTime: 1_800_086_400n,
      nominationLimit: 1,
      nominatorEligibilityMode: 1,
      recipientEligibilityMode: 1,
      nominationVisibilityMode: 0,
      nominatorEligibilityRoot: root,
      recipientEligibilityRoot: recipient,
      rulesHash: resultHash,
    });
    const decoded = decodeFunctionData({ abi: takeCampaignManagerAbi, data: call.data });
    const campaign = (decoded.args?.[0] ?? {}) as Record<string, unknown>;

    expect(decoded.functionName).toBe("createCampaign");
    expect(campaign).toMatchObject({
      nominationLimit: 1,
      nominatorEligibilityRoot: root,
      recipientEligibilityRoot: recipient,
      rulesHash: resultHash,
    });
  });

  it("encodes the immutable allocation result commitment", () => {
    const call = buildFinalizeAllocationCall({
      contractAddress: manager,
      chainId: 10143,
      campaignId: 7n,
      resultHash,
    });
    const decoded = decodeFunctionData({ abi: takeCampaignManagerAbi, data: call.data });

    expect(decoded.functionName).toBe("finalizeAllocation");
    expect(decoded.args).toEqual([7n, resultHash]);
  });
});
