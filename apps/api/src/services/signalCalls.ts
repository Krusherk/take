import { and, eq } from "drizzle-orm";
import { schema, type Database } from "@take/database";
import type { SignalCallEntry, SignalCallSplit, SignalCallValue, SignalCalls } from "@take/shared";
import { ServiceError } from "./errors.js";
import { SignalService } from "./signal.js";

type CallRow = { recipientKey: string; call: string };

/** Calls stay open until the locked check date. A person who was not chosen has nothing to check. */
export function callWindow(evaluateAfter: Date | null, receivedOpportunity: boolean | null, now = new Date()) {
  if (!evaluateAfter) return { open: false, closesAt: null };
  return { open: receivedOpportunity !== false && now < evaluateAfter, closesAt: evaluateAfter.toISOString() };
}

export function splitCalls(rows: CallRow[], recipientKey: string): SignalCallSplit {
  const mine = rows.filter((row) => row.recipientKey === recipientKey);
  const count = (value: SignalCallValue) => mine.filter((row) => row.call === value).length;
  return { yes: count("YES"), unsure: count("UNSURE"), no: count("NO"), total: mine.length };
}

/** The table ships in migration 0014. Until it runs, say so instead of failing Signal. */
export function isMissingCallsTable(error: unknown): boolean {
  for (let current: unknown = error, depth = 0; current && depth < 4; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (code === "42P01") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

function unavailable(): never {
  throw new ServiceError("SIGNAL_CALLS_UNAVAILABLE", "Calls are not switched on yet.", 503);
}

export class SignalCallService {
  constructor(private readonly db: Database) {}

  private validEdges(giverKey: string, campaignId?: string) {
    const conditions = [
      eq(schema.nominationEdges.canonicalGiverKey, giverKey.toLowerCase()),
      eq(schema.nominationEdges.validity, "VALID"),
      eq(schema.nominationEdges.finalityStatus, "FINALIZED"),
      eq(schema.chainEvents.finalityStatus, "FINALIZED")
    ];
    if (campaignId) conditions.push(eq(schema.nominationEdges.campaignId, campaignId));
    return this.db.select({ campaignId: schema.nominationEdges.campaignId, recipientKey: schema.nominationEdges.canonicalRecipientKey })
      .from(schema.nominationEdges)
      .innerJoin(schema.chainEvents, eq(schema.chainEvents.id, schema.nominationEdges.chainEventId))
      .where(and(...conditions));
  }

  async mine(giverKey: string): Promise<SignalCalls> {
    try {
      const edges = await this.validEdges(giverKey);
      const signal = new SignalService(this.db);
      const calls: SignalCallEntry[] = [];
      const seen = new Set<string>();
      for (const edge of edges) {
        const id = `${edge.campaignId}:${edge.recipientKey}`;
        if (seen.has(id)) continue;
        seen.add(id);
        const campaign = await signal.campaign(edge.campaignId);
        const [plan] = await this.db.select().from(schema.campaignEvaluationPlans)
          .where(eq(schema.campaignEvaluationPlans.campaignId, edge.campaignId)).limit(1);
        if (!plan) continue;
        const allocation = await signal.committedRecipients(campaign);
        const received = allocation.committed ? allocation.keys.includes(edge.recipientKey.toLowerCase()) : null;
        const rows = await this.db.select({ recipientKey: schema.signalCalls.recipientKey, call: schema.signalCalls.call, giverKey: schema.signalCalls.giverKey })
          .from(schema.signalCalls).where(eq(schema.signalCalls.campaignId, edge.campaignId));
        const recipientKey = edge.recipientKey.toLowerCase();
        const mine = rows.find((row) => row.giverKey === giverKey.toLowerCase());
        calls.push({
          campaignId: edge.campaignId,
          recipientKey: edge.recipientKey,
          mine: mine && mine.recipientKey === recipientKey ? mine.call as SignalCallValue : null,
          ...callWindow(plan.evaluateAfter, received),
          // Totals only after the committed result, like every other count in TAKE.
          split: allocation.committed ? splitCalls(rows, recipientKey) : null
        });
      }
      return { calls };
    } catch (error) {
      if (isMissingCallsTable(error)) unavailable();
      throw error;
    }
  }

  async make(campaignId: string, giverKey: string, input: { recipientKey: string; call: SignalCallValue }) {
    const giver = giverKey.toLowerCase();
    try {
      const edges = await this.validEdges(giver, campaignId);
      if (!edges.some((edge) => edge.recipientKey.toLowerCase() === input.recipientKey)) {
        throw new ServiceError("CALL_NOT_ALLOWED", "Only the people who backed someone can make a call on them.", 403);
      }
      const signal = new SignalService(this.db);
      const campaign = await signal.campaign(campaignId);
      const [plan] = await this.db.select().from(schema.campaignEvaluationPlans)
        .where(eq(schema.campaignEvaluationPlans.campaignId, campaignId)).limit(1);
      if (!plan) throw new ServiceError("NO_CHECK_SCHEDULED", "This campaign has no scheduled check to make a call on.", 409);
      const allocation = await signal.committedRecipients(campaign);
      const received = allocation.committed ? allocation.keys.includes(input.recipientKey) : null;
      if (!callWindow(plan.evaluateAfter, received).open) {
        throw new ServiceError("CALLS_CLOSED", "Calls close when the check is due or when the person was not chosen.", 409);
      }
      const values = { campaignId, planId: plan.id, giverKey: giver, recipientKey: input.recipientKey, call: input.call, updatedAt: new Date() };
      await this.db.insert(schema.signalCalls).values(values).onConflictDoUpdate({
        target: [schema.signalCalls.campaignId, schema.signalCalls.giverKey], set: values
      });
      return this.mine(giver).then((result) => result.calls.find((entry) => entry.campaignId === campaignId && entry.recipientKey.toLowerCase() === input.recipientKey) ?? null);
    } catch (error) {
      if (isMissingCallsTable(error)) unavailable();
      throw error;
    }
  }
}
