import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { contextPlugin } from "./plugins/context.js";
import { authPlugin } from "./plugins/auth.js";
import { internalAuthPlugin } from "./plugins/internalAuth.js";
import { healthRoutes } from "./routes/health.js";
import { meRoutes } from "./routes/me.js";
import { campaignRoutes } from "./routes/campaigns.js";
import { indexerRoutes } from "./routes/indexer.js";
import { reconciliationRoutes } from "./routes/reconciliation.js";
import { socialRoutes } from "./routes/social.js";
import { mechanismRoutes } from "./routes/mechanism.js";
import { selectorEligibilityRoutes } from "./routes/selectorEligibility.js";
import { operatorRoutes } from "./routes/operator.js";
import { campaignLifecycleRoutes } from "./routes/campaignLifecycle.js";
import { ServiceError } from "./services/errors.js";
import { ZodError } from "zod";

export async function buildApp() {
  const app = Fastify({
    logger: true
  });

  await app.register(contextPlugin);
  await app.register(cors, {
    origin: app.env.WEB_ORIGIN ?? (app.env.NODE_ENV === "development" ? true : false),
    methods: ["GET", "POST", "PUT", "PATCH", "OPTIONS"]
  });
  await app.register(rateLimit, {
    global: false,
    max: 60,
    timeWindow: "1 minute"
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ServiceError) {
      return reply.code(error.statusCode).send({
        error: error.code,
        message: error.message,
        details: error.details
      });
    }
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: "INVALID_REQUEST",
        message: "Request validation failed",
        details: error.issues
      });
    }
    app.log.error(error);
    return reply.code(500).send({ error: "INTERNAL_ERROR", message: "Internal server error" });
  });
  await app.register(authPlugin);
  await app.register(internalAuthPlugin);
  await app.register(healthRoutes);
  await app.register(meRoutes);
  await app.register(campaignRoutes);
  await app.register(indexerRoutes);
  await app.register(reconciliationRoutes);
  await app.register(socialRoutes);
  await app.register(mechanismRoutes);
  await app.register(selectorEligibilityRoutes);
  await app.register(operatorRoutes);
  await app.register(campaignLifecycleRoutes);

  return app;
}
