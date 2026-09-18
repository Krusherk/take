import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export function usesTransactionPooler(databaseUrl: string) {
  const url = new URL(databaseUrl);
  return url.port === "6543" && url.hostname.endsWith(".pooler.supabase.com");
}

export function createDatabaseClient(databaseUrl: string) {
  const client = postgres(databaseUrl, {
    max: 10,
    ...(usesTransactionPooler(databaseUrl) ? { prepare: false } : {})
  });
  return {
    client,
    db: drizzle(client, { schema })
  };
}

export type Database = ReturnType<typeof createDatabaseClient>["db"];
