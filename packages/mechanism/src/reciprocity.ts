import type { GraphSignalV1, NominationEdgeV1 } from "./types.js";
import { domainHash } from "./canonical.js";

export function compareChainOrder(left: NominationEdgeV1, right: NominationEdgeV1): number {
  const blockComparison = compareBigIntString(left.blockNumber, right.blockNumber);
  if (blockComparison !== 0) return blockComparison;
  if (left.transactionIndex !== right.transactionIndex) return left.transactionIndex - right.transactionIndex;
  if (left.logIndex !== right.logIndex) return left.logIndex - right.logIndex;
  return left.id.localeCompare(right.id);
}

export function applyRejectLaterReciprocity(edges: readonly NominationEdgeV1[]): {
  edges: NominationEdgeV1[];
  signals: GraphSignalV1[];
} {
  const ordered = [...edges].sort(compareChainOrder);
  const seen = new Map<string, NominationEdgeV1>();
  const signals: GraphSignalV1[] = [];
  const output = ordered.map((edge) => {
    if (edge.validity === "INVALID") return { ...edge };
    const forward = directedKey(edge.canonicalGiverKey, edge.canonicalRecipientKey);
    const reverse = directedKey(edge.canonicalRecipientKey, edge.canonicalGiverKey);
    const reciprocal = seen.get(reverse);
    if (!reciprocal) {
      seen.set(forward, edge);
      return { ...edge };
    }

    const invalidated: NominationEdgeV1 = {
      ...edge,
      validity: "INVALID",
      invalidReason: "DIRECT_RECIPROCITY_REJECT_LATER_EDGE"
    };
    const signalId = domainHash("TAKE_GRAPH_SIGNAL_V1", {
      type: "DIRECT_RECIPROCITY",
      firstEdgeId: reciprocal.id,
      rejectedEdgeId: edge.id
    });
    signals.push({
      id: signalId,
      signalType: "DIRECT_RECIPROCITY",
      algorithmVersion: "1",
      status: "NEEDS_REVIEW",
      subjectKeys: [edge.canonicalGiverKey, edge.canonicalRecipientKey],
      edgeIds: [reciprocal.id, edge.id],
      strength: 1,
      evidence: { firstEdgeId: reciprocal.id, rejectedEdgeId: edge.id }
    });
    return invalidated;
  });
  return { edges: output, signals };
}

export function observeDirectReciprocity(edges: readonly NominationEdgeV1[]): {
  edges: NominationEdgeV1[];
  signals: GraphSignalV1[];
} {
  const ordered = [...edges].sort(compareChainOrder).map((edge) => ({ ...edge }));
  const seen = new Map<string, NominationEdgeV1>();
  const signals: GraphSignalV1[] = [];
  for (const edge of ordered) {
    if (edge.validity === "INVALID") continue;
    const forward = directedKey(edge.canonicalGiverKey, edge.canonicalRecipientKey);
    const reverse = directedKey(edge.canonicalRecipientKey, edge.canonicalGiverKey);
    const reciprocal = seen.get(reverse);
    if (reciprocal) {
      signals.push({
        id: domainHash("TAKE_GRAPH_SIGNAL_V1", {
          type: "DIRECT_RECIPROCITY",
          firstEdgeId: reciprocal.id,
          secondEdgeId: edge.id,
          treatment: "OBSERVATION_ONLY"
        }),
        signalType: "DIRECT_RECIPROCITY",
        algorithmVersion: "1",
        status: "NEEDS_REVIEW",
        subjectKeys: [edge.canonicalGiverKey, edge.canonicalRecipientKey],
        edgeIds: [reciprocal.id, edge.id],
        strength: 1,
        evidence: {
          firstEdgeId: reciprocal.id,
          secondEdgeId: edge.id,
          affectsNominationValidity: false,
          affectsAllocationInput: false
        }
      });
    }
    seen.set(forward, edge);
  }
  return { edges: ordered, signals };
}

function directedKey(from: string, to: string): string {
  return `${from.toLowerCase()}>${to.toLowerCase()}`;
}

function compareBigIntString(left: string, right: string): number {
  const a = BigInt(left);
  const b = BigInt(right);
  return a === b ? 0 : a < b ? -1 : 1;
}
