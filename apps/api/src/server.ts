import { buildApp } from "./app.js";
import { loadApiEnv } from "./config/env.js";

const env = loadApiEnv();
const app = await buildApp();

await app.listen({
  host: "0.0.0.0",
  port: env.PORT
});
