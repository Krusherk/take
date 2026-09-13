import { domainHash } from "./canonical.js";
import { applyRejectLaterReciprocity, observeDirectReciprocity } from "./reciprocity.js";
import type { GraphSignalV1, NominationEdgeV1 } from "./types.js";

export interface GraphAnalysisOptions {
  temporalBurstWindowSeconds?: number;
  temporalBurstMinimumEdges?: number;
  reciprocityPolicy?: "REJECT_LATER_EDGE" | "OBSERVE_ONLY";
}

export function analyzeNominationGraph(
  inputEdges: readonly NominationEdgeV1[],
  options: GraphAnalysisOptions = {}
): { edges: NominationEdgeV1[]; signals: GraphSignalV1[] } {
  const reciprocity = options.reciprocityPolicy === "OBSERVE_ONLY"
    ? observeDirectReciprocity(inputEdges)
    : applyRejectLaterReciprocity(inputEdges);
  const validEdges = reciprocity.edges.filter((edge) => edge.validity === "VALID");
  const cycles = detectShortCycles(validEdges);
  const bursts = detectTemporalBursts(
    validEdges,
    options.temporalBurstWindowSeconds ?? 60,
    options.temporalBurstMinimumEdges ?? 5
  );
  const unavailable: GraphSignalV1[] = [
    notRun("COMMON_FUNDER", "A complete wallet-transaction history provider is not configured."),
    notRun("SHARED_FUNDING_ANCESTRY", "A complete wallet-transaction history provider is not configured."),
    notRun("WALLET_SEQUENCE_SIMILARITY", "A complete wallet-transaction history provider is not configured.")
  ];
  return {
    edges: reciprocity.edges,
    signals: [...reciprocity.signals, ...cycles, ...bursts, ...unavailable]
  };
}

function detectShortCycles(edges: readonly NominationEdgeV1[]): GraphSignalV1[] {
  const adjacency = new Map<string, Set<string>>();
  const edgesByPair = new Map<string, string[]>();
  for (const edge of edges) {
    const from = edge.canonicalGiverKey.toLowerCase();
    const to = edge.canonicalRecipientKey.toLowerCase();
    const targets = adjacency.get(from) ?? new Set<string>();
    targets.add(to);
    adjacency.set(from, targets);
    const pair = `${from}>${to}`;
    edgesByPair.set(pair, [...(edgesByPair.get(pair) ?? []), edge.id]);
  }

  const cycleKeys = new Set<string>();
  const signals: GraphSignalV1[] = [];
  for (const start of [...adjacency.keys()].sort()) {
    walk(start, start, [start], 4, adjacency, (cycle) => {
      if (cycle.length < 4) return;
      const members = cycle.slice(0, -1);
      const canonical = canonicalCycle(members);
      if (cycleKeys.has(canonical)) return;
      cycleKeys.add(canonical);
      const edgeIds: string[] = [];
      for (let index = 0; index < members.length; index += 1) {
        const from = members[index]!;
        const to = members[(index + 1) % members.length]!;
        edgeIds.push(...(edgesByPair.get(`${from}>${to}`) ?? []));
      }
      signals.push({
        id: domainHash("TAKE_GRAPH_SIGNAL_V1", { type: "SHORT_CYCLE", members, edgeIds }),
        signalType: "SHORT_CYCLE",
        algorithmVersion: "1",
        status: "NEEDS_REVIEW",
        subjectKeys: members as `0x${string}`[],
        edgeIds: [...new Set(edgeIds)].sort(),
        strength: members.length === 3 ? 1 : 0.75,
        evidence: { cycleLength: members.length }
      });
    });
  }
  return signals;
}

function walk(
  start: string,
  current: string,
  path: string[],
  maximumLength: number,
  adjacency: ReadonlyMap<string, ReadonlySet<string>>,
  found: (cycle: string[]) => void
) {
  if (path.length > maximumLength) return;
  for (const next of adjacency.get(current) ?? []) {
    if (next === start && path.length >= 3) {
      found([...path, start]);
      continue;
    }
    if (!path.includes(next)) walk(start, next, [...path, next], maximumLength, adjacency, found);
  }
}

function canonicalCycle(members: string[]): string {
  const rotations = members.map((_, index) => [...members.slice(index), ...members.slice(0, index)].join(">"));
  return rotations.sort()[0]!;
}

function detectTemporalBursts(edges: readonly NominationEdgeV1[], windowSeconds: number, minimumEdges: number): GraphSignalV1[] {
  if (minimumEdges < 2 || windowSeconds <= 0) return [];
  const byCampaign = new Map<string, NominationEdgeV1[]>();
  for (const edge of edges) byCampaign.set(edge.campaignId, [...(byCampaign.get(edge.campaignId) ?? []), edge]);
  const signals: GraphSignalV1[] = [];
  for (const [campaignId, campaignEdges] of byCampaign) {
    const ordered = [...campaignEdges].sort((a, b) => Date.parse(a.blockTimestamp) - Date.parse(b.blockTimestamp));
    let left = 0;
    for (let right = 0; right < ordered.length; right += 1) {
      while (Date.parse(ordered[right]!.blockTimestamp) - Date.parse(ordered[left]!.blockTimestamp) > windowSeconds * 1_000) left += 1;
      const cluster = ordered.slice(left, right + 1);
      if (cluster.length !== minimumEdges) continue;
      const edgeIds = cluster.map((edge) => edge.id).sort();
      const subjectKeys = [...new Set(cluster.flatMap((edge) => [edge.canonicalGiverKey, edge.canonicalRecipientKey]))].sort();
      signals.push({
        id: domainHash("TAKE_GRAPH_SIGNAL_V1", { type: "TEMPORAL_BURST", campaignId, edgeIds, windowSeconds }),
        signalType: "TEMPORAL_BURST",
        algorithmVersion: "1",
        status: "NEEDS_REVIEW",
        subjectKeys,
        edgeIds,
        strength: Math.min(1, cluster.length / (minimumEdges * 2)),
        evidence: { campaignId, edgeCount: cluster.length, windowSeconds }
      });
    }
  }
  return signals;
}

function notRun(signalType: "COMMON_FUNDER" | "SHARED_FUNDING_ANCESTRY" | "WALLET_SEQUENCE_SIMILARITY", limitation: string): GraphSignalV1 {
  return {
    id: domainHash("TAKE_GRAPH_SIGNAL_V1", { type: signalType, status: "NOT_RUN", limitation }),
    signalType,
    algorithmVersion: "1",
    status: "NOT_RUN",
    subjectKeys: [],
    edgeIds: [],
    evidence: {},
    limitation
  };
}
