import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "@take/database";
import { schema } from "@take/database";
import { forbidden } from "./errors.js";
import type { ApiEnv } from "../config/env.js";
import type { ResolvedTakeIdentity } from "./identity.js";

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

export function isTakeOperator(env: ApiEnv, identity: ResolvedTakeIdentity | null | undefined) {
  return Boolean(identity && env.TAKE_OPERATOR_PRIVY_USER_IDS.includes(identity.privyUserId));
}

export function assertTakeOperator(env: ApiEnv, identity: ResolvedTakeIdentity | null | undefined) {
  if (!isTakeOperator(env, identity)) forbidden("TAKE operator access is required for this action");
  return identity!;
}
