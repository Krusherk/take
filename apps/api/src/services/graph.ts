import { and, asc, desc, eq } from "drizzle-orm";
import type { Database } from "@take/database";
import { schema } from "@take/database";
import {
  analyzeNominationGraph,
  domainHash,
  type NominationEdgeV1
} from "@take/mechanism";
import { notFound, ServiceError } from "./errors.js";

export class GraphService {
  constructor(private readonly db: Database) {}

  async analyzeCampaign(campaignId: string) {
    const [campaign] = await this.db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, campaignId))
      .limit(1);
    if (!campaign) notFound("Campaign not found");
    if (!campaign.chainId || !campaign.managerContractAddress) {
      throw new ServiceError("CAMPAIGN_NOT_INDEXABLE", "Campaign chain deployment is not known", 409);
    }
    const rows = await this.db
      .select()
      .from(schema.nominationEdges)
      .where(
        and(
          eq(schema.nominationEdges.campaignId, campaignId),
          eq(schema.nominationEdges.finalityStatus, "FINALIZED")
        )
      )
      .orderBy(
        asc(schema.nominationEdges.blockNumber),
        asc(schema.nominationEdges.transactionIndex),
        asc(schema.nominationEdges.logIndex)
      );
    const edges = rows.map(toMechanismEdge);
    const analysis = analyzeNominationGraph(edges, {
      reciprocityPolicy: campaign.experimentId ? "OBSERVE_ONLY" : "REJECT_LATER_EDGE"
    });
    const [cursor] = await this.db
      .select()
      .from(schema.chainIndexerCursors)
      .where(
        and(
          eq(schema.chainIndexerCursors.chainId, campaign.chainId),
          eq(schema.chainIndexerCursors.contractAddress, campaign.managerContractAddress)
        )
      )
      .limit(1);
    const lastEdge = rows.at(-1);
    const edgeCutoffBlock = lastEdge?.blockNumber ?? cursor?.lastFinalizedBlock ?? 0n;
    const edgeCutoffBlockHash = lastEdge?.blockHash ?? cursor?.lastFinalizedBlockHash;
    if (!edgeCutoffBlockHash) {
      throw new ServiceError("FINALIZED_CHAIN_HEAD_MISSING", "A finalized indexed chain head is required", 409);
    }
    const inputHash = domainHash("TAKE_GRAPH_INPUT_V1", {
      campaignId,
      edgeCutoffBlock: edgeCutoffBlock.toString(),
      edgeCutoffBlockHash,
      edges: analysis.edges
    });
    const [existing] = await this.db
      .select()
      .from(schema.graphSnapshots)
      .where(eq(schema.graphSnapshots.inputHash, inputHash))
      .limit(1);
    if (existing) return this.getSnapshot(existing.id);

    const artifact = {
      artifactVersion: "1",
      algorithmVersion: "1",
      campaignId,
      edgeCutoffBlock: edgeCutoffBlock.toString(),
      edgeCutoffBlockHash,
      inputHash,
      edges: analysis.edges,
      signals: analysis.signals
    };
    return this.db.transaction(async (tx) => {
      const [snapshot] = await tx
        .insert(schema.graphSnapshots)
        .values({
          campaignId,
          edgeCutoffBlock,
          edgeCutoffBlockHash,
          inputHash,
          algorithmVersion: "1",
          artifact
        })
        .returning();
      if (!snapshot) throw new Error("Failed to persist graph snapshot");

      for (const edge of analysis.edges) {
        const original = rows.find((row) => row.id === edge.id);
        if (
          campaign.experimentId
          || !original
          || (original.validity === edge.validity && original.invalidReason === (edge.invalidReason ?? null))
        ) {
          continue;
        }
        await tx
          .update(schema.nominationEdges)
          .set({ validity: edge.validity, invalidReason: edge.invalidReason ?? null })
          .where(eq(schema.nominationEdges.id, edge.id));
      }

      for (const signal of analysis.signals) {
        const signalHash = domainHash("TAKE_GRAPH_SIGNAL_OBSERVATION_V1", {
          graphSnapshotId: snapshot.id,
          signal
        });
        const [stored] = await tx
          .insert(schema.graphSignalObservations)
          .values({
            graphSnapshotId: snapshot.id,
            signalHash,
            signalType: signal.signalType,
            algorithmVersion: signal.algorithmVersion,
            status: signal.status,
            strengthBasisPoints: signal.strength === undefined ? null : Math.round(signal.strength * 10_000),
            evidence: { ...signal.evidence, edgeIds: signal.edgeIds },
            limitation: signal.limitation
          })
          .returning();
        if (!stored) throw new Error("Failed to persist graph signal");
        if (signal.subjectKeys.length > 0) {
          await tx.insert(schema.graphSignalSubjects).values(
            signal.subjectKeys.map((subjectKey) => ({ graphSignalId: stored.id, subjectKey }))
          );
        }
        if (signal.status === "NEEDS_REVIEW") {
          const [reviewCase] = await tx
            .insert(schema.reviewCases)
            .values({
              campaignId,
              graphSignalId: stored.id,
              caseType: signal.signalType,
              status: "OPEN",
              publicSummary: publicSignalSummary(signal.signalType),
              restrictedSummary: "Review the versioned signal evidence. Correlation alone cannot change allocation inputs."
            })
            .returning();
          if (reviewCase) {
            await tx.insert(schema.reviewCaseEvents).values({
              reviewCaseId: reviewCase.id,
              sequence: 1,
              eventType: "CASE_OPENED_FROM_GRAPH_SIGNAL",
              payload: { graphSnapshotId: snapshot.id, graphSignalId: stored.id, signalHash }
            });
          }
        }
      }
      return { ...artifact, id: snapshot.id };
    });
  }

  async latest(campaignId: string) {
    const [snapshot] = await this.db
      .select()
      .from(schema.graphSnapshots)
      .where(eq(schema.graphSnapshots.campaignId, campaignId))
      .orderBy(desc(schema.graphSnapshots.createdAt))
      .limit(1);
    return snapshot ? this.getSnapshot(snapshot.id) : null;
  }

  async publicLatest(campaignId: string) {
    const [campaign] = await this.db
      .select({ status: schema.campaigns.status, experimentId: schema.campaigns.experimentId })
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, campaignId))
      .limit(1);
    if (!campaign) notFound("Campaign not found");
    if (campaign.experimentId && !isPostClose(campaign.status)) {
      return {
        campaignId,
        status: "HIDDEN_UNTIL_CAMPAIGN_CLOSE" as const,
        signalCounts: null
      };
    }
    const snapshot = await this.latest(campaignId);
    if (!snapshot) return null;
    return publicGraphSnapshot(snapshot);
  }

  private async getSnapshot(id: string) {
    const [snapshot] = await this.db
      .select()
      .from(schema.graphSnapshots)
      .where(eq(schema.graphSnapshots.id, id))
      .limit(1);
    if (!snapshot) notFound("Graph snapshot not found");
    const signals = await this.db
      .select()
      .from(schema.graphSignalObservations)
      .where(eq(schema.graphSignalObservations.graphSnapshotId, snapshot.id));
    return {
      id: snapshot.id,
      campaignId: snapshot.campaignId,
      edgeCutoffBlock: snapshot.edgeCutoffBlock.toString(),
      edgeCutoffBlockHash: snapshot.edgeCutoffBlockHash,
      inputHash: snapshot.inputHash,
      algorithmVersion: snapshot.algorithmVersion,
      artifact: snapshot.artifact,
      signals
    };
  }
}

