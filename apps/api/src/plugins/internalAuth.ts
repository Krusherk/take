import { timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";

type InternalAuthHandler = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

export const internalAuthPlugin = fp(async (app) => {
  const requireInternalAuth: InternalAuthHandler = async (request, reply) => {
    if (!request.url.startsWith("/internal/")) {
      return;
    }

    const expectedToken = app.env.INTERNAL_API_TOKEN;
    if (!expectedToken && app.env.NODE_ENV !== "production") {
      return;
    }

    const suppliedToken = extractInternalToken(
      request.headers.authorization,
      request.headers["x-internal-token"]
    );

    if (!expectedToken || !suppliedToken || !constantTimeEqual(suppliedToken, expectedToken)) {
      return reply.code(401).send({
        error: "Unauthorized",
        message: "Internal API token is required"
      });
    }
  };

  app.decorate("requireInternalAuth", requireInternalAuth);
});

function extractInternalToken(
  authorization: string | undefined,
  internalTokenHeader: string | string[] | undefined
) {
  if (authorization) {
    const [scheme, token] = authorization.split(" ");
    if (scheme?.toLowerCase() === "bearer" && token) {
      return token;
    }
  }

  if (Array.isArray(internalTokenHeader)) {
    return internalTokenHeader[0];
  }

  return internalTokenHeader;
}

function constantTimeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

declare module "fastify" {
  interface FastifyInstance {
    requireInternalAuth: InternalAuthHandler;
  }
}
