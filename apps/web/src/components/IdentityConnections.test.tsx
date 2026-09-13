import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { xConnectedMe } from "../test/identityFixture";
import { IdentityConnections } from "./IdentityConnections";

const mocks = vi.hoisted(() => ({
  refreshUser: vi.fn(),
  refetch: vi.fn(),
  unlinkOAuth: vi.fn(),
  unlinkWallet: vi.fn(),
  linkTwitter: vi.fn(),
  linkDiscord: vi.fn(),
  linkGithub: vi.fn(),
  linkWallet: vi.fn(),
}));

vi.mock("@privy-io/react-auth", () => ({
  useUser: () => ({ refreshUser: mocks.refreshUser }),
  useUnlinkOAuth: () => ({ unlink: mocks.unlinkOAuth }),
  useUnlinkWallet: () => ({ unlink: mocks.unlinkWallet }),
  useLinkAccount: (callbacks: { onSuccess?: () => void }) => ({
    linkTwitter: mocks.linkTwitter,
    linkDiscord: () => {
      mocks.linkDiscord();
      callbacks.onSuccess?.();
    },
    linkGithub: mocks.linkGithub,
    linkWallet: mocks.linkWallet,
  }),
}));

vi.mock("../context/TakeIdentityContext", () => ({
  useTakeMe: () => ({ refetch: mocks.refetch }),
}));

describe("identity connections", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.refreshUser.mockResolvedValue({});
    mocks.refetch.mockResolvedValue(undefined);
    mocks.unlinkOAuth.mockResolvedValue({});
    mocks.unlinkWallet.mockResolvedValue({});
  });

  it("shows the connected X identity returned by TAKE /me", () => {
    render(<IdentityConnections me={xConnectedMe} />);
    const row = screen.getByText("@realxperson").closest<HTMLElement>(".connection-row");
    expect(row).not.toBeNull();
    expect(within(row!).getByText("@realxperson")).toBeInTheDocument();
    expect(within(row!).getByText("CONNECTED")).toBeInTheDocument();
  });

  it("shows CONNECT for a disconnected social provider", () => {
    render(<IdentityConnections me={xConnectedMe} />);
    const row = screen.getByText("DISCORD").closest<HTMLElement>(".connection-row");
    expect(row).not.toBeNull();
    expect(within(row!).getByRole("button", { name: "CONNECT" })).toBeInTheDocument();
  });

  it("refreshes Privy and refetches /me after linking a social account", async () => {
    render(<IdentityConnections me={xConnectedMe} />);
    const row = screen.getByText("DISCORD").closest<HTMLElement>(".connection-row");
    fireEvent.click(within(row!).getByRole("button", { name: "CONNECT" }));

    await waitFor(() => expect(mocks.refreshUser).toHaveBeenCalledTimes(1));
    expect(mocks.refetch).toHaveBeenCalledTimes(1);
    expect(mocks.linkDiscord).toHaveBeenCalledTimes(1);
  });

  it("uses Privy's provider subject when a confirmed social disconnect runs", async () => {
    render(<IdentityConnections me={xConnectedMe} />);
    const row = screen.getByText("@realxperson").closest<HTMLElement>(".connection-row");
    fireEvent.click(within(row!).getByRole("button", { name: "DISCONNECT" }));
    const dialog = screen.getByRole("dialog", { name: "Disconnect X?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "DISCONNECT" }));

    await waitFor(() => expect(mocks.unlinkOAuth).toHaveBeenCalledWith({
      provider: "twitter",
      subject: "twitter-real-subject",
    }));
    expect(mocks.refreshUser).toHaveBeenCalledTimes(1);
    expect(mocks.refetch).toHaveBeenCalledTimes(1);
  });
});
