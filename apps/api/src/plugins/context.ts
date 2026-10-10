import fp from "fastify-plugin";
import { createDatabaseClient } from "@take/database";
import { loadApiEnv } from "../config/env.js";

export const contextPlugin = fp(async (app) => {
  const env = loadApiEnv();
  const database = createDatabaseClient(env.DATABASE_URL);

  app.decorate("env", env);
  app.decorate("db", database.db);
  app.addHook("onClose", async () => {
    // Bounded: a recycled instance must not wait on a connection that never answers.
    await database.client.end({ timeout: 5 });
  });
});

declare module "fastify" {
  interface FastifyInstance {
    env: ReturnType<typeof loadApiEnv>;
    db: ReturnType<typeof createDatabaseClient>["db"];
  }
}
