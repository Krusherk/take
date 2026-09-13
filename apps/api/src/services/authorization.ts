import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "@take/database";
import { schema } from "@take/database";
import { forbidden } from "./errors.js";

export type OrganizationRole = "OWNER" | "ADMIN" | "MEMBER";

export async function assertOrganizationRole(
  db: Database,
  organizationId: string,
  takeIdentityId: string,
  roles: readonly OrganizationRole[]
) {
  const [member] = await db
    .select()
    .from(schema.organizationMembers)
    .where(
      and(
        eq(schema.organizationMembers.organizationId, organizationId),
        eq(schema.organizationMembers.takeIdentityId, takeIdentityId),
        inArray(schema.organizationMembers.role, [...roles])
      )
    )
    .limit(1);

  if (!member) forbidden();
  return member;
}
