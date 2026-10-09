import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { xConnectedMe } from "../test/identityFixture";
import type { TakeHistory } from "../types/identity";
import { ProfilePage } from "./ProfilePage";

const history: TakeHistory = {
  given: [],
  received: [{
    id: "nom-1",
    campaignId: "demo",
    campaignTitle: "Builder Week",
    person: { displayName: "Ada Obi", username: "adaobi", avatarUrl: null, joined: true },
    transactionHash: "0xabc",
    status: "CONFIRMED",
    createdAt: "2026-10-06T10:00:00.000Z",
    confirmedAt: "2026-10-06T10:01:00.000Z",
  }],
};

vi.mock("../context/TakeIdentityContext", () => ({ useTakeMe: () => ({ me: xConnectedMe, history }) }));
vi.mock("../components/IdentityConnections", () => ({ IdentityConnections: () => <section id="identity-connections">connections</section> }));
vi.mock("../components/Signal", () => ({ ProfileSignal: () => <section>signal</section> }));

describe("ProfilePage", () => {
  it("shows the person, real counts, history, and log out on the sky", () => {
    const onLogout = vi.fn(async () => {});
    const { container } = render(<ProfilePage navigate={vi.fn()} onLogout={onLogout} />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/\S/);
    const counts = screen.getByRole("list", { name: "Your TAKE counts" });
    expect(counts).toHaveTextContent(`${xConnectedMe.takes.given}given`);
    expect(counts).toHaveTextContent(`${xConnectedMe.takes.received}received`);
    expect(counts).toHaveTextContent("1campaign");
    expect(screen.getByText("Builder Week")).toBeInTheDocument();
    expect(container.querySelector(".profile-hero, .profile-account, .take-mascot-accent")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Log out" }));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });
});
