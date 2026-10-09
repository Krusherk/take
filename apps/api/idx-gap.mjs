import { createDatabaseClient } from "@take/database";
import { loadApiEnv } from "./dist/config/env.js";
import { QuickNodeIndexer } from "./dist/workers/quicknodeIndexer.js";
const env = loadApiEnv({ ...process.env });
const db = createDatabaseClient(env.DATABASE_URL);
const idx = new QuickNodeIndexer(db.db, env);
const t = Date.now(); let ok = 0, fail = 0, last;
while (Date.now() - t < 3_000_000) {
  try { last = await idx.runOnce(); ok++; if (ok % 50 === 0) console.log(ok, fail, last.toBlock); if (BigInt(last.toBlock) >= 68679738n) break; }
  catch { fail++; await new Promise(r => setTimeout(r, 1500)); }
}
console.log(JSON.stringify({ secs: (Date.now() - t) / 1000, ok, fail, last }));
console.log(await db.client`select event_name, block_number, transaction_hash, payload from chain_events order by block_number`);
await db.client.end();
