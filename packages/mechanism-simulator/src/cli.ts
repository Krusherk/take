import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createDatabaseClient, schema } from "@take/database";
import { desc, eq } from "drizzle-orm";
import { buildMechanismSimulationReport } from "./report.js";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const runsIndex = process.argv.indexOf("--runs");
const outputIndex = process.argv.indexOf("--output");
const campaignIndex = process.argv.indexOf("--campaign");
const createdByIndex = process.argv.indexOf("--created-by");
const persist = process.argv.includes("--persist");
const runs = runsIndex >= 0 ? Number(process.argv[runsIndex + 1]) : 10_000;
if (!Number.isSafeInteger(runs) || runs <= 0) throw new Error("--runs must be a positive integer");
const campaignId = campaignIndex >= 0 ? requiredArgument("--campaign", campaignIndex) : undefined;
const createdByIdentityId = createdByIndex >= 0 ? requiredArgument("--created-by", createdByIndex) : undefined;

let persistence: Awaited<ReturnType<typeof beginPersistence>> | undefined;
try {
  persistence = persist
    ? await beginPersistence({ campaignId, createdByIdentityId, runs })
    : undefined;
  const report = buildMechanismSimulationReport(runs);
  if (persistence) await persistence.complete(report);

  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (outputIndex >= 0) {
    const output = requiredArgument("--output", outputIndex);
    const outputPath = resolve(repositoryRoot, output);
    await writeFile(outputPath, json, "utf8");
    console.log(`Wrote ${runs}-run mechanism report to ${outputPath}`);
  } else {
    process.stdout.write(json);
  }
} catch (error) {
  await persistence?.fail(error);
  throw error;
} finally {
  await persistence?.close();
}

function requiredArgument(flag: string, index: number) {
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

async function beginPersistence(input: {
  campaignId?: string;
  createdByIdentityId?: string;
  runs: number;
}) {
  if (!process.env.DATABASE_URL) {
    try {
      process.loadEnvFile(resolve(repositoryRoot, ".env"));
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
    }
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required with --persist");
  const database = createDatabaseClient(databaseUrl);
  let mechanismConfigId: string | null = null;
  let configHash: string | null = null;

  if (input.campaignId) {
    const [campaign] = await database.db
      .select({ mechanismConfigId: schema.campaigns.mechanismConfigId })
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, input.campaignId))
      .limit(1);
    if (!campaign) {
      await database.client.end();
      throw new Error(`Campaign ${input.campaignId} does not exist`);
    }
    mechanismConfigId = campaign.mechanismConfigId;
    if (mechanismConfigId) {
      const [config] = await database.db
        .select({ configHash: schema.campaignMechanismConfigs.configHash })
        .from(schema.campaignMechanismConfigs)
        .where(eq(schema.campaignMechanismConfigs.id, mechanismConfigId))
        .orderBy(desc(schema.campaignMechanismConfigs.revision))
        .limit(1);
      configHash = config?.configHash ?? null;
    }
  }

  const [run] = await database.db
    .insert(schema.simulationRuns)
    .values({
      campaignId: input.campaignId,
      mechanismConfigId,
      configHash,
      simulatorVersion: "1",
      runCount: input.runs,
      status: "RUNNING",
      createdByIdentityId: input.createdByIdentityId
    })
    .returning({ id: schema.simulationRuns.id });
  if (!run) {
    await database.client.end();
    throw new Error("Failed to create simulation run");
  }

  let closed = false;
  return {
    async complete(report: ReturnType<typeof buildMechanismSimulationReport>) {
      await database.db
        .update(schema.simulationRuns)
        .set({
          status: "COMPLETED",
          report,
          reportHash: report.reportHash,
          killCriteriaPassed: report.killCriteria.every((criterion) => criterion.status !== "FAIL"),
          completedAt: new Date()
        })
        .where(eq(schema.simulationRuns.id, run.id));
      console.error(`Persisted simulation run ${run.id}`);
    },
    async fail(error: unknown) {
      await database.db
        .update(schema.simulationRuns)
        .set({
          status: "FAILED",
          report: {
            error: error instanceof Error ? error.message : "Simulation failed"
          },
          completedAt: new Date()
        })
        .where(eq(schema.simulationRuns.id, run.id));
    },
    async close() {
      if (closed) return;
      closed = true;
      await database.client.end();
    }
  };
}
