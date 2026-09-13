import {
  analyzeNominationGraph,
  DeterministicRandom,
  domainHash,
  prepareAllocation,
  runPreparedAllocationStrategy,
  selectPreparedRecipientKeys,
  type AllocationStrategyConfig
} from "@take/mechanism";
import type { SimulationScenario } from "./scenarios.js";
import { popularityDiagnostics, type PopularityDiagnostics } from "./research.js";

export type SimulationStrategyConfig = AllocationStrategyConfig | {
  strategyId: "CAPPED_SUPPORT_PPS";
  strategyVersion: "1";
  supportCap: number;
};

export interface ScenarioStrategyReport {
  scenarioId: string;
  strategy: SimulationStrategyConfig;
  runs: number;
  selectionProbability: Record<string, number>;
  ownerExpectedSeats: Record<string, number>;
  candidateSupport: Record<string, number>;
  ownerSupportUnits: Record<string, number>;
  meanSelectedQuality: number;
  qualityRecovery: number;
  selectionConcentration: number;
  winnerSetStability: number;
  explanationCoverage: number;
  supportDistribution: number[];
  invalidAttemptRate: number;
  reciprocitySignals: number;
  shortCycleSignals: number;
  popularity: PopularityDiagnostics | null;
}

export function runScenario(
  scenario: SimulationScenario,
  strategy: SimulationStrategyConfig,
  runs: number
): ScenarioStrategyReport {
  if (!Number.isSafeInteger(runs) || runs <= 0) throw new RangeError("runs must be a positive safe integer");
  const selectionCounts = new Map<string, number>();
  let selectedQuality = 0;
  let selectedTotal = 0;
  let explained = 0;
  let resultTotal = 0;
  let previousSelected: Set<string> | null = null;
  let winnerSetJaccard = 0;
  const candidateByKey = new Map(scenario.candidates.map((candidate) => [candidate.key, candidate]));
  const prepared = prepareAllocation({
    campaignId: scenario.id,
    strategy: mechanismStrategy(strategy),
    resourceQuantity: scenario.seats,
    edges: scenario.edges
  });
  const sampleSeed = simulationSeed(scenario.id, strategy, 0);
  const sampleResults = strategy.strategyId === "CAPPED_SUPPORT_PPS"
    ? cappedResults(prepared.candidates, scenario.seats, strategy.supportCap, sampleSeed)
    : runPreparedAllocationStrategy(prepared, sampleSeed);
  explained = sampleResults.filter((result) => Object.keys(result.explanation).length > 0).length;
  resultTotal = sampleResults.length;

  for (let run = 0; run < runs; run += 1) {
    const randomnessSeed = simulationSeed(scenario.id, strategy, run);
    const selected = strategy.strategyId === "CAPPED_SUPPORT_PPS"
      ? selectCappedPps(prepared.candidates, scenario.seats, strategy.supportCap, randomnessSeed)
      : selectPreparedRecipientKeys(prepared, randomnessSeed);
    const selectedSet = new Set<string>(selected);
    if (previousSelected) winnerSetJaccard += jaccard(previousSelected, selectedSet);
    previousSelected = selectedSet;
    for (const recipientKey of selected) {
      selectionCounts.set(recipientKey, (selectionCounts.get(recipientKey) ?? 0) + 1);
      selectedQuality += candidateByKey.get(recipientKey)?.quality ?? 0;
      selectedTotal += 1;
    }
  }

  const selectionProbability = Object.fromEntries(
    scenario.candidates.map((candidate) => [candidate.key, (selectionCounts.get(candidate.key) ?? 0) / runs])
  );
  const ownerExpectedSeats: Record<string, number> = {};
  const ownerSupportUnits: Record<string, number> = {};
  for (const candidate of scenario.candidates) {
    ownerExpectedSeats[candidate.ownerGroup] = (ownerExpectedSeats[candidate.ownerGroup] ?? 0) + selectionProbability[candidate.key]!;
    ownerSupportUnits[candidate.ownerGroup] = (ownerSupportUnits[candidate.ownerGroup] ?? 0)
      + (prepared.candidates.find((item) => item.recipientKey === candidate.key)?.uniqueSupport ?? 0);
  }
  const idealSelected = [...scenario.candidates]
    .sort((left, right) => right.quality - left.quality)
    .slice(0, scenario.seats);
  const idealQuality = idealSelected.length
    ? idealSelected.reduce((sum, candidate) => sum + candidate.quality, 0) / idealSelected.length
    : 0;
  const selectionMass = Object.values(selectionProbability).reduce((sum, probability) => sum + probability, 0);
  const selectionConcentration = selectionMass
    ? Object.values(selectionProbability).reduce((sum, probability) => sum + (probability / selectionMass) ** 2, 0)
    : 0;

  const support = Object.fromEntries(prepared.candidates.map((candidate) => [candidate.recipientKey, candidate.uniqueSupport]));
  const graph = analyzeNominationGraph(scenario.edges, { reciprocityPolicy: "OBSERVE_ONLY" });
  return {
    scenarioId: scenario.id,
    strategy,
    runs,
    selectionProbability,
    ownerExpectedSeats,
    candidateSupport: support,
    ownerSupportUnits,
    meanSelectedQuality: selectedTotal ? selectedQuality / selectedTotal : 0,
    qualityRecovery: idealQuality > 0 && selectedTotal ? (selectedQuality / selectedTotal) / idealQuality : 0,
    selectionConcentration,
    winnerSetStability: runs > 1 ? winnerSetJaccard / (runs - 1) : 1,
    explanationCoverage: resultTotal ? explained / resultTotal : 1,
    supportDistribution: Object.values(support).sort((a, b) => b - a),
    invalidAttemptRate: scenario.edges.length
      ? scenario.edges.filter((edge) => edge.validity === "INVALID").length / scenario.edges.length
      : 0,
    reciprocitySignals: graph.signals.filter((signal) => signal.signalType === "DIRECT_RECIPROCITY").length,
    shortCycleSignals: graph.signals.filter((signal) => signal.signalType === "SHORT_CYCLE").length,
    popularity: scenario.context?.popularityProxy
      ? popularityDiagnostics({
          scenarioId: scenario.id,
          support,
          popularity: scenario.context.popularityProxy,
          selectionProbability,
          seats: scenario.seats
        })
      : null
  };
}

