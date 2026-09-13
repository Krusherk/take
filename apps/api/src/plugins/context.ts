import fp from "fastify-plugin";
import { createDatabaseClient } from "@take/database";
import { loadApiEnv } from "../config/env.js";

export const contextPlugin = fp(async (app) => {
  const env = loadApiEnv();
  const database = createDatabaseClient(env.DATABASE_URL);

  app.decorate("env", env);
  app.decorate("db", database.db);
  app.addHook("onClose", async () => {
    await database.client.end();
  });
});

declare module "fastify" {
  interface FastifyInstance {
    env: ReturnType<typeof loadApiEnv>;
    db: ReturnType<typeof createDatabaseClient>["db"];
  }
}
