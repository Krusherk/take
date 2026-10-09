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
import { signalRoutes } from "./routes/signal.js";
import { cronRoutes } from "./routes/cron.js";
import { signupRoutes } from "./routes/signups.js";

export async function buildApp() {
  const app = Fastify({
    logger: true
  });

  await app.register(contextPlugin);
  await app.register(cors, {
    origin: app.env.WEB_ORIGIN ?? (app.env.NODE_ENV === "development" ? true : false),
    // Reuse successful browser preflights; authenticated responses are not cached.
    maxAge: 600,
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
    // Framework client errors (bad content type, malformed JSON, oversized body) keep their 4xx.
    const statusCode = (error as { statusCode?: unknown }).statusCode;
    if (typeof statusCode === "number" && statusCode >= 400 && statusCode < 500) {
      return reply.code(statusCode).send({ error: (error as { code?: string }).code ?? "BAD_REQUEST", message: error instanceof Error ? error.message : "Bad request" });
    }
    // RPC/client exceptions may embed credentials in URLs or request headers.
    app.log.error(safeErrorDetails(error), "TAKE request failed");
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
  await app.register(signalRoutes);
  await app.register(cronRoutes);
  await app.register(signupRoutes);

  return app;
}

/** Error class, codes and a short message with URLs, hex keys and quoted secrets removed. */
export function safeErrorDetails(error: unknown) {
  const details: Record<string, string> = { name: error instanceof Error ? error.name : "UnknownError" };
  let current: unknown = error;
  for (let depth = 0; current && typeof current === "object" && depth < 4; depth += 1) {
    const item = current as { code?: unknown; errno?: unknown; message?: unknown; severity?: unknown };
    const prefix = depth === 0 ? "" : `cause${depth}`;
    if (typeof item.code === "string" || typeof item.code === "number") details[`${prefix}code`] = String(item.code);
    if (typeof item.severity === "string") details[`${prefix}severity`] = item.severity;
    if (typeof item.message === "string") details[`${prefix}message`] = redact(item.message);
    current = (current as { cause?: unknown }).cause;
  }
  return details;
}

function redact(message: string) {
  return message
    .replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, "[url]")
    .replace(/0x[0-9a-f]{40,}/gi, "[hex]")
    .replace(/(password|secret|token|key)\S*\s*[=:]\s*\S+/gi, "$1=[redacted]")
    .slice(0, 300);
}
