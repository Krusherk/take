import type { SelectorEligibilityPolicyV1 } from "./eligibilityStack.js";

export type SelectorEligibilityPreset = SelectorEligibilityPolicyV1["preset"];

export function buildSelectorEligibilityPreset(input: {
  preset: SelectorEligibilityPreset;
  campaignId: string;
  candidateAllowlistId: string;
  cutoffAt: string;
  guildId?: string;
  requiredDiscordRoleId?: string;
}): SelectorEligibilityPolicyV1 {
  const beforeThirtyDays = new Date(new Date(input.cutoffAt).getTime() - 30 * 86_400_000).toISOString();
  const communityRules: SelectorEligibilityPolicyV1["categories"][number]["rules"] = input.guildId
    ? input.requiredDiscordRoleId
      ? [
          automated("discord-connected", "Discord identity connected", 5, { id: "discord-connected", version: 1, type: "DISCORD_CONNECTED" }),
          automated("guild-member", "Member of the campaign community", 8, { id: "guild-member", version: 1, type: "DISCORD_GUILD_MEMBER", guildId: input.guildId }),
          automated("guild-before-cutoff", "Member before the eligibility cutoff", 7, { id: "guild-before-cutoff", version: 1, type: "DISCORD_GUILD_JOINED_BEFORE", guildId: input.guildId, before: input.cutoffAt }),
          automated("guild-required-role", "Required Discord community role", 5, { id: "guild-required-role", version: 1, type: "DISCORD_ROLE_REQUIRED", guildId: input.guildId, roleIds: [input.requiredDiscordRoleId], match: "ANY" })
        ]
      : [
          automated("discord-connected", "Discord identity connected", 5, { id: "discord-connected", version: 1, type: "DISCORD_CONNECTED" }),
          automated("guild-member", "Member of the campaign community", 10, { id: "guild-member", version: 1, type: "DISCORD_GUILD_MEMBER", guildId: input.guildId }),
          automated("guild-before-cutoff", "Member before the eligibility cutoff", 10, { id: "guild-before-cutoff", version: 1, type: "DISCORD_GUILD_JOINED_BEFORE", guildId: input.guildId, before: input.cutoffAt })
        ]
    : [
        automated("discord-connected", "Discord identity connected", 5, { id: "discord-connected", version: 1, type: "DISCORD_CONNECTED" }),
        reviewed("community-contribution", "Relevant community contribution verified", 20, "COMMUNITY_CONTRIBUTION", "Share a concise link or description of your contribution.")
      ];

  const base = {
    version: "TAKE_SELECTOR_ELIGIBILITY_V1" as const,
    campaignId: input.campaignId,
    candidateAllowlistId: input.candidateAllowlistId,
    preset: input.preset,
    cutoffAt: input.cutoffAt,
    allowAppeals: true,
    integrityScreeningEnabled: true,
    newcomerPath: {
      enabled: true as const,
      title: "Relevant work alternative",
      description: "Newcomers can qualify by showing relevant work even without long onchain history.",
      requiredEvidence: ["GITHUB_OR_PROJECT"] as ["GITHUB_OR_PROJECT"]
    }
  };

  if (input.preset === "COMMUNITY_CONTRIBUTOR") {
    return {
      ...base,
      categories: [
        category("COMMUNITY", "Community history", 35, scale(communityRules, 35)),
        category("ONCHAIN", "Monad / onchain history", 15, onchainRules(beforeThirtyDays, 15)),
        category("SOCIAL", "Social history", 30, socialRules(30)),
        category("BUILDER", "Contribution history", 20, [reviewed("community-work", "Community work verified", 20, "COMMUNITY_CONTRIBUTION", "Share evidence of work that helped the community.")])
      ],
      requiredTotalPoints: 55,
      minimumDistinctCategories: 2,
      newcomerPath: {
        enabled: true,
        title: "Community contribution alternative",
        description: "Show relevant community work that may not appear in automated history.",
        requiredEvidence: ["COMMUNITY_CONTRIBUTION"]
      }
    };
  }

  if (input.preset === "CREATOR_SOCIAL") {
    return {
      ...base,
      categories: [
        category("COMMUNITY", "Community history", 25, communityRules),
        category("ONCHAIN", "Monad / onchain history", 10, onchainRules(beforeThirtyDays, 10)),
        category("SOCIAL", "Social history", 45, socialRules(45)),
        category("BUILDER", "Creator work", 20, [reviewed("creator-portfolio", "Creator portfolio verified", 20, "PORTFOLIO", "Share a portfolio or representative body of work.")])
      ],
      requiredTotalPoints: 55,
      minimumDistinctCategories: 2,
      newcomerPath: {
        enabled: true,
        title: "Creator portfolio alternative",
        description: "Creators without established Web3 history can qualify through relevant work.",
        requiredEvidence: ["PORTFOLIO"]
      }
    };
  }

  return {
    ...base,
    preset: input.preset,
    categories: [
      category("COMMUNITY", "Community history", 25, communityRules),
      category("ONCHAIN", "Monad / onchain history", 25, onchainRules(beforeThirtyDays, 25)),
      category("BUILDER", "Builder / GitHub history", 30, [
        automated("github-connected", "GitHub identity connected", 10, { id: "github-connected", version: 1, type: "GITHUB_CONNECTED" }),
        reviewed("builder-project", "Relevant project or contribution verified", 20, "GITHUB_OR_PROJECT", "Share a repository, deployed project, demo, or contribution.")
      ]),
      category("SOCIAL", "Social history", 20, socialRules(20))
    ],
    requiredTotalPoints: 60,
    minimumDistinctCategories: 3
  };
}

