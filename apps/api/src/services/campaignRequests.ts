import { and, desc, eq } from "drizzle-orm";
import type { Database } from "@take/database";
import { schema } from "@take/database";
import { assertOrganizationRole } from "./authorization.js";
import { ServiceError, notFound } from "./errors.js";

export interface CampaignRequestInput {
  organizationId: string;
  title: string;
  description: string;
  resourceName: string;
  resourceDescription?: string;
  seatCount: number;
  startTime: Date;
  endTime: Date;
  selectorMode: "DISJOINT" | "OVERLAPPING";
  eligibilityDescription?: string;
}

export class CampaignRequestService {
  constructor(private readonly db: Database) {}

  async listMine(identityId: string) {
    const memberships = await this.db
      .select({ organizationId: schema.organizationMembers.organizationId })
      .from(schema.organizationMembers)
      .where(eq(schema.organizationMembers.takeIdentityId, identityId));
    if (!memberships.length) return [];
    const organizationIds = memberships.map((item) => item.organizationId);
    const records = await this.db.query.campaignRequests.findMany({
      where: (request, { inArray }) => inArray(request.organizationId, organizationIds),
      orderBy: (request, { desc }) => [desc(request.createdAt)]
    });
    return records.map(serializeRequest);
  }

  async listOperator() {
    const rows = await this.db
      .select({ request: schema.campaignRequests, organizationName: schema.organizations.name })
      .from(schema.campaignRequests)
      .innerJoin(schema.organizations, eq(schema.organizations.id, schema.campaignRequests.organizationId))
      .orderBy(desc(schema.campaignRequests.createdAt));
    return rows.map(({ request, organizationName }) => ({ ...serializeRequest(request), organizationName }));
  }

  async createDraft(input: CampaignRequestInput, identityId: string) {
    await assertOrganizationRole(this.db, input.organizationId, identityId, ["OWNER", "ADMIN"]);
    validateTimes(input.startTime, input.endTime);
    const [record] = await this.db.insert(schema.campaignRequests).values({
      ...input,
      requestedByIdentityId: identityId,
      status: "DRAFT"
    }).returning();
    if (!record) throw new Error("Failed to create campaign request");
    return serializeRequest(record);
  }

  async updateDraft(id: string, input: CampaignRequestInput, identityId: string) {
    const current = await this.get(id);
    await assertOrganizationRole(this.db, current.organizationId, identityId, ["OWNER", "ADMIN"]);
    if (!["DRAFT", "CHANGES_REQUESTED"].includes(current.status)) {
      throw new ServiceError("REQUEST_NOT_EDITABLE", "Only draft requests or requested changes may be edited", 409);
    }
    if (input.organizationId !== current.organizationId) {
      throw new ServiceError("ORGANIZATION_IMMUTABLE", "A campaign request cannot be moved to another organization", 409);
    }
    validateTimes(input.startTime, input.endTime);
    const [updated] = await this.db.update(schema.campaignRequests).set({
      ...input,
      status: "DRAFT",
      operatorNote: null,
      submittedAt: null,
      updatedAt: new Date()
    }).where(eq(schema.campaignRequests.id, id)).returning();
    return serializeRequest(updated!);
  }

  async submit(id: string, identityId: string) {
    const current = await this.get(id);
    await assertOrganizationRole(this.db, current.organizationId, identityId, ["OWNER", "ADMIN"]);
    if (current.status !== "DRAFT") {
      throw new ServiceError("REQUEST_NOT_SUBMITTABLE", "Only a draft campaign request can be submitted", 409);
    }
    const [updated] = await this.db.update(schema.campaignRequests).set({
      status: "SUBMITTED",
      submittedAt: new Date(),
      updatedAt: new Date()
    }).where(eq(schema.campaignRequests.id, id)).returning();
    return serializeRequest(updated!);
  }

  async requestChanges(id: string, note: string) {
    return this.decide(id, "CHANGES_REQUESTED", note);
  }

  async reject(id: string, note: string) {
    return this.decide(id, "REJECTED", note);
  }

  async provision(id: string, operatorIdentityId: string) {
    const request = await this.get(id);
    if (request.status === "PROVISIONED" && request.provisionedCampaignId) {
      const [campaign] = await this.db.select().from(schema.campaigns)
        .where(eq(schema.campaigns.id, request.provisionedCampaignId)).limit(1);
      return { request: serializeRequest(request), campaign };
    }
    if (request.status !== "SUBMITTED") {
      throw new ServiceError("REQUEST_NOT_READY", "Only a submitted campaign request can be provisioned", 409);
    }
    return this.db.transaction(async (tx) => {
      const [campaign] = await tx.insert(schema.campaigns).values({
        organizationId: request.organizationId,
        createdByIdentityId: operatorIdentityId,
        campaignRequestId: request.id,
        status: "DRAFT",
        title: request.title,
        description: request.description,
        eligibilityDescription: request.eligibilityDescription,
        startTime: request.startTime,
        endTime: request.endTime,
        nominationLimit: 1,
        nominatorEligibilityMode: "MERKLE_ALLOWLIST",
        recipientEligibilityMode: "MERKLE_ALLOWLIST",
        nominationVisibilityMode: "PUBLIC"
      }).returning();
      if (!campaign) throw new Error("Failed to provision campaign");
      await tx.insert(schema.campaignResources).values({
        campaignId: campaign.id,
        type: "OPPORTUNITY",
        name: request.resourceName,
        description: request.resourceDescription ?? request.description,
        quantity: request.seatCount
      });
      const [updatedRequest] = await tx.update(schema.campaignRequests).set({
        status: "PROVISIONED",
        provisionedCampaignId: campaign.id,
        decidedAt: new Date(),
        updatedAt: new Date()
      }).where(eq(schema.campaignRequests.id, request.id)).returning();
      await tx.insert(schema.auditLogs).values({
        actorIdentityId: operatorIdentityId,
        organizationId: request.organizationId,
        campaignId: campaign.id,
        action: "MANAGED_CAMPAIGN_PROVISIONED",
        metadata: { campaignRequestId: request.id }
      });
      return { request: serializeRequest(updatedRequest!), campaign };
    });
  }

  private async decide(id: string, status: "CHANGES_REQUESTED" | "REJECTED", note: string) {
    const current = await this.get(id);
    if (current.status !== "SUBMITTED") {
      throw new ServiceError("REQUEST_NOT_PENDING", "This campaign request is no longer awaiting review", 409);
    }
    const [updated] = await this.db.update(schema.campaignRequests).set({
      status,
      operatorNote: note,
      decidedAt: new Date(),
      updatedAt: new Date()
    }).where(eq(schema.campaignRequests.id, id)).returning();
    return serializeRequest(updated!);
  }

  private async get(id: string) {
    const [record] = await this.db.select().from(schema.campaignRequests)
      .where(eq(schema.campaignRequests.id, id)).limit(1);
    if (!record) notFound("Campaign request not found");
    return record;
  }
}

function validateTimes(startTime: Date, endTime: Date) {
  if (endTime <= startTime) throw new ServiceError("INVALID_CAMPAIGN_TIME", "Campaign end must be after its start", 400);
  if (endTime <= new Date()) throw new ServiceError("INVALID_CAMPAIGN_TIME", "Campaign end must be in the future", 400);
}

function serializeRequest(record: typeof schema.campaignRequests.$inferSelect) {
  return {
    ...record,
    startTime: record.startTime.toISOString(),
    endTime: record.endTime.toISOString(),
    submittedAt: record.submittedAt?.toISOString() ?? null,
    decidedAt: record.decidedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString()
  };
}
