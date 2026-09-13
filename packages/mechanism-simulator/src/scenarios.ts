import { domainHash, type NominationEdgeV1 } from "@take/mechanism";
import type { Hex } from "viem";

export interface SimulationCandidate {
  key: Hex;
  quality: number;
  ownerGroup: string;
}

export interface SimulationScenario {
  id: string;
  kind: "HONEST" | "ATTACK";
  description: string;
  seats: number;
  candidates: SimulationCandidate[];
  edges: NominationEdgeV1[];
  context?: {
    communityDensity?: number;
    popularityProxy?: Record<string, number>;
    note?: string;
  };
}

export function honestUniformScenario(): SimulationScenario {
  const candidates = candidatesFor("honest-uniform", 12);
  const edges = Array.from({ length: 96 }, (_, index) => edge(
    "honest-uniform",
    index,
    identity("honest-uniform-giver", index),
    candidates[index % candidates.length]!.key
  ));
  return {
    id: "HONEST_UNIFORM",
    kind: "HONEST",
    description: "Equal-sized honest support across a broad recipient pool.",
    seats: 4,
    candidates,
    edges
  };
}

export function latentQualityScenario(): SimulationScenario {
  const candidates = candidatesFor("latent-quality", 12).map((candidate, index) => ({
    ...candidate,
    quality: index + 1
  }));
  const weighted: SimulationCandidate[] = candidates.flatMap((candidate, index) =>
    Array.from({ length: index + 1 }, () => candidate)
  );
  const edges = Array.from({ length: 120 }, (_, index) => edge(
    "latent-quality",
    index,
    identity("latent-quality-giver", index),
    weighted[(index * 17 + 3) % weighted.length]!.key
  ));
  return {
    id: "HONEST_LATENT_QUALITY",
    kind: "HONEST",
    description: "Support is correlated with a known latent recipient quality.",
    seats: 4,
    candidates,
    edges
  };
}

export function denseCommunityScenario(): SimulationScenario {
  const base = latentQualityScenario();
  return {
    ...base,
    id: "HONEST_DENSE_COMMUNITY",
    description: "The same honest choices occur inside a socially dense community; density must not reduce allocation power.",
    context: { communityDensity: 0.85, note: "Dense social context is research-only." }
  };
}

export function sparseCommunityScenario(): SimulationScenario {
  const base = latentQualityScenario();
  return {
    ...base,
    id: "HONEST_SPARSE_COMMUNITY",
    description: "The same honest choices occur in a sparse community; graph density is deliberately absent from allocation.",
    context: { communityDensity: 0.08, note: "Sparse social context is research-only." }
  };
}

export function popularitySkewScenario(): SimulationScenario {
  const candidates = candidatesFor("popularity-skew", 10).map((item, index) => ({
    ...item,
    quality: Math.max(1, 10 - index)
  }));
  const weights = [42, 24, 16, 12, 8, 6, 4, 3, 3, 2];
  const weighted = candidates.flatMap((item, index) => Array.from({ length: weights[index]!, }, () => item));
  const edges = Array.from({ length: 120 }, (_, index) => edge(
    "popularity-skew",
    index,
    identity("popularity-skew-giver", index),
    weighted[(index * 29 + 7) % weighted.length]!.key
  ));
  return {
    id: "HONEST_POPULARITY_SKEW",
    kind: "HONEST",
    description: "An honest opportunity with highly skewed attention and no popularity-derived weight.",
    seats: 4,
    candidates,
    edges,
    context: {
      popularityProxy: Object.fromEntries(candidates.map((item, index) => [item.key, weights[index]!])),
      note: "Popularity is measured after allocation and never supplied to the strategy."
    }
  };
}

export function newcomerSupportScenario(): SimulationScenario {
  const newcomer = candidate("newcomer", 10, "newcomer");
  const established = candidatesFor("newcomer-established", 7).map((item, index) => ({
    ...item,
    quality: 4 + index
  }));
  const recipients = [
    ...Array.from({ length: 18 }, () => newcomer),
    ...established.flatMap((item, index) => Array.from({ length: 8 + index }, () => item))
  ];
  const edges = Array.from({ length: 96 }, (_, index) => edge(
    "newcomer-support",
    index,
    identity("newcomer-support-giver", index),
    recipients[(index * 19 + 5) % recipients.length]!.key
  ));
  return {
    id: "HONEST_NEWCOMER_SUPPORT",
    kind: "HONEST",
    description: "A high-quality newcomer receives direct support without an account-age or popularity penalty.",
    seats: 3,
    candidates: [newcomer, ...established],
    edges
  };
}