function category(
  id: SelectorEligibilityPolicyV1["categories"][number]["id"],
  label: string,
  maximumPoints: number,
  rules: SelectorEligibilityPolicyV1["categories"][number]["rules"]
): SelectorEligibilityPolicyV1["categories"][number] {
  return { id, label, enabled: true, maximumPoints, rules };
}

function automated(
  id: string,
  label: string,
  points: number,
  evidenceRule: Extract<SelectorEligibilityPolicyV1["categories"][number]["rules"][number], { source: "AUTOMATED" }>["evidenceRule"]
) {
  return { id, label, points, source: "AUTOMATED" as const, evidenceRule };
}

function reviewed(
  id: string,
  label: string,
  points: number,
  evidenceType: Extract<SelectorEligibilityPolicyV1["categories"][number]["rules"][number], { source: "REVIEWED_SUBMISSION" }>["evidenceType"],
  instructions: string
) {
  return { id, label, points, source: "REVIEWED_SUBMISSION" as const, evidenceType, instructions };
}

function onchainRules(before: string, total: number) {
  const connected = Math.max(1, Math.round(total * 0.32));
  return [
    automated("wallet-connected", "Wallet connected", connected, { id: "wallet-connected", version: 1, type: "WALLET_CONNECTED", chainType: "ethereum" }),
    automated("wallet-history", "Wallet observed before the cutoff window", total - connected, { id: "wallet-history", version: 1, type: "WALLET_FIRST_SEEN_BEFORE", before, source: "TAKE_OBSERVED" })
  ];
}

function socialRules(total: number) {
  const connected = Math.max(1, Math.round(total * 0.25));
  return [
    automated("x-connected", "X identity connected", connected, { id: "x-connected", version: 1, type: "X_CONNECTED" }),
    automated("x-history", "X account is at least 180 days old", total - connected, { id: "x-history", version: 1, type: "X_ACCOUNT_MIN_AGE", minimumDays: 180 })
  ];
}

function scale(rules: SelectorEligibilityPolicyV1["categories"][number]["rules"], target: number) {
  const current = rules.reduce((sum, rule) => sum + rule.points, 0);
  let assigned = 0;
  return rules.map((rule, index) => {
    const points = index === rules.length - 1 ? target - assigned : Math.max(1, Math.round(rule.points / current * target));
    assigned += points;
    return { ...rule, points };
  });
}
