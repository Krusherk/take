import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { campaignFromApi } from "../lib/productData";
import type { ApiCampaign } from "../types/product";
import { OperatorPage } from "./OperatorPage";

const WALLET = "0x00000000000000000000000000000000000000aa";
const sendTransaction = vi.fn(async () => ({ hash: "0xfeed" }));
let status = "CLOSED";
let endTime = "2026-10-01T00:00:00.000Z";
let allocation: unknown = { id: "run-1", status: "COMPLETED", resultHash: "0xabc", completedAt: "2026-10-02T00:00:00.000Z" };
const calls: Array<{ path: string; body?: string }> = [];

function apiCampaign(): ApiCampaign {
  return {
    id: "c1", title: "TAKE Demo", description: "Demo", status, startTime: "2026-09-01T00:00:00.000Z", endTime,
    organization: { id: "org1", name: "Monad Devs" }, resource: { name: "builder spot", quantity: 1 }, participantCount: 0,
    launchApproved: true, onchain: { published: true, campaignId: "4", authorityWalletAddress: WALLET, managerContractAddress: "0xc3A0" },
  } as unknown as ApiCampaign;
}

const request = vi.fn(async (path: string, init?: RequestInit) => {
  calls.push({ path, body: typeof init?.body === "string" ? init.body : undefined });
  if (path === "/operator/me") return { operator: true };
  if (path === "/operator/campaign-requests" || path === "/operator/evaluations") return [];
  if (path === "/campaigns/c1") return apiCampaign();
  if (path.endsWith("/selector-eligibility")) return { status: "LOCKED", finalAllowlistId: "a1", counts: { eligible: 3, needsReview: 0 } };
  if (path.endsWith("/mechanism")) return { status: "LOCKED", config: {}, snapshots: [{ id: "s1", audience: "NOMINATOR", status: "LOCKED" }, { id: "s2", audience: "RECIPIENT", status: "LOCKED" }] };
  if (path.endsWith("/experiment-v0")) return { id: "e1", status: "LOCKED" };
  if (path.endsWith("/allocation-runs/latest")) return allocation;
  if (path.endsWith("/recipient-context")) return { snapshotId: "s2", recipients: [] };
  if (path.endsWith("/lifecycle-intents") || path.endsWith("/rosters")) return [];
  if (path.endsWith("/integrity-observations")) return { snapshot: null };
  if (path.endsWith("/after")) return { plan: null };
  if (path.includes("/lifecycle/") && path.endsWith("/prepare")) {
    return { id: "intent-1", action: "X", status: "WAITING_FOR_WALLET", requiredFromAddress: WALLET, transactionHash: null, onchainCampaignId: "4", errorCode: null, errorMessage: null, transaction: { to: "0x00000000000000000000000000000000000000bb", data: "0x1234", value: "0", chainId: 10143 } };
  }
  return {};
});

vi.mock("../context/TakeIdentityContext", () => ({
  useTakeMe: () => ({ me: { wallets: [{ address: WALLET, primary: true, embedded: true }] }, request }),
}));
vi.mock("../context/TakeProductContext", () => ({
  useTakeProduct: () => ({ campaigns: [campaignFromApi(apiCampaign())], refetch: refetchCampaigns }),
}));
const refetchCampaigns = vi.fn(async () => {});
vi.mock("../lib/privy", () => ({
  useSendTransaction: () => ({ sendTransaction }),
  useUser: () => ({ refreshUser: async () => {} }),
  useWallets: () => ({ ready: true, wallets: [{ address: WALLET, walletClientType: "privy" }] }),
}));

beforeEach(() => {
  calls.length = 0;
  sendTransaction.mockClear();
  status = "CLOSED";
  endTime = "2026-10-01T00:00:00.000Z";
  allocation = { id: "run-1", status: "COMPLETED", resultHash: "0xabc", completedAt: "2026-10-02T00:00:00.000Z" };
});

describe("OperatorPage", () => {
  it("is a sky sticker page with the lifecycle track", async () => {
    const { container } = render(<OperatorPage />);
    expect(await screen.findByRole("heading", { level: 1, name: "Run campaigns." })).toBeInTheDocument();
    expect(container.querySelector(".operator-sticker")).not.toBeNull();
    expect(await screen.findByRole("list", { name: "Campaign lifecycle: 4 of 5 steps done" })).toBeInTheDocument();
  });

  it("finalizes through the prepared lifecycle intent, the wallet, and submit", async () => {
    render(<OperatorPage />);
    fireEvent.click(await screen.findByRole("button", { name: /FINALIZE RESULT/ }));
    await waitFor(() => expect(calls.some((call) => call.path === "/operator/campaigns/c1/lifecycle-intents/intent-1/submit")).toBe(true));
    const prepare = calls.find((call) => call.path === "/operator/campaigns/c1/lifecycle/finalize/prepare");
    expect(JSON.parse(prepare!.body!)).toEqual({ allocationRunId: "run-1" });
    expect(sendTransaction).toHaveBeenCalledWith(
      { to: "0x00000000000000000000000000000000000000bb", data: "0x1234", value: 0n, chainId: 10143 },
      expect.objectContaining({ address: WALLET }),
    );
    const submit = calls.find((call) => call.path.endsWith("/intent-1/submit"));
    expect(JSON.parse(submit!.body!)).toEqual({ transactionHash: "0xfeed", fromAddress: WALLET });
  });

  it("runs allocation after close", async () => {
    allocation = null;
    render(<OperatorPage />);
    fireEvent.click(await screen.findByRole("button", { name: /RUN ALLOCATION/ }));
    await waitFor(() => expect(calls.some((call) => call.path === "/campaigns/c1/allocation-runs" && call.body === "{}")).toBe(true));
  });

  it("closes an active campaign after its end time", async () => {
    status = "ACTIVE";
    allocation = null;
    render(<OperatorPage />);
    fireEvent.click(await screen.findByRole("button", { name: /CLOSE CAMPAIGN/ }));
    await waitFor(() => expect(calls.some((call) => call.path === "/operator/campaigns/c1/lifecycle/close/prepare")).toBe(true));
    await waitFor(() => expect(sendTransaction).toHaveBeenCalledTimes(1));
  });
});
