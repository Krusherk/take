import { encodeFunctionData, type Address, type Hex } from "viem";
import { takeCampaignManagerAbi } from "./takeCampaignManagerAbi.js";

export interface ContractCall {
  to: Address;
  data: Hex;
  value: "0x0";
  chainId: number;
}

export function buildRegisterIdentityCall(input: {
  contractAddress: Address;
  chainId: number;
  protocolIdentityKey: Hex;
}): ContractCall {
  return {
    to: input.contractAddress,
    data: encodeFunctionData({
      abi: takeCampaignManagerAbi,
      functionName: "registerIdentity",
      args: [input.protocolIdentityKey]
    }),
    value: "0x0",
    chainId: input.chainId
  };
}

export function buildGiveTakeCall(input: {
  contractAddress: Address;
  chainId: number;
  campaignId: bigint;
  giverProtocolIdentityKey: Hex;
  recipientIdentityKey: Hex;
  nominatorProof?: Hex[];
  recipientProof?: Hex[];
}): ContractCall {
  return {
    to: input.contractAddress,
    data: encodeFunctionData({
      abi: takeCampaignManagerAbi,
      functionName: "giveTake",
      args: [
        input.campaignId,
        input.giverProtocolIdentityKey,
        input.recipientIdentityKey,
        input.nominatorProof ?? [],
        input.recipientProof ?? []
      ]
    }),
    value: "0x0",
    chainId: input.chainId
  };
}

export function buildCreateCampaignCall(input: {
  contractAddress: Address;
  chainId: number;
  metadataHash: Hex;
  startTime: bigint;
  endTime: bigint;
  nominationLimit: number;
  nominatorEligibilityMode: number;
  recipientEligibilityMode: number;
  nominationVisibilityMode: number;
  nominatorEligibilityRoot?: Hex;
  recipientEligibilityRoot?: Hex;
  rulesHash: Hex;
  cancellableAfterStart?: boolean;
}): ContractCall {
  return {
    to: input.contractAddress,
    data: encodeFunctionData({
      abi: takeCampaignManagerAbi,
      functionName: "createCampaign",
      args: [
        {
          metadataHash: input.metadataHash,
          startTime: input.startTime,
          endTime: input.endTime,
          nominationLimit: input.nominationLimit,
          nominatorEligibilityMode: input.nominatorEligibilityMode,
          recipientEligibilityMode: input.recipientEligibilityMode,
          nominationVisibilityMode: input.nominationVisibilityMode,
          nominatorEligibilityRoot: input.nominatorEligibilityRoot ?? zeroBytes32,
          recipientEligibilityRoot: input.recipientEligibilityRoot ?? zeroBytes32,
          rulesHash: input.rulesHash,
          cancellableAfterStart: input.cancellableAfterStart ?? false
        }
      ]
    }),
    value: "0x0",
    chainId: input.chainId
  };
}

export function buildCloseCampaignCall(input: {
  contractAddress: Address;
  chainId: number;
  campaignId: bigint;
}): ContractCall {
  return {
    to: input.contractAddress,
    data: encodeFunctionData({
      abi: takeCampaignManagerAbi,
      functionName: "closeCampaign",
      args: [input.campaignId]
    }),
    value: "0x0",
    chainId: input.chainId
  };
}

export function buildFinalizeAllocationCall(input: {
  contractAddress: Address;
  chainId: number;
  campaignId: bigint;
  resultHash: Hex;
}): ContractCall {
  return {
    to: input.contractAddress,
    data: encodeFunctionData({
      abi: takeCampaignManagerAbi,
      functionName: "finalizeAllocation",
      args: [input.campaignId, input.resultHash]
    }),
    value: "0x0",
    chainId: input.chainId
  };
}

const zeroBytes32 = "0x0000000000000000000000000000000000000000000000000000000000000000";
