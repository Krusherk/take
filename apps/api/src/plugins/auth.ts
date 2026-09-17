import fp from "fastify-plugin";
import { PrivyAuthService } from "../services/privyAuth.js";
import { IdentityService, type ResolvedTakeIdentity } from "../services/identity.js";
import { ServiceError } from "../services/errors.js";

export const authPlugin = fp(async (app) => {
  app.decorate("privyAuth", new PrivyAuthService(app.env));
  app.decorate("identityService", new IdentityService(app.db));

  app.decorateRequest("takeIdentity", null);

  app.addHook("preHandler", async (request) => {
    const token = extractBearerToken(request.headers.authorization);
    if (!token) {
      return;
    }

    try {
      const result = await app.privyAuth.verifyAccessToken(token);
      request.takeIdentity = await app.identityService.resolvePrivyUser(result.user);
    } catch (error) {
      if (isInvalidPrivyToken(error)) {
        throw new ServiceError(
          "UNAUTHORIZED",
          "Your TAKE session has expired. Sign in again to continue.",
          401,
        );
      }
      throw error;
    }
  });
});

function isInvalidPrivyToken(error: unknown): boolean {
  return error instanceof Error
    && (error.name === "InvalidAuthTokenError" || error.message === "Failed to verify authentication token");
}

function extractBearerToken(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const [scheme, token] = value.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return undefined;
  }

  return token;
}

declare module "fastify" {
  interface FastifyInstance {
    privyAuth: PrivyAuthService;
    identityService: IdentityService;
  }

  interface FastifyRequest {
    takeIdentity: ResolvedTakeIdentity | null;
  }
}