export function publicGraphSnapshot(snapshot: {
  id: string;
  campaignId: string;
  edgeCutoffBlock: string;
  edgeCutoffBlockHash: string;
  inputHash: string;
  algorithmVersion: string;
  signals: ReadonlyArray<{ signalType: string; status: string }>;
}) {
  const signalCounts = snapshot.signals.reduce<Record<string, number>>((counts, signal) => {
    const key = `${signal.signalType}:${signal.status}`;
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});

  return {
    id: snapshot.id,
    campaignId: snapshot.campaignId,
    edgeCutoffBlock: snapshot.edgeCutoffBlock,
    edgeCutoffBlockHash: snapshot.edgeCutoffBlockHash,
    inputHash: snapshot.inputHash,
    algorithmVersion: snapshot.algorithmVersion,
    signalCounts
  };
}

function toMechanismEdge(row: typeof schema.nominationEdges.$inferSelect): NominationEdgeV1 {
  return {
    id: row.id,
    campaignId: row.campaignId,
    chainId: row.chainId,
    contractAddress: row.contractAddress as `0x${string}`,
    transactionHash: row.transactionHash as `0x${string}`,
    blockNumber: row.blockNumber.toString(),
    transactionIndex: row.transactionIndex,
    logIndex: row.logIndex,
    blockTimestamp: row.blockTimestamp.toISOString(),
    giverIdentityKey: row.giverIdentityKey as `0x${string}`,
    recipientIdentityKey: row.recipientIdentityKey as `0x${string}`,
    canonicalGiverKey: row.canonicalGiverKey as `0x${string}`,
    canonicalRecipientKey: row.canonicalRecipientKey as `0x${string}`,
    validity: row.validity as "VALID" | "INVALID",
    invalidReason: row.invalidReason ?? undefined
  };
}

function publicSignalSummary(signalType: string) {
  switch (signalType) {
    case "DIRECT_RECIPROCITY":
      return "A reciprocal TAKE pair was recorded as behavioral evidence.";
    case "SHORT_CYCLE":
      return "A short nomination cycle was recorded for transparent review.";
    case "TEMPORAL_BURST":
      return "A concentrated timing pattern was recorded for transparent review.";
    default:
      return "A graph pattern was recorded for review.";
  }
}

function isPostClose(status: string) {
  return ["CLOSED", "ALLOCATING", "FINALIZED"].includes(status);
}
