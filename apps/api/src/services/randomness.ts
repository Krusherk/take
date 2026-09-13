import { and, eq } from "drizzle-orm";
import {
  fetchBeacon,
  HttpCachingChain,
  HttpChainClient,
  type ChainInfo,
  type RandomnessBeacon
} from "drand-client";
import type { Database } from "@take/database";
import { schema } from "@take/database";
import {
  domainHash,
  DRAND_EVMNET_CHAIN_HASH,
  DRAND_EVMNET_GENESIS_TIME,
  DRAND_EVMNET_PERIOD_SECONDS,
  DRAND_EVMNET_PUBLIC_KEY
} from "@take/mechanism";
import type { ApiEnv } from "../config/env.js";
import { notFound, ServiceError } from "./errors.js";

interface RelayResult {
  relay: string;
  info: ChainInfo;
  beacon: RandomnessBeacon;
}

export class RandomnessService {
  constructor(
    private readonly db: Database,
    private readonly env: ApiEnv
  ) {}

  async retrieveForCampaign(campaignId: string) {
    const [campaign] = await this.db
      .select({ mechanismConfigId: schema.campaigns.mechanismConfigId })
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, campaignId))
      .limit(1);
    if (!campaign) notFound("Campaign not found");
    if (!campaign.mechanismConfigId) {
      throw new ServiceError(
        "RANDOMNESS_NOT_COMMITTED",
        "This campaign has no locked mechanism randomness commitment",
        409
      );
    }
    const [artifact] = await this.db
      .select()
      .from(schema.randomnessArtifacts)
      .where(
        and(
          eq(schema.randomnessArtifacts.campaignId, campaignId),
          eq(schema.randomnessArtifacts.mechanismConfigId, campaign.mechanismConfigId)
        )
      )
      .limit(1);
    if (!artifact) notFound("Committed randomness artifact not found");
    if (artifact.status === "VERIFIED") return serializeRandomness(artifact);
    if (artifact.source !== "DRAND" || artifact.network !== "evmnet") {
      throw new ServiceError("UNSUPPORTED_RANDOMNESS_SOURCE", "Only verified drand evmnet randomness is supported", 409);
    }
    if (artifact.chainHash !== DRAND_EVMNET_CHAIN_HASH) {
      throw new ServiceError("DRAND_CHAIN_MISMATCH", "The committed drand chain does not match pinned evmnet", 409);
    }
    if (Date.now() < artifact.notBefore.getTime()) {
      throw new ServiceError(
        "DRAND_ROUND_NOT_AVAILABLE",
        "The committed randomness round is not available yet",
        409,
        { notBefore: artifact.notBefore.toISOString(), round: artifact.round.toString() }
      );
    }

    await this.db
      .update(schema.randomnessArtifacts)
      .set({ status: "FETCHING", errorCode: null, updatedAt: new Date() })
      .where(eq(schema.randomnessArtifacts.id, artifact.id));

    const settled = await Promise.allSettled(
      this.env.DRAND_RELAY_URLS.map((relay) => this.fetchRelay(relay, Number(artifact.round)))
    );
    const successes = settled.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
    const relayResponses = this.env.DRAND_RELAY_URLS.map((relay, index) => {
      const result = settled[index]!;
      return result.status === "fulfilled"
        ? {
            relay,
            status: "VERIFIED",
            round: result.value.beacon.round,
            randomness: result.value.beacon.randomness,
            signature: result.value.beacon.signature
          }
        : {
            relay,
            status: "FAILED",
            error: errorCode(result.reason)
          };
    });

    const groups = new Map<string, RelayResult[]>();
    for (const result of successes) {
      const key = `${result.beacon.round}:${result.beacon.randomness.toLowerCase()}:${result.beacon.signature.toLowerCase()}`;
      groups.set(key, [...(groups.get(key) ?? []), result]);
    }
    const consensus = [...groups.values()].sort((left, right) => right.length - left.length)[0];
    if (!consensus || consensus.length < 2) {
      await this.db
        .update(schema.randomnessArtifacts)
        .set({
          status: "FAILED",
          relayResponses,
          errorCode: successes.length === 0 ? "DRAND_ALL_RELAYS_FAILED" : "DRAND_RELAY_DISAGREEMENT",
          updatedAt: new Date()
        })
        .where(eq(schema.randomnessArtifacts.id, artifact.id));
      throw new ServiceError(
        successes.length === 0 ? "DRAND_ALL_RELAYS_FAILED" : "DRAND_RELAY_DISAGREEMENT",
        "The committed drand beacon could not be verified by two independent relays",
        503
      );
    }

    const selected = consensus[0]!;
    const verificationArtifact = {
      artifactVersion: "1",
      source: "DRAND",
      network: "evmnet",
      chainHash: selected.info.hash,
      publicKey: selected.info.public_key,
      schemeId: selected.info.schemeID,
      periodSeconds: selected.info.period,
      genesisTime: selected.info.genesis_time,
      round: selected.beacon.round,
      randomness: selected.beacon.randomness,
      signature: selected.beacon.signature,
      previousSignature: "previous_signature" in selected.beacon
        ? selected.beacon.previous_signature
        : null,
      verifiedRelays: consensus.map((item) => item.relay).sort()
    };
    const artifactHash = domainHash("TAKE_DRAND_RANDOMNESS_ARTIFACT_V1", verificationArtifact);
    const now = new Date();
    const [updated] = await this.db
      .update(schema.randomnessArtifacts)
      .set({
        status: "VERIFIED",
        randomness: `0x${selected.beacon.randomness.toLowerCase()}`,
        signature: selected.beacon.signature.toLowerCase(),
        previousSignature: "previous_signature" in selected.beacon
          ? selected.beacon.previous_signature.toLowerCase()
          : null,
        publicKey: selected.info.public_key.toLowerCase(),
        schemeId: selected.info.schemeID,
        periodSeconds: selected.info.period,
        genesisTime: BigInt(selected.info.genesis_time),
        relayResponses,
        artifactHash,
        verifiedAt: now,
        errorCode: null,
        updatedAt: now
      })
      .where(
        and(
          eq(schema.randomnessArtifacts.id, artifact.id),
          eq(schema.randomnessArtifacts.round, artifact.round)
        )
      )
      .returning();
    if (!updated) throw new Error("Failed to persist verified drand artifact");
    return serializeRandomness(updated);
  }

  private async fetchRelay(relay: string, round: number): Promise<RelayResult> {
    const options = {
      disableBeaconVerification: false,
      noCache: false,
      chainVerificationParams: {
        chainHash: DRAND_EVMNET_CHAIN_HASH,
        publicKey: DRAND_EVMNET_PUBLIC_KEY
      }
    };
    const baseUrl = `${relay.replace(/\/$/, "")}/${DRAND_EVMNET_CHAIN_HASH}`;
    const chain = new HttpCachingChain(baseUrl, options);
    const client = new HttpChainClient(chain, options);
    const [info, beacon] = await withTimeout(
      Promise.all([chain.info(), fetchBeacon(client, round)]),
      this.env.DRAND_REQUEST_TIMEOUT_MS
    );
    if (
      info.hash.toLowerCase() !== DRAND_EVMNET_CHAIN_HASH
      || info.public_key.toLowerCase() !== DRAND_EVMNET_PUBLIC_KEY
      || info.period !== DRAND_EVMNET_PERIOD_SECONDS
      || info.genesis_time !== DRAND_EVMNET_GENESIS_TIME
      || beacon.round !== round
    ) {
      throw new Error("DRAND_PINNED_CHAIN_MISMATCH");
    }
    return { relay, info, beacon };
  }
}

function serializeRandomness(record: typeof schema.randomnessArtifacts.$inferSelect) {
  return {
    id: record.id,
    campaignId: record.campaignId,
    source: record.source,
    network: record.network,
    chainHash: record.chainHash,
    round: record.round.toString(),
    notBefore: record.notBefore.toISOString(),
    status: record.status,
    randomness: record.randomness,
    signature: record.signature,
    publicKey: record.publicKey,
    schemeId: record.schemeId,
    artifactHash: record.artifactHash,
    verifiedAt: record.verifiedAt?.toISOString() ?? null,
    errorCode: record.errorCode
  };
}

function withTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("DRAND_REQUEST_TIMEOUT")), milliseconds);
    timer.unref?.();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function errorCode(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 160) : "DRAND_REQUEST_FAILED";
}
