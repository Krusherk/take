import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildMechanismDecisionGateV01 } from "./decisionGate.js";

const args = process.argv.slice(2);
const runs = Number(valueFor("--runs") ?? "10000");
const generatedAt = valueFor("--generated-at") ?? new Date().toISOString();
const repositoryRoot = resolve(import.meta.dirname, "../../..");
const verificationPath = resolve(repositoryRoot, "docs/mechanism-decision-gate-v0.1-verification.json");
const jsonPath = resolve(repositoryRoot, valueFor("--json") ?? "docs/mechanism-decision-gate-v0.1.json");
const markdownPath = resolve(repositoryRoot, valueFor("--markdown") ?? "docs/mechanism-decision-gate-v0.1.md");
const verification = JSON.parse(readFileSync(verificationPath, "utf8"));
const report = buildMechanismDecisionGateV01(runs, {
  generatedAt,
  baselineArtifacts: verification.checkpoint.baselineArtifacts,
  engineeringVerification: {
    foundryRegression: verification.foundryRegression,
    monadSmoke: verification.monadSmoke,
    drandSmoke: verification.drandSmoke
  }
});

writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(markdownPath, renderMarkdown(report));
process.stdout.write(`${JSON.stringify({ jsonPath, markdownPath, reportHash: report.reportHash, runs })}\n`);

