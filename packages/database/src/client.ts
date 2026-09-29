import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export function usesTransactionPooler(databaseUrl: string) {
  const url = new URL(databaseUrl);
  return url.port === "6543" && url.hostname.endsWith(".pooler.supabase.com");
}

export function createDatabaseClient(databaseUrl: string) {
  const client = postgres(databaseUrl, {
    // Each serverless instance owns a pool. Release idle sessions promptly so
    // scaled instances do not exhaust the shared Supabase session pooler.
    ...(process.env.VERCEL
      ? { max: 2, idle_timeout: 10, max_lifetime: 60 }
      : { max: 10 }),
    ...(usesTransactionPooler(databaseUrl) ? { prepare: false } : {})
  });
  return {
    client,
    db: drizzle(client, { schema })
  };
}

export type Database = ReturnType<typeof createDatabaseClient>["db"];
