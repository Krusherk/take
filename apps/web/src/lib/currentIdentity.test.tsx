import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Avatar } from "../components/Avatar";
import type { TakeHistory } from "../types/identity";
import { xConnectedMe } from "../test/identityFixture";
import { activityFromHistory, personFromMe } from "./currentIdentity";

describe("authenticated TAKE identity presentation", () => {
  it("shows the verified X display name, username, and profile picture", () => {
    const person = personFromMe(xConnectedMe);
    render(<Avatar person={person} />);

    expect(person).toMatchObject({
      name: "Real X Person",
      handle: "@realxperson",
      avatarUrl: "https://pbs.twimg.com/profile_images/real.jpg",
    });
    expect(screen.getByRole("img", { name: "Real X Person's profile picture" }).querySelector("img"))
      .toHaveAttribute("src", "https://pbs.twimg.com/profile_images/real.jpg");
  });

  it("omits a handle when no verified social username exists", () => {
    const person = personFromMe({
      ...xConnectedMe,
      user: { ...xConnectedMe.user, displayName: null, username: null, avatarUrl: null },
      socials: { ...xConnectedMe.socials, twitter: { connected: false } },
    });

    expect(person.name).toBe("TAKE member");
    expect(person.handle).toBe("");
  });

  it("uses a deterministic TAKE fallback when a remote social avatar fails", () => {
    const person = personFromMe(xConnectedMe);
    render(<Avatar person={person} />);
    const avatar = screen.getByRole("img", { name: "Real X Person's profile picture" });
    fireEvent.error(avatar.querySelector("img")!);

    expect(avatar.querySelector("img")).not.toBeInTheDocument();
    expect(avatar.querySelector("svg")).toBeInTheDocument();
  });

  it("builds authored history with the authenticated user's real avatar and name", () => {
    const history: TakeHistory = {
      given: [{
        id: "nomination-1",
        campaignId: "campaign-1",
        campaignTitle: "Monad Creator Round",
        person: { displayName: "Sarah", username: "sarah", avatarUrl: null, joined: true },
        transactionHash: null,
        status: "CONFIRMED",
        createdAt: "2026-09-04T10:00:00.000Z",
        confirmedAt: "2026-09-04T10:01:00.000Z",
      }],
      received: [],
    };

    const [entry] = activityFromHistory(xConnectedMe, history);
    expect(entry).toMatchObject({ kind: "given", actor: { name: "Real X Person" }, recipient: { name: "Sarah" } });
    expect(entry?.actor?.avatarUrl).toBe(xConnectedMe.user.avatarUrl);
  });
});
