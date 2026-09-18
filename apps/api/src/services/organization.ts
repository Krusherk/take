import { asc, eq } from "drizzle-orm";
import type { Database } from "@take/database";
import { schema } from "@take/database";
import { randomUUID } from "node:crypto";

export class OrganizationService {
  constructor(private readonly db: Database) {}

  async listForIdentity(takeIdentityId: string) {
    return this.db
      .select({
        id: schema.organizations.id,
        name: schema.organizations.name,
        slug: schema.organizations.slug,
        role: schema.organizationMembers.role,
        joinedAt: schema.organizationMembers.createdAt
      })
      .from(schema.organizationMembers)
      .innerJoin(
        schema.organizations,
        eq(schema.organizations.id, schema.organizationMembers.organizationId)
      )
      .where(eq(schema.organizationMembers.takeIdentityId, takeIdentityId))
      .orderBy(asc(schema.organizations.name));
  }

  async create(takeIdentityId: string, name: string) {
    const base = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 72) || "take-community";
    const slug = `${base}-${randomUUID().slice(0, 8)}`;
    return this.db.transaction(async (tx) => {
      const [organization] = await tx.insert(schema.organizations).values({ name, slug }).returning();
      if (!organization) throw new Error("Failed to create organization");
      await tx.insert(schema.organizationMembers).values({ organizationId: organization.id, takeIdentityId, role: "OWNER" });
      await tx.insert(schema.auditLogs).values({
        actorIdentityId: takeIdentityId,
        organizationId: organization.id,
        action: "ORGANIZATION_CREATED",
        metadata: { name, slug }
      });
      return { ...organization, role: "OWNER" as const };
    });
  }
}
