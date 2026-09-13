import { domainHash } from "./canonical.js";
import { DeterministicRandom } from "./prng.js";
import { compareChainOrder } from "./reciprocity.js";
import type {
  AllocationArtifactV1,
  AllocationCandidateResultV1,
  AllocationStrategyConfig,
  NominationEdgeV1
} from "./types.js";
import type { Hex } from "viem";

export interface AllocationInputV1 {
  campaignId: string;
  strategy: AllocationStrategyConfig;
  resourceQuantity: number;
  edges: readonly NominationEdgeV1[];
  randomnessSeed: Hex;
}

export interface PreparedAllocationCandidateV1 {
  recipientKey: Hex;
  uniqueSupport: number;
}

export interface PreparedAllocationV1 {
  campaignId: string;
  strategy: AllocationStrategyConfig;
  resourceQuantity: number;
  inputEdgeIds: string[];
  excludedEdges: Array<{ edgeId: string; reason: string }>;
  candidates: PreparedAllocationCandidateV1[];
  inputSnapshotHash: Hex;
}

export function allocate(input: AllocationInputV1): AllocationArtifactV1 {
  const prepared = prepareAllocation(input);
  return allocatePrepared(prepared, input.randomnessSeed);
}

export function prepareAllocation(
  input: Omit<AllocationInputV1, "randomnessSeed"> | AllocationInputV1
): PreparedAllocationV1 {
  if (!Number.isSafeInteger(input.resourceQuantity) || input.resourceQuantity <= 0) {
    throw new RangeError("resourceQuantity must be a positive safe integer");
  }

  const orderedEdges = [...input.edges].sort(compareChainOrder);
  const validEdges = orderedEdges.filter((edge) => edge.validity === "VALID");
  const excludedEdges = orderedEdges
    .filter((edge) => edge.validity === "INVALID")
    .map((edge) => ({ edgeId: edge.id, reason: edge.invalidReason ?? "INVALID_EDGE" }));
  const candidates = collectCandidates(validEdges);
  const inputSnapshotHash = allocationInputSnapshotHash({
    campaignId: input.campaignId,
    strategy: input.strategy,
    resourceQuantity: input.resourceQuantity,
    edges: orderedEdges
  });

  return {
    campaignId: input.campaignId,
    strategy: input.strategy,
    resourceQuantity: input.resourceQuantity,
    inputEdgeIds: validEdges.map((edge) => edge.id),
    excludedEdges: excludedEdges.sort((a, b) => a.edgeId.localeCompare(b.edgeId)),
    candidates,
    inputSnapshotHash
  };
}

export function runPreparedAllocationStrategy(
  prepared: PreparedAllocationV1,
  randomnessSeed: Hex
): AllocationCandidateResultV1[] {
  assertRandomnessSeed(randomnessSeed);
  return runStrategy(
    prepared.strategy,
    prepared.candidates,
    prepared.resourceQuantity,
    randomnessSeed
  );
}

export function selectPreparedRecipientKeys(
  prepared: PreparedAllocationV1,
  randomnessSeed: Hex
): Hex[] {
  assertRandomnessSeed(randomnessSeed);
  switch (prepared.strategy.strategyId) {
    case "RAW_TOP_K":
    case "RAW_UNIQUE_SUPPORT":
      return selectTopKRecipientKeys(
        prepared.candidates,
        prepared.resourceQuantity,
        randomnessSeed
      );
    case "THRESHOLD_UNIFORM_LOTTERY": {
      const random = new DeterministicRandom(randomnessSeed);
      const minimumSupport = prepared.strategy.minimumSupport;
      const qualified = prepared.candidates
        .filter((candidate) => candidate.uniqueSupport >= minimumSupport)
        .sort((a, b) => a.recipientKey.localeCompare(b.recipientKey));
      return random.shuffle(qualified)
        .slice(0, prepared.resourceQuantity)
        .map((candidate) => candidate.recipientKey);
    }
    case "LINEAR_PPS_WITHOUT_REPLACEMENT":
      return selectLinearPpsRecipientKeys(
        prepared.candidates,
        prepared.resourceQuantity,
        randomnessSeed
      );
  }
}

export function allocatePrepared(
  prepared: PreparedAllocationV1,
  randomnessSeed: Hex
): AllocationArtifactV1 {
  const results = runPreparedAllocationStrategy(prepared, randomnessSeed);
  const resultHash = domainHash("TAKE_ALLOCATION_RESULT_V1", {
    campaignId: prepared.campaignId,
    strategy: prepared.strategy,
    resourceQuantity: prepared.resourceQuantity,
    inputSnapshotHash: prepared.inputSnapshotHash,
    randomnessSeed,
    results
  });

  return {
    artifactVersion: "1",
    campaignId: prepared.campaignId,
    strategy: prepared.strategy,
    resourceQuantity: prepared.resourceQuantity,
    inputEdgeIds: [...prepared.inputEdgeIds],
    excludedEdges: [...prepared.excludedEdges],
    randomnessSeed,
    results,
    inputSnapshotHash: prepared.inputSnapshotHash,
    resultHash
  };
}

