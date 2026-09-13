import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ActivityItem, Person } from "../types/product";
import { ActivityRow, PersonResult } from "./Social";

const giver: Person = {
  id: "giver-1",
  name: "Kubo Lee",
  handle: "@kubo",
  avatarUrl: null,
  joined: true,
  recipient: { type: "take_identity", takeIdentityId: "giver-1" },
};

const recipient: Person = {
  id: "recipient-1",
  name: "Sarah Chen",
  handle: "@sarah",
  avatarUrl: null,
  joined: true,
  relationship: "TAKE member",
  recipient: { type: "take_identity", takeIdentityId: "recipient-1" },
};

describe("social product surfaces", () => {
  it("makes a recipient row an accessible, social selection control", () => {
    const onSelect = vi.fn();
    render(<PersonResult person={recipient} selected onSelect={onSelect} />);

    const row = screen.getByRole("button", { name: /Sarah Chen/i });
    expect(row).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("@sarah")).toBeVisible();
    expect(screen.getByText("TAKE member")).toBeVisible();
    fireEvent.click(row);
    expect(onSelect).toHaveBeenCalledWith(recipient);
  });

  it("renders a TAKE as a relationship between two named people", () => {
    const item: ActivityItem = {
      id: "take-1",
      kind: "received",
      actor: giver,
      recipient,
      campaign: "Creator Allocation",
      campaignId: "campaign-live",
      time: "2m",
      unread: true,
    };

    render(<ActivityRow item={item} />);
    expect(screen.getByText(/Kubo Lee/)).toBeVisible();
    expect(screen.getByText(/Sarah Chen/)).toBeVisible();
    expect(screen.getByText("Creator Allocation")).toBeVisible();
  });
});