function jaccard(left: Set<string>, right: Set<string>) {
  const union = new Set([...left, ...right]);
  if (union.size === 0) return 1;
  let intersection = 0;
  for (const value of left) if (right.has(value)) intersection += 1;
  return intersection / union.size;
}

export function simulationSeed(
  scenarioId: string,
  strategy: SimulationStrategyConfig,
  run: number
) {
  if (!Number.isSafeInteger(run) || run < 0) throw new RangeError("run must be a nonnegative safe integer");
  return domainHash("TAKE_SIMULATION_RUN_V1", { scenarioId, strategy, run });
}

function mechanismStrategy(strategy: SimulationStrategyConfig): AllocationStrategyConfig {
  return strategy.strategyId === "CAPPED_SUPPORT_PPS"
    ? { strategyId: "LINEAR_PPS_WITHOUT_REPLACEMENT", strategyVersion: "1" }
    : strategy;
}

function selectCappedPps(
  candidates: Array<{ recipientKey: `0x${string}`; uniqueSupport: number }>,
  seats: number,
  supportCap: number,
  seed: `0x${string}`
) {
  if (!Number.isSafeInteger(supportCap) || supportCap <= 0) throw new RangeError("supportCap must be positive");
  const random = new DeterministicRandom(seed);
  const pool = [...candidates].sort((left, right) => left.recipientKey.localeCompare(right.recipientKey));
  const selected: `0x${string}`[] = [];
  while (selected.length < seats && pool.length > 0) {
    const weights = pool.map((candidate) => Math.min(candidate.uniqueSupport, supportCap));
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    if (total <= 0) break;
    let draw = random.nextInt(total);
    let selectedIndex = 0;
    for (let index = 0; index < weights.length; index += 1) {
      if (draw < weights[index]!) {
        selectedIndex = index;
        break;
      }
      draw -= weights[index]!;
    }
    selected.push(pool[selectedIndex]!.recipientKey);
    pool.splice(selectedIndex, 1);
  }
  return selected;
}

function cappedResults(
  candidates: Array<{ recipientKey: `0x${string}`; uniqueSupport: number }>,
  seats: number,
  supportCap: number,
  seed: `0x${string}`
) {
  const selected = selectCappedPps(candidates, seats, supportCap, seed);
  const selectedOrder = new Map(selected.map((key, index) => [key, index + 1]));
  return [...candidates].sort((left, right) =>
    right.uniqueSupport - left.uniqueSupport || left.recipientKey.localeCompare(right.recipientKey)
  ).map((candidate, index) => ({
    recipientKey: candidate.recipientKey,
    uniqueSupport: candidate.uniqueSupport,
    selected: selectedOrder.has(candidate.recipientKey),
    rank: index + 1,
    selectionOrder: selectedOrder.get(candidate.recipientKey),
    explanation: {
      strategyId: "CAPPED_SUPPORT_PPS",
      strategyVersion: "1",
      supportCap,
      uniqueSupport: candidate.uniqueSupport,
      cappedWeight: Math.min(candidate.uniqueSupport, supportCap)
    }
  }));
}