export function allocationInputSnapshotHash(
  input: Omit<AllocationInputV1, "randomnessSeed">
): Hex {
  const orderedEdges = [...input.edges].sort(compareChainOrder);
  return domainHash("TAKE_ALLOCATION_INPUT_V1", {
    campaignId: input.campaignId,
    strategy: input.strategy,
    resourceQuantity: input.resourceQuantity,
    edges: orderedEdges.map(artifactEdge)
  });
}

function collectCandidates(edges: readonly NominationEdgeV1[]): PreparedAllocationCandidateV1[] {
  const candidateGivers = new Map<string, Set<string>>();
  for (const edge of edges) {
    const recipientKey = edge.canonicalRecipientKey.toLowerCase() as Hex;
    const giverKeys = candidateGivers.get(recipientKey) ?? new Set<string>();
    giverKeys.add(edge.canonicalGiverKey.toLowerCase());
    candidateGivers.set(recipientKey, giverKeys);
  }
  return [...candidateGivers.entries()].map(([recipientKey, giverKeys]) => ({
    recipientKey: recipientKey as Hex,
    uniqueSupport: giverKeys.size
  }));
}

function runStrategy(
  strategy: AllocationStrategyConfig,
  candidates: PreparedAllocationCandidateV1[],
  seats: number,
  seed: Hex
): AllocationCandidateResultV1[] {
  switch (strategy.strategyId) {
    case "RAW_TOP_K":
    case "RAW_UNIQUE_SUPPORT":
      return rankTopK(candidates, seats, seed, strategy.strategyId, strategy.strategyVersion);
    case "THRESHOLD_UNIFORM_LOTTERY":
      return thresholdLottery(candidates, seats, seed, strategy.minimumSupport);
    case "LINEAR_PPS_WITHOUT_REPLACEMENT":
      return linearPps(candidates, seats, seed);
  }
}

function rankTopK(
  candidates: PreparedAllocationCandidateV1[],
  seats: number,
  seed: Hex,
  strategyId: "RAW_TOP_K" | "RAW_UNIQUE_SUPPORT",
  strategyVersion: "1" | "2"
): AllocationCandidateResultV1[] {
  const ranked = candidates
    .map((candidate) => ({
      candidate,
      tieBreaker: domainHash("TAKE_ALLOCATION_TIE_V1", { seed, recipientKey: candidate.recipientKey })
    }))
    .sort((left, right) => {
      const supportDifference = right.candidate.uniqueSupport - left.candidate.uniqueSupport;
      return supportDifference || left.tieBreaker.localeCompare(right.tieBreaker);
    });

  return ranked.map(({ candidate, tieBreaker }, index) => ({
    recipientKey: candidate.recipientKey,
    uniqueSupport: candidate.uniqueSupport,
    selected: index < seats,
    rank: index + 1,
    selectionOrder: index < seats ? index + 1 : undefined,
    tieBreaker,
    explanation: {
      strategyId,
      strategyVersion,
      uniqueSupport: candidate.uniqueSupport,
      tieBreaker
    }
  }));
}

function selectTopKRecipientKeys(
  candidates: PreparedAllocationCandidateV1[],
  seats: number,
  seed: Hex
): Hex[] {
  const seatCount = Math.min(seats, candidates.length);
  if (seatCount === 0) return [];
  const bySupport = [...candidates].sort((left, right) => right.uniqueSupport - left.uniqueSupport);
  const cutoffSupport = bySupport[seatCount - 1]!.uniqueSupport;
  const guaranteed = bySupport.filter((candidate) => candidate.uniqueSupport > cutoffSupport);
  const cutoffGroup = bySupport.filter((candidate) => candidate.uniqueSupport === cutoffSupport);
  const remaining = seatCount - guaranteed.length;
  if (remaining >= cutoffGroup.length) {
    return [...guaranteed, ...cutoffGroup].map((candidate) => candidate.recipientKey);
  }
  const selectedAtCutoff = cutoffGroup
    .map((candidate) => ({
      candidate,
      tieBreaker: domainHash("TAKE_ALLOCATION_TIE_V1", { seed, recipientKey: candidate.recipientKey })
    }))
    .sort((left, right) => left.tieBreaker.localeCompare(right.tieBreaker))
    .slice(0, remaining)
    .map(({ candidate }) => candidate);
  return [...guaranteed, ...selectedAtCutoff].map((candidate) => candidate.recipientKey);
}

