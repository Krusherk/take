import { DeterministicRandom, domainHash } from "@take/mechanism";

export interface PopularityDiagnostics {
  coefficient: number | null;
  confidenceInterval95: [number, number] | null;
  sampleSize: number;
  missing: number;
  winnerOverlap: number;
  topDecileSeatShare: number;
  supportGini: number;
}

export function popularityDiagnostics(input: {
  scenarioId: string;
  support: Record<string, number>;
  popularity: Record<string, number>;
  selectionProbability: Record<string, number>;
  seats: number;
  bootstrapRuns?: number;
}): PopularityDiagnostics {
  const keys = Object.keys(input.support).filter((key) => Number.isFinite(input.popularity[key]));
  const missing = Object.keys(input.support).length - keys.length;
  const pairs = keys.map((key) => ({ support: input.support[key]!, popularity: input.popularity[key]! }));
  const coefficient = pairs.length >= 3
    ? spearman(pairs.map((item) => item.popularity), pairs.map((item) => item.support))
    : null;
  const interval = coefficient === null ? null : bootstrapSpearman(
    pairs,
    input.bootstrapRuns ?? 1_000,
    new DeterministicRandom(domainHash("TAKE_POPULARITY_BOOTSTRAP_V0", { scenarioId: input.scenarioId }))
  );
  const winnerKeys = [...keys].sort((left, right) =>
    (input.selectionProbability[right] ?? 0) - (input.selectionProbability[left] ?? 0) || left.localeCompare(right)
  ).slice(0, input.seats);
  const popularKeys = [...keys].sort((left, right) =>
    input.popularity[right]! - input.popularity[left]! || left.localeCompare(right)
  );
  const popularSeatSet = new Set(popularKeys.slice(0, input.seats));
  const winnerOverlap = input.seats > 0
    ? winnerKeys.filter((key) => popularSeatSet.has(key)).length / input.seats
    : 0;
  const topDecile = new Set(popularKeys.slice(0, Math.max(1, Math.ceil(popularKeys.length * 0.1))));
  const topDecileSeatShare = input.seats > 0
    ? [...topDecile].reduce((sum, key) => sum + (input.selectionProbability[key] ?? 0), 0) / input.seats
    : 0;

  return {
    coefficient,
    confidenceInterval95: interval,
    sampleSize: pairs.length,
    missing,
    winnerOverlap,
    topDecileSeatShare,
    supportGini: gini(Object.values(input.support))
  };
}

export function spearman(left: number[], right: number[]): number {
  if (left.length !== right.length || left.length < 2) throw new RangeError("Spearman samples must have equal length >= 2");
  const leftRanks = ranks(left);
  const rightRanks = ranks(right);
  return pearson(leftRanks, rightRanks);
}

export function gini(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.map((value) => Math.max(0, value)).sort((a, b) => a - b);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  if (total === 0) return 0;
  const weighted = sorted.reduce((sum, value, index) => sum + (index + 1) * value, 0);
  return (2 * weighted) / (sorted.length * total) - (sorted.length + 1) / sorted.length;
}

function bootstrapSpearman(
  pairs: Array<{ popularity: number; support: number }>,
  runs: number,
  random: DeterministicRandom
): [number, number] {
  const samples: number[] = [];
  for (let run = 0; run < runs; run += 1) {
    const sampled = Array.from({ length: pairs.length }, () => pairs[random.nextInt(pairs.length)]!);
    const value = pearson(
      ranks(sampled.map((item) => item.popularity)),
      ranks(sampled.map((item) => item.support))
    );
    if (Number.isFinite(value)) samples.push(value);
  }
  if (samples.length === 0) return [0, 0];
  samples.sort((a, b) => a - b);
  return [quantile(samples, 0.025), quantile(samples, 0.975)];
}

function ranks(values: number[]): number[] {
  const indexed = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const output = new Array<number>(values.length);
  for (let start = 0; start < indexed.length;) {
    let end = start + 1;
    while (end < indexed.length && indexed[end]!.value === indexed[start]!.value) end += 1;
    const averageRank = (start + 1 + end) / 2;
    for (let index = start; index < end; index += 1) output[indexed[index]!.index] = averageRank;
    start = end;
  }
  return output;
}

function pearson(left: number[], right: number[]) {
  const leftMean = left.reduce((sum, value) => sum + value, 0) / left.length;
  const rightMean = right.reduce((sum, value) => sum + value, 0) / right.length;
  let covariance = 0;
  let leftVariance = 0;
  let rightVariance = 0;
  for (let index = 0; index < left.length; index += 1) {
    const l = left[index]! - leftMean;
    const r = right[index]! - rightMean;
    covariance += l * r;
    leftVariance += l * l;
    rightVariance += r * r;
  }
  const denominator = Math.sqrt(leftVariance * rightVariance);
  return denominator === 0 ? 0 : covariance / denominator;
}

function quantile(sorted: number[], probability: number) {
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(probability * (sorted.length - 1))));
  return sorted[index]!;
}
