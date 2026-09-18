import { z } from "zod";

const optionalNonEmptyString = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).optional()
);
const optionalUrl = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().url().optional()
);
const optionalAddress = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional()
);
const urlList = z.string().default(
  "https://api.drand.sh,https://api2.drand.sh,https://drand.cloudflare.com"
).transform((value, context) => {
  const entries = [...new Set(value.split(",").map((entry) => entry.trim()).filter(Boolean))];
  if (entries.length < 2) {
    context.addIssue({ code: "custom", message: "At least two drand relays are required" });
    return z.NEVER;
  }
  for (const entry of entries) {
    try {
      if (new URL(entry).protocol !== "https:") throw new Error("not HTTPS");
    } catch {
      context.addIssue({ code: "custom", message: `Invalid HTTPS drand relay: ${entry}` });
      return z.NEVER;
    }
  }
  return entries;
});
const commaSeparatedList = z.preprocess(
  (value) => value ?? "",
  z.string().transform((value) => [...new Set(value.split(",").map((entry) => entry.trim()).filter(Boolean))])
);
const booleanFlag = z.preprocess(
  (value) => value === true || value === "true" || value === "1",
  z.boolean().default(false)
);

export const apiEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.string().default("info"),
  WEB_ORIGIN: optionalUrl,
  DATABASE_URL: z.string().url(),
  PRIVY_APP_ID: optionalNonEmptyString,
  PRIVY_APP_SECRET: optionalNonEmptyString,
  PRIVY_VERIFICATION_KEY: optionalNonEmptyString,
  INTERNAL_API_TOKEN: optionalNonEmptyString,
  X_API_BEARER_TOKEN: optionalNonEmptyString,
  DISCORD_APPLICATION_ID: optionalNonEmptyString,
  DISCORD_BOT_TOKEN: optionalNonEmptyString,
  DISCORD_INSTALL_REDIRECT_URI: optionalUrl,
  DISCORD_INSTALL_STATE_SECRET: optionalNonEmptyString,
  TAKE_OPERATOR_PRIVY_USER_IDS: commaSeparatedList,
  ENABLE_DEV_FIXTURES: booleanFlag,
  MONAD_NETWORK: z.enum(["testnet", "mainnet"]).default("testnet"),
  MONAD_TESTNET_RPC_URL: optionalUrl,
  MONAD_MAINNET_RPC_URL: optionalUrl,
  TAKE_CAMPAIGN_MANAGER_ADDRESS: optionalAddress,
  TAKE_CAMPAIGN_MANAGER_START_BLOCK: z.coerce.number().int().nonnegative().default(0),
  CHAIN_INDEXER_CONFIRMATIONS: z.coerce.number().int().nonnegative().default(2),
  CHAIN_INDEXER_MAX_BLOCK_RANGE: z.coerce.number().int().positive().max(1000).default(1000),
  CHAIN_INDEXER_REORG_LOOKBACK: z.coerce.number().int().positive().max(10_000).default(128),
  EVIDENCE_COLLECTION_CONCURRENCY: z.coerce.number().int().positive().max(20).default(5),
  DRAND_RELAY_URLS: urlList,
  DRAND_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().max(30_000).default(8_000)
}).superRefine((env, context) => {
  if (env.NODE_ENV === "production" && !env.INTERNAL_API_TOKEN) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "INTERNAL_API_TOKEN is required in production",
      path: ["INTERNAL_API_TOKEN"]
    });
  }
  const discordValues = [
    env.DISCORD_APPLICATION_ID,
    env.DISCORD_BOT_TOKEN,
    env.DISCORD_INSTALL_REDIRECT_URI,
    env.DISCORD_INSTALL_STATE_SECRET
  ];
  if (discordValues.some(Boolean) && !discordValues.every(Boolean)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Discord application ID, bot token, install redirect URI, and state secret must be configured together",
      path: ["DISCORD_APPLICATION_ID"]
    });
  }
});

export type ApiEnv = z.infer<typeof apiEnvSchema>;

export function loadApiEnv(env: NodeJS.ProcessEnv = process.env): ApiEnv {
  return apiEnvSchema.parse(env);
}