function valueFor(flag: string) {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

function renderMarkdown(report: ReturnType<typeof buildMechanismDecisionGateV01>) {
  const rows = report.comparison.map((row) => [
    row.strategy,
    row.populationMode,
    percent(row.qualityRecovery),
    `support rho ${number(row.popularity.supportCorrelation)}; seat rho ${number(row.popularity.seatCorrelation)}; top-decile ${percent(row.popularity.topDecileSeatShare)}`,
    `+${number(row.candidateSplitting.absoluteSeatShareGain)} seat share; best [${row.candidateSplitting.bestPattern.join(", ")}]`,
    row.cartelSeatCapture
      ? `m=25: ${percent(row.cartelSeatCapture.expectedSeatShare)} expected; P(majority) ${percent(row.cartelSeatCapture.seatStatistics.probabilityMajoritySeats)}`
      : "n/a",
    `overlap ${signed(row.weakCandidateIncentive.overlapping.selectorWinningProbabilityGain)} seats; disjoint +0`,
    `stability ${percent(row.volatility.winnerSetStability)}; m=25 variance ${number(row.volatility.coalitionAt25?.variance)}`,
    percent(row.explainability),
    row.parameterSensitivity,
    `**${row.verdict}**`
  ]);
  const lines = [
    table([
      "STRATEGY",
      "POPULATION MODE",
      "QUALITY RECOVERY",
      "POPULARITY",
      "CANDIDATE SPLITTING",
      "CARTEL SEAT CAPTURE",
      "WEAK-CANDIDATE INCENTIVE",
      "VOLATILITY",
      "EXPLAINABILITY",
      "PARAMETER SENSITIVITY",
      "VERDICT"
    ], rows),
    "",
    "# TAKE Mechanism Decision Gate V0.1",
    "",
    `Canonical report hash: \`${report.reportHash}\`  `,
    `Simulation runs per primary scenario: **${report.runPolicy.primaryRunsPerScenario.toLocaleString()}**  `,
    `Sensitivity runs per parameter/scenario: **${report.runPolicy.sensitivityRunsPerScenario.toLocaleString()}**  `,
    `Generated at: \`${report.generatedAt}\``,
    "",
    "## Decision",
    "",
    report.decision.seriousCampaignRecipientRule,
    "",
    "No strategy is described as production-ready. `RAW_UNIQUE_SUPPORT@2` remains the frozen control. Overlapping selector/recipient campaigns remain experimental and low-assurance. Disjoint populations are the leading high-assurance structure because they remove the selector's direct weak-candidate self-interest, but they do not solve coalition capture or cheap identity acquisition.",
    "",
    "The comparison is not an A/B test and does not establish causal real-user behavior. It is a deterministic synthetic mechanism analysis over identical canonical graphs.",
    "",
    "## Frozen Baseline",
    "",
    ...report.frozenBaselineArtifacts.map((item) => `- \`${item.path}\`: SHA-256 \`${item.sha256}\`${item.reportHash ? `; report hash \`${item.reportHash}\`` : ""}`),
    "",
    "The V0 files were not overwritten. Simulation seeds use the fixed `TAKE_SIMULATION_RUN_V1` domain, and this report records its run count, parameter family, generation time, and canonical hash.",
    "",
    "## Engineering Verification",
    "",
    `- Foundry regression: **${report.engineeringVerification.foundryRegression.passed}/${report.engineeringVerification.foundryRegression.passed + report.engineeringVerification.foundryRegression.failed} passed**; existing Solidity unchanged.`,
    `- Monad testnet: existing manager \`${report.engineeringVerification.monadSmoke.managerAddress}\`, campaign \`${report.engineeringVerification.monadSmoke.onchainCampaignId}\`; create, activate, TAKE, and close events finalized.`,
    `- Canonical indexer: one valid finalized edge \`${report.engineeringVerification.monadSmoke.canonicalEdge.id}\`; graph input hash \`${report.engineeringVerification.monadSmoke.graphSnapshot.inputHash}\`.`,
    `- Graph limitation: ${report.engineeringVerification.monadSmoke.graphSnapshot.limitation}`,
    `- Drand: evmnet round \`${report.engineeringVerification.drandSmoke.round}\` verified; artifact \`${report.engineeringVerification.drandSmoke.artifactHash}\`; replay checks all passed.`,
    `- Drand operational warning: the default ${report.engineeringVerification.drandSmoke.operationalFinding.defaultTimeoutMilliseconds}ms attempt timed out; ${report.engineeringVerification.drandSmoke.operationalFinding.successfulTimeoutMilliseconds}ms configuration succeeded. Relay timeout tuning remains a pilot gate.`,
    "",
    "## Decision Rules",
    "",
    "These are operational gates fixed before the comparative run, not scientific definitions: candidate-splitting seat-share gain <= 5%; quality recovery >= 80%; expected seat share for 25 coordinated identities in a 100-selector/10-seat campaign <= 30%; and headline parameter-family range <= 15 percentage points. A strategy must satisfy all four to become a pilot candidate.",
    "",
    "Identity influence and allocation amplification are separate. The invariant `m` additional valid canonical givers -> at most `m` new raw support units passes for every strategy. The fixed-budget test holds TAKE count constant and asks whether redistributing those TAKEs across allied recipients increases expected seats.",
    "",
    "## Strategy Results",
    ""
  ];

  for (const assessment of report.strategyAssessments) {
    const row = report.comparison.find((item) => item.strategy.startsWith(assessment.strategy.strategyId))!;
    lines.push(
      `### ${row.strategy}: ${row.verdict}`,
      "",
      row.verdictReason,
      "",
      `- Latent-quality recovery: **${percent(assessment.quality.qualityRecovery)}**; mean selected quality ${number(assessment.quality.meanSelectedQuality)}.`,
      `- Popularity: support rho **${number(assessment.popularity.supportCorrelation)}** (${interval(assessment.popularity.supportCorrelation95)}); seat rho **${number(assessment.popularity.seatCorrelation)}**; top-decile seat share **${percent(assessment.popularity.topDecileSeatShare)}**; lesser-known mean selection probability **${percent(assessment.popularity.lesserKnownMeanSelectionProbability)}**.`,
      `- Candidate splitting: fixed 20-TAKE coalition moves from **${number(assessment.candidateSplitting.baseline.expectedSeats)}** to **${number(assessment.candidateSplitting.best.expectedSeats)}** expected seats; seat-share gain **${percent(assessment.candidateSplitting.absoluteSeatShareGain)}**; amplification **${number(assessment.candidateSplitting.fixedBudgetAmplification)}x**; best-found split \`[${assessment.candidateSplitting.best.pattern.join(", ")}]\`.`,
      `- Weak candidate: overlapping selector expected-seat change **${signed(assessment.weakCandidate.overlapping.selectorWinningProbabilityGain)}**; disjoint selectors change **+0** because selectors are not candidates. Disjoint strategic nominations can still reduce quality (${percent(assessment.weakCandidate.disjoint.truthfulQualityRecovery)} -> ${percent(assessment.weakCandidate.disjoint.strategicQualityRecovery)}).`,
      `- Honest density: penalty **${percent(assessment.honestDenseCommunity.penalty)}** with identical allocation inputs.`,
      `- Behavioral boundary: reciprocity signals ${assessment.behavioralObservationBoundary.reciprocitySignals}; short-cycle signals ${assessment.behavioralObservationBoundary.shortCycleSignals}; invalid-attempt rates ${percent(assessment.behavioralObservationBoundary.reciprocityInvalidAttemptRate)} / ${percent(assessment.behavioralObservationBoundary.shortCycleInvalidAttemptRate)}; late timing changed support=${assessment.behavioralObservationBoundary.lateTimingChangesSupport}, selection=${assessment.behavioralObservationBoundary.lateTimingChangesSelectionProbabilities}.`,
      "",
      "Coalition seat-capture curve (100 selectors, 10 seats; best-found balanced allied-recipient split):",
      "",
      table(
        ["m", "Selector share", "Best split", "Expected seats", "Seat share", "Variance", "P(0 seats)", "P(majority)"],
        assessment.coalitionCapture.map((point) => [
          String(point.coalitionSize),
          percent(point.selectorShare),
          `[${point.bestPattern.join(", ")}]`,
          number(point.expectedSeats),
          percent(point.expectedSeatShare),
          number(point.seatStatistics.variance),
          percent(point.seatStatistics.probabilityZeroSeats),
          percent(point.seatStatistics.probabilityMajoritySeats)
        ])
      ),
      "",
      "Small-campaign behavior:",
      "",
      table(
        ["Selectors", "Seats", "Quality recovery", "Winner stability", "Support distribution"],
        assessment.smallCampaigns.map((item) => [
          String(item.selectors),
          String(item.seats),
          percent(item.qualityRecovery),
          percent(item.winnerSetStability),
          item.supportDistribution.join(", ")
        ])
      ),
      ""
    );
  }

  lines.push("## Parameter Robustness", "");
  for (const family of report.parameterSensitivity) {
    lines.push(
      `### ${family.family}`,
      "",
      family.summary,
      "",
      table(
        ["Parameters", "Quality", "Split gain", "Best split / qualified allies", "Qualified candidates", "Weak candidate admitted", "Support-to-seat rho", "Cartel m=25", "Popularity top-decile", "Winner stability"],
        family.points.map((point) => [
          parameterLabel(point.strategy),
          percent(point.qualityRecovery),
          percent(point.candidateSplittingSeatShareGain),
          `[${point.bestSplittingPattern.join(", ")}] / ${point.qualifiedCoalitionAllies}`,
          String(point.qualifiedLatentQualityCandidates),
          percent(point.weakCandidateAdmissionProbability),
          number(point.nominationInformativeness),
          percent(point.cartelSeatShareAt25Identities),
          percent(point.popularityTopDecileSeatShare),
          percent(point.winnerSetStability)
        ])
      ),
      ""
    );
  }

  lines.push(
    "## Interpretation",
    "",
    "- `RAW_UNIQUE_SUPPORT@2` preserves the community signal and quality well, but deterministic top-K turns recipient splitting into extra seats and produces a large overlapping weak-candidate incentive. It remains control-only.",
    "- Threshold lottery softens small support differences only after qualification. It creates a new cliff at the threshold and lets a fixed coalition manufacture multiple qualified allies. Parameter choice materially changes quality and capture.",
    "- Linear PPS preserves marginal support information and softens deterministic cliffs, but randomness does not remove fixed-budget splitting: separate allied candidates create multiple without-replacement draw opportunities. It also has real winner variance.",
    "- Capped PPS limits the marginal return to concentrated popularity, but the cap makes splitting especially attractive because each allied recipient receives a fresh cap. The minimum-support and cap choices are consequential and arbitrary at this evidence level.",
    "- Disjoint selector/recipient populations should be the default structure for any future serious test. This is a provisional synthetic conclusion, not evidence that real people will behave the same way.",
    "",
    "## Real Pilot Gate",
    "",
    "Foundry, live Monad indexing, and verified drand replay have been exercised. Exact V0 replay and active-support suppression were previously verified. However, no allocation alternative reaches `PILOT CANDIDATE`, so a valuable real-world campaign is not recommended. A deliberately low-value campaign may use `RAW_UNIQUE_SUPPORT@2` only if it is explicitly described as a research control and the organizer's resource/delivery commitment is defined.",
    "",
    "## Required Properties of a Future Candidate",
    "",
    ...report.decision.propertiesRequiredOfFutureCandidate.map((property) => `- ${property}`),
    "",
    "## Final Answer",
    "",
    `**Given what we now know, what should determine the recipients of a serious TAKE campaign?** ${report.decision.seriousCampaignRecipientRule}`,
    "",
    "The defensible product direction is disjoint selectors and recipients, frozen eligibility, one TAKE per canonical giver, and public replay artifacts. But the allocation rule that should convert valid support into seats is still unresolved. That is the result of this gate, not a missing marketing answer.",
    ""
  );
  return lines.join("\n");
}

function table(headers: string[], rows: string[][]) {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.join(" | ")} |`)
  ].join("\n");
}

function percent(value: number | undefined | null) {
  return value == null || !Number.isFinite(value) ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

function number(value: number | undefined | null) {
  return value == null || !Number.isFinite(value) ? "n/a" : value.toFixed(3);
}

function signed(value: number | undefined | null) {
  if (value == null || !Number.isFinite(value)) return "n/a";
  return `${value >= 0 ? "+" : ""}${value.toFixed(3)}`;
}

function interval(value: [number, number] | null) {
  return value ? `95% CI ${number(value[0])} to ${number(value[1])}` : "CI unavailable";
}

function parameterLabel(strategy: { strategyId: string; minimumSupport?: number; supportCap?: number }) {
  const parameters = [
    strategy.minimumSupport === undefined ? null : `min=${strategy.minimumSupport}`,
    strategy.supportCap === undefined ? null : `cap=${strategy.supportCap}`
  ].filter(Boolean);
  return parameters.length ? parameters.join(", ") : strategy.strategyId;
}