export function lowVisibilityRecipientScenario(): SimulationScenario {
  const lowVisibility = candidate("low-visibility", 10, "low-visibility");
  const established = candidatesFor("visible-recipient", 6).map((item, index) => ({
    ...item,
    quality: 3 + index
  }));
  const weighted = [
    ...Array.from({ length: 20 }, () => lowVisibility),
    ...established.flatMap((item, index) => Array.from({ length: 14 - index }, () => item))
  ];
  const edges = Array.from({ length: weighted.length }, (_, index) => edge(
    "low-visibility-support",
    index,
    identity("low-visibility-giver", index),
    weighted[index]!.key
  ));
  return {
    id: "LOW_VISIBILITY_RECIPIENT",
    kind: "HONEST",
    description: "A recipient with minimal preregistered visibility receives strong direct support without a popularity multiplier or penalty.",
    seats: 3,
    candidates: [lowVisibility, ...established],
    edges,
    context: {
      popularityProxy: {
        [lowVisibility.key]: 0,
        ...Object.fromEntries(established.map((item, index) => [item.key, index + 1]))
      },
      note: "Visibility is evaluated after allocation and is never passed to the strategy."
    }
  };
}

export function splitAttackScenarios(): { baseline: SimulationScenario; attack: SimulationScenario } {
  const honestCandidates = candidatesFor("split-honest", 6);
  const primary = candidate("split-primary", 10, "coalition");
  const splitA = candidate("split-a", 10, "coalition");
  const splitB = candidate("split-b", 10, "coalition");
  const baselineEdges: NominationEdgeV1[] = [];
  const attackEdges: NominationEdgeV1[] = [];
  for (let index = 0; index < 60; index += 1) {
    const giver = identity("split-giver", index);
    if (index < 20) {
      baselineEdges.push(edge("split-baseline", index, giver, primary.key));
      attackEdges.push(edge("split-attack", index, giver, index % 2 === 0 ? splitA.key : splitB.key));
    } else {
      const recipient = honestCandidates[(index - 20) % honestCandidates.length]!.key;
      baselineEdges.push(edge("split-baseline", index, giver, recipient));
      attackEdges.push(edge("split-attack", index, giver, recipient));
    }
  }
  return {
    baseline: {
      id: "SPLIT_BASELINE",
      kind: "ATTACK",
      description: "A coalition concentrates fixed support in one recipient identity.",
      seats: 3,
      candidates: [primary, ...honestCandidates],
      edges: baselineEdges
    },
    attack: {
      id: "CANDIDATE_SPLITTING",
      kind: "ATTACK",
      description: "The same coalition divides fixed support across two recipient identities.",
      seats: 3,
      candidates: [primary, splitA, splitB, ...honestCandidates],
      edges: attackEdges
    }
  };
}

export function sybilScenarios(sybilCount = 10): { baseline: SimulationScenario; attack: SimulationScenario } {
  const honestCandidates = candidatesFor("sybil-honest", 6);
  const attacker = candidate("sybil-attacker", 1, "attacker");
  const baselineEdges: NominationEdgeV1[] = [];
  for (let index = 0; index < 48; index += 1) {
    baselineEdges.push(edge(
      "sybil-baseline",
      index,
      identity("sybil-honest-giver", index),
      honestCandidates[index % honestCandidates.length]!.key
    ));
  }
  baselineEdges.push(edge("sybil-baseline", 49, identity("sybil-real-giver", 0), attacker.key));
  const attackEdges = [...baselineEdges];
  for (let index = 0; index < sybilCount; index += 1) {
    attackEdges.push(edge(
      "sybil-attack",
      50 + index,
      identity("sybil-added-giver", index),
      attacker.key
    ));
  }
  return {
    baseline: {
      id: "SYBIL_BASELINE",
      kind: "ATTACK",
      description: "One eligible identity supports the attacker recipient.",
      seats: 2,
      candidates: [attacker, ...honestCandidates],
      edges: baselineEdges
    },
    attack: {
      id: "ELIGIBLE_SYBIL_CLUSTER",
      kind: "ATTACK",
      description: `${sybilCount} additional identities support the same attacker recipient.`,
      seats: 2,
      candidates: [attacker, ...honestCandidates],
      edges: attackEdges
    }
  };
}

