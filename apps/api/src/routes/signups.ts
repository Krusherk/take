import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";
import { and, desc, eq, isNull, inArray } from "drizzle-orm";
import { schema } from "@take/database";
import { isTakeOperator } from "../services/authorization.js";
import { AutoFinalizer } from "../services/autoFinalizer.js";
import { GasDripService } from "../services/gasDrip.js";
import { CampaignSignupService } from "../services/signups.js";
import { ServiceError } from "../services/errors.js";

const code = z.string().trim().regex(/^[a-z0-9]{6,32}$/i);
const role = z.enum(["GIVER", "RECIPIENT"]);

export const signupRoutes: FastifyPluginAsync = async (app) => {
  const signups = new CampaignSignupService(app.db, app.env);

  function requireIdentity(request: FastifyRequest) {
    if (!request.takeIdentity) throw new ServiceError("UNAUTHORIZED", "Sign in to continue.", 401);
    return request.takeIdentity;
  }
  function actor(request: FastifyRequest) {
    const identity = requireIdentity(request);
    return { takeIdentityId: identity.takeIdentityId, isOperator: isTakeOperator(app.env, identity) };
  }

  // ---- public join link
  app.get<{ Params: { code: string }; Querystring: { for?: string } }>(
    "/join/:code",
    { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
    async (request) => signups.joinView(
      code.parse(request.params.code),
      request.takeIdentity?.takeIdentityId ?? null,
      request.query.for ? z.string().trim().max(80).parse(request.query.for) : null
    )
  );

  app.post<{ Params: { code: string } }>(
    "/join/:code",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request) => {
      const identity = requireIdentity(request);
      const body = z.object({ role: role.default("GIVER"), for: z.string().trim().max(80).nullish() }).parse(request.body ?? {});
      const joined = await signups.join(code.parse(request.params.code), identity, { role: body.role, forRef: body.for ?? null });
      // New givers get a little MON for gas right away; failures never block joining.
      const gas = joined.joinedAs === "GIVER"
        ? await new GasDripService(app.db, app.env).drip(identity).catch(() => ({ outcome: "FAILED" as const }))
        : null;
      return { ...joined, gas };
    }
  );

  app.post<{ Params: { code: string } }>(
    "/join/:code/interest",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request) => signups.registerInterest(code.parse(request.params.code), requireIdentity(request))
  );

  // ---- organizer
  app.get("/organizer/signups", async (request) => signups.listForOrganizer(actor(request)));

  app.get<{ Params: { id: string } }>("/organizer/campaigns/:id/signups", async (request) =>
    signups.organizerView(z.string().uuid().parse(request.params.id), actor(request)));

  app.patch<{ Params: { id: string } }>("/organizer/campaigns/:id/signups", async (request) => {
    const body = z.object({
      signupDeadline: z.coerce.date().nullable().optional(),
      recipientSelfJoin: z.boolean().optional(),
      joinEnabled: z.boolean().optional(),
      minXAccountAgeDays: z.number().int().min(1).max(3650).nullable().optional()
    }).strict().parse(request.body ?? {});
    return signups.updateSettings(z.string().uuid().parse(request.params.id), actor(request), body);
  });

  // Members-only join link: X handles and/or wallets; DELETE clears the list.
  app.put<{ Params: { id: string } }>("/organizer/campaigns/:id/signups/member-list", { bodyLimit: 1_048_576 }, async (request) => {
    const body = z.object({ community: z.string().trim().min(1).max(120), entries: z.string().max(1_000_000) }).strict().parse(request.body);
    return signups.setMemberList(z.string().uuid().parse(request.params.id), actor(request), body);
  });
  app.delete<{ Params: { id: string } }>("/organizer/campaigns/:id/signups/member-list", async (request) =>
    signups.setMemberList(z.string().uuid().parse(request.params.id), actor(request), null));

  app.post<{ Params: { id: string } }>("/organizer/campaigns/:id/signups/members", async (request) => {
    const body = z.object({ takeIdentityId: z.string().uuid(), role }).strict().parse(request.body);
    return signups.addMember(z.string().uuid().parse(request.params.id), actor(request), body.takeIdentityId, body.role);
  });

  app.post<{ Params: { id: string; identityId: string } }>("/organizer/campaigns/:id/signups/members/:identityId/remove", async (request) =>
    signups.removeMember(z.string().uuid().parse(request.params.id), actor(request), z.string().uuid().parse(request.params.identityId)));

  app.post<{ Params: { id: string } }>(
    "/organizer/campaigns/:id/signups/close",
    { config: { rateLimit: { max: 6, timeWindow: "1 minute" } } },
    async (request) => signups.requestClose(z.string().uuid().parse(request.params.id), actor(request), new AutoFinalizer(app.db, app.env))
  );

  // ---- me
  app.post("/me/gas-drip", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request) =>
    new GasDripService(app.db, app.env).drip(requireIdentity(request)));

  app.get("/me/notifications", async (request) => {
    const identity = requireIdentity(request);
    const rows = await app.db.select().from(schema.notifications)
      .where(and(
        eq(schema.notifications.recipientTakeIdentityId, identity.takeIdentityId),
        inArray(schema.notifications.type, ["NOMINATIONS_OPEN"])
      ))
      .orderBy(desc(schema.notifications.createdAt))
      .limit(50);
    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      payload: row.payload,
      readAt: row.readAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString()
    }));
  });

  app.post("/me/notifications/read", async (request) => {
    const identity = requireIdentity(request);
    await app.db.update(schema.notifications).set({ readAt: new Date() }).where(and(
      eq(schema.notifications.recipientTakeIdentityId, identity.takeIdentityId),
      isNull(schema.notifications.readAt)
    ));
    return { ok: true };
  });
};
