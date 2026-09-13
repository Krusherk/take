import { asc, eq } from "drizzle-orm";
import type { Database } from "@take/database";
import { schema } from "@take/database";

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
}