export function weakCandidateOverlapScenarios(): { truthful: SimulationScenario; strategic: SimulationScenario } {
  const selectors = [candidate("overlap-a", 9, "selectors"), candidate("overlap-b", 8, "selectors")];
  const deserving = candidate("overlap-deserving", 10, "recipient");
  const weak = candidate("overlap-weak", 1, "recipient");
  const background = [candidate("overlap-background", 6, "background")];
  const common: NominationEdgeV1[] = [];
  for (let index = 0; index < 6; index += 1) {
    common.push(edge("overlap-selector-a-support", index, identity("overlap-a-supporter", index), selectors[0]!.key));
    common.push(edge("overlap-selector-b-support", 10 + index, identity("overlap-b-supporter", index), selectors[1]!.key));
    common.push(edge("overlap-deserving-base", 20 + index, identity("overlap-deserving-supporter", index), deserving.key));
  }
  for (let index = 0; index < 7; index += 1) {
    common.push(edge("overlap-background-support", 30 + index, identity("overlap-background-supporter", index), background[0]!.key));
  }
  const truthful = [
    ...common,
    edge("overlap-truthful", 50, selectors[0]!.key, deserving.key),
    edge("overlap-truthful", 51, selectors[1]!.key, deserving.key)
  ];
  const strategic = [
    ...common,
    edge("overlap-strategic", 50, selectors[0]!.key, weak.key),
    edge("overlap-strategic", 51, selectors[1]!.key, weak.key)
  ];
  return {
    truthful: {
      id: "OVERLAP_TRUTHFUL",
      kind: "ATTACK",
      description: "Eligible selectors nominate the deserving competing recipient.",
      seats: 2,
      candidates: [...selectors, deserving, weak, ...background],
      edges: truthful
    },
    strategic: {
      id: "OVERLAP_WEAK_CANDIDATE",
      kind: "ATTACK",
      description: "Eligible selectors divert support to a weak recipient to avoid strengthening a competitor.",
      seats: 2,
      candidates: [...selectors, deserving, weak, ...background],
      edges: strategic
    }
  };
}

export function disjointSelectorRecipientScenario(): SimulationScenario {
  const recipients = [
    candidate("disjoint-deserving", 10, "recipients"),
    candidate("disjoint-strong", 8, "recipients"),
    candidate("disjoint-weak", 1, "recipients")
  ];
  const edges = Array.from({ length: 18 }, (_, index) => edge(
    "disjoint",
    index,
    identity("disjoint-selector", index),
    index < 9 ? recipients[0]!.key : index < 16 ? recipients[1]!.key : recipients[2]!.key
  ));
  return {
    id: "DISJOINT_SELECTOR_RECIPIENT",
    kind: "HONEST",
    description: "Selectors cannot receive, so weak-recipient choices cannot improve their own eligibility for a seat.",
    seats: 2,
    candidates: recipients,
    edges,
    context: { note: "Selector and recipient identities are disjoint by construction." }
  };
}

export function reciprocityAttackScenario(): SimulationScenario {
  const a = candidate("reciprocity-a", 1, "reciprocal-pair");
  const b = candidate("reciprocity-b", 1, "reciprocal-pair");
  const honest = candidatesFor("reciprocity-honest", 5);
  const background = Array.from({ length: 30 }, (_, index) => edge(
    "reciprocity-background",
    index,
    identity("reciprocity-giver", index),
    honest[index % honest.length]!.key
  ));
  const reciprocal = [
    edge("reciprocity", 40, a.key, b.key),
    edge("reciprocity", 41, b.key, a.key)
  ];
  return {
    id: "DIRECT_RECIPROCITY_OBSERVED",
    kind: "ATTACK",
    description: "Both reciprocal choices remain valid while the pair is recorded as behavioral evidence.",
    seats: 2,
    candidates: [a, b, ...honest],
    edges: [...background, ...reciprocal]
  };
}

export function cycleAttackScenario(): SimulationScenario {
  const coalition = [
    candidate("cycle-a", 1, "cycle"),
    candidate("cycle-b", 1, "cycle"),
    candidate("cycle-c", 1, "cycle")
  ];
  const honest = candidatesFor("cycle-honest", 5);
  const cycleEdges = coalition.map((item, index) => edge(
    "cycle",
    index,
    item.key,
    coalition[(index + 1) % coalition.length]!.key
  ));
  const honestEdges = Array.from({ length: 30 }, (_, index) => edge(
    "cycle-honest",
    index + 10,
    identity("cycle-honest-giver", index),
    honest[index % honest.length]!.key
  ));
  return {
    id: "SHORT_CYCLE_REVIEW_ONLY",
    kind: "ATTACK",
    description: "A three-person cycle remains valid allocation input but is available to the separate review layer.",
    seats: 2,
    candidates: [...coalition, ...honest],
    edges: [...cycleEdges, ...honestEdges]
  };
}