function thresholdLottery(
  candidates: PreparedAllocationCandidateV1[],
  seats: number,
  seed: Hex,
  minimumSupport: number
): AllocationCandidateResultV1[] {
  const random = new DeterministicRandom(seed);
  const qualified = candidates
    .filter((candidate) => candidate.uniqueSupport >= minimumSupport)
    .sort((a, b) => a.recipientKey.localeCompare(b.recipientKey));
  const selectedOrder = random.shuffle(qualified).slice(0, seats);
  const selectedIndex = new Map(selectedOrder.map((candidate, index) => [candidate.recipientKey, index + 1]));
  const ordered = [...candidates].sort((a, b) => {
    const aOrder = selectedIndex.get(a.recipientKey);
    const bOrder = selectedIndex.get(b.recipientKey);
    if (aOrder && bOrder) return aOrder - bOrder;
    if (aOrder) return -1;
    if (bOrder) return 1;
    return b.uniqueSupport - a.uniqueSupport || a.recipientKey.localeCompare(b.recipientKey);
  });

  return ordered.map((candidate, index) => ({
    recipientKey: candidate.recipientKey,
    uniqueSupport: candidate.uniqueSupport,
    selected: selectedIndex.has(candidate.recipientKey),
    rank: index + 1,
    selectionOrder: selectedIndex.get(candidate.recipientKey),
    explanation: {
      strategyId: "THRESHOLD_UNIFORM_LOTTERY",
      strategyVersion: "1",
      minimumSupport,
      qualified: candidate.uniqueSupport >= minimumSupport,
      uniqueSupport: candidate.uniqueSupport
    }
  }));
}

function linearPps(candidates: PreparedAllocationCandidateV1[], seats: number, seed: Hex): AllocationCandidateResultV1[] {
  const selectedOrder = selectLinearPpsCandidates(candidates, seats, seed);
  const selectedIndex = new Map(selectedOrder.map((candidate, index) => [candidate.recipientKey, index + 1]));
  const ordered = [...candidates].sort((a, b) => {
    const aOrder = selectedIndex.get(a.recipientKey);
    const bOrder = selectedIndex.get(b.recipientKey);
    if (aOrder && bOrder) return aOrder - bOrder;
    if (aOrder) return -1;
    if (bOrder) return 1;
    return b.uniqueSupport - a.uniqueSupport || a.recipientKey.localeCompare(b.recipientKey);
  });

  return ordered.map((candidate, index) => ({
    recipientKey: candidate.recipientKey,
    uniqueSupport: candidate.uniqueSupport,
    selected: selectedIndex.has(candidate.recipientKey),
    rank: index + 1,
    selectionOrder: selectedIndex.get(candidate.recipientKey),
    explanation: {
      strategyId: "LINEAR_PPS_WITHOUT_REPLACEMENT",
      strategyVersion: "1",
      fixedWeight: candidate.uniqueSupport,
      uniqueSupport: candidate.uniqueSupport
    }
  }));
}

function selectLinearPpsRecipientKeys(
  candidates: PreparedAllocationCandidateV1[],
  seats: number,
  seed: Hex
): Hex[] {
  return selectLinearPpsCandidates(candidates, seats, seed).map((candidate) => candidate.recipientKey);
}

function selectLinearPpsCandidates(
  candidates: PreparedAllocationCandidateV1[],
  seats: number,
  seed: Hex
): PreparedAllocationCandidateV1[] {
  const random = new DeterministicRandom(seed);
  const remaining = [...candidates].sort((a, b) => a.recipientKey.localeCompare(b.recipientKey));
  const selectedOrder: PreparedAllocationCandidateV1[] = [];
  while (remaining.length > 0 && selectedOrder.length < seats) {
    const totalWeight = remaining.reduce((sum, candidate) => sum + BigInt(candidate.uniqueSupport), 0n);
    if (totalWeight === 0n) break;
    const draw = random.nextBigInt(totalWeight);
    let cursor = 0n;
    let selectedIndex = 0;
    for (let index = 0; index < remaining.length; index += 1) {
      cursor += BigInt(remaining[index]!.uniqueSupport);
      if (draw < cursor) {
        selectedIndex = index;
        break;
      }
    }
    selectedOrder.push(remaining.splice(selectedIndex, 1)[0]!);
  }
  return selectedOrder;
}

function assertRandomnessSeed(randomnessSeed: Hex) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(randomnessSeed)) {
    throw new TypeError("randomnessSeed must be bytes32");
  }
}

function artifactEdge(edge: NominationEdgeV1) {
  return {
    id: edge.id,
    chainId: edge.chainId,
    contractAddress: edge.contractAddress.toLowerCase(),
    transactionHash: edge.transactionHash.toLowerCase(),
    blockNumber: edge.blockNumber,
    transactionIndex: edge.transactionIndex,
    logIndex: edge.logIndex,
    giverIdentityKey: edge.giverIdentityKey.toLowerCase(),
    recipientIdentityKey: edge.recipientIdentityKey.toLowerCase(),
    canonicalGiverKey: edge.canonicalGiverKey.toLowerCase(),
    canonicalRecipientKey: edge.canonicalRecipientKey.toLowerCase(),
    validity: edge.validity,
    invalidReason: edge.invalidReason
  };
}
