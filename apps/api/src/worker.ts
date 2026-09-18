import { createDatabaseClient } from "@take/database";
import { loadApiEnv } from "./config/env.js";
import { QuickNodeIndexer } from "./workers/quicknodeIndexer.js";
import { ReceiptReconciler } from "./workers/receiptReconciler.js";
import { CampaignLifecycleService } from "./services/campaignLifecycle.js";

const env = loadApiEnv();
const database = createDatabaseClient(env.DATABASE_URL);
const indexer = new QuickNodeIndexer(database.db, env);
const reconciler = new ReceiptReconciler(database.db, env);
const lifecycle = new CampaignLifecycleService(database.db, env);
let stopping = false;

async function run() {
  while (!stopping) {
    try {
      await indexer.runUntilCaughtUp(4);
      await reconciler.runOnce(50);
      await lifecycle.reconcilePending(25);
    } catch (error) {
      console.error("TAKE worker cycle failed", error);
    }
    await new Promise((resolve) => setTimeout(resolve, 8_000));
  }
}

async function stop() {
  stopping = true;
  await database.client.end();
}

process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());
await run();