export function coalitionScenario(): SimulationScenario {
  const coalition = [candidate("coalition-a", 2, "coalition"), candidate("coalition-b", 2, "coalition")];
  const honest = candidatesFor("coalition-honest", 6);
  const edges = Array.from({ length: 72 }, (_, index) => edge(
    "coalition",
    index,
    identity("coalition-giver", index),
    index < 24 ? coalition[index % coalition.length]!.key : honest[(index - 24) % honest.length]!.key
  ));
  return {
    id: "REPEATED_COALITION",
    kind: "ATTACK",
    description: "A coordinated giver set concentrates support; the simulator records gain without inventing a graph penalty.",
    seats: 3,
    candidates: [...coalition, ...honest],
    edges
  };
}

export function synchronizedBurstScenario(): SimulationScenario {
  const base = coalitionScenario();
  const timestamp = "2026-01-01T00:00:00.000Z";
  return {
    ...base,
    id: "SYNCHRONIZED_TEMPORAL_BURST",
    description: "The same choices arrive in one timestamp burst; timing is review evidence and not an allocation weight.",
    edges: base.edges.map((item) => ({ ...item, blockTimestamp: timestamp }))
  };
}

export function lateCoordinationScenario(): SimulationScenario {
  const base = coalitionScenario();
  const campaignEnd = Date.parse("2026-01-08T00:00:00.000Z");
  return {
    ...base,
    id: "LATE_COORDINATION",
    description: "A coordinated giver set acts during the final two minutes; timing remains observational.",
    edges: base.edges.map((item, index) => ({
      ...item,
      blockTimestamp: new Date(campaignEnd - (base.edges.length - index) * 1_000).toISOString()
    })),
    context: { note: "Late timing is research evidence and does not alter raw support." }
  };
}

export function commonFundingCorrelationScenario(): SimulationScenario {
  const base = coalitionScenario();
  return {
    ...base,
    id: "COMMON_FUNDING_NOT_RUN",
    description: "A placeholder attack family whose wallet-correlation signal remains NOT_RUN without verified history coverage."
  };
}

export function crossCampaignCoalitionScenario(): SimulationScenario {
  const base = coalitionScenario();
  return {
    ...base,
    id: "CROSS_CAMPAIGN_REPETITION",
    description: "Repeated coalition behavior is measured as review evidence and never converted into hidden vote weight."
  };
}

export function allCoreScenarios(): SimulationScenario[] {
  const split = splitAttackScenarios();
  const sybil = sybilScenarios();
  const overlap = weakCandidateOverlapScenarios();
  return [
    honestUniformScenario(),
    latentQualityScenario(),
    denseCommunityScenario(),
    sparseCommunityScenario(),
    popularitySkewScenario(),
    newcomerSupportScenario(),
    lowVisibilityRecipientScenario(),
    split.baseline,
    split.attack,
    sybil.baseline,
    sybil.attack,
    overlap.truthful,
    overlap.strategic,
    disjointSelectorRecipientScenario(),
    reciprocityAttackScenario(),
    cycleAttackScenario(),
    coalitionScenario(),
    synchronizedBurstScenario(),
    lateCoordinationScenario(),
    commonFundingCorrelationScenario(),
    crossCampaignCoalitionScenario()
  ];
}

function candidatesFor(namespace: string, count: number): SimulationCandidate[] {
  return Array.from({ length: count }, (_, index) => candidate(`${namespace}-${index}`, 1, `${namespace}-${index}`));
}

function candidate(name: string, quality: number, ownerGroup: string): SimulationCandidate {
  return { key: identity("candidate", name), quality, ownerGroup };
}

export function identity(namespace: string, value: string | number): Hex {
  return domainHash("TAKE_SIMULATION_IDENTITY_V1", { namespace, value });
}

function edge(
  namespace: string,
  index: number,
  giver: Hex,
  recipient: Hex,
  canonicalRecipient: Hex = recipient
): NominationEdgeV1 {
  const transactionHash = domainHash("TAKE_SIMULATION_TRANSACTION_V1", { namespace, index });
  return {
    id: domainHash("TAKE_SIMULATION_EDGE_V1", { namespace, index }),
    campaignId: namespace,
    chainId: 10143,
    contractAddress: "0x0000000000000000000000000000000000000001",
    transactionHash,
    blockNumber: String(index + 1),
    transactionIndex: 0,
    logIndex: 0,
    blockTimestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
    giverIdentityKey: giver,
    recipientIdentityKey: recipient,
    canonicalGiverKey: giver,
    canonicalRecipientKey: canonicalRecipient,
    validity: "VALID"
  };
}
